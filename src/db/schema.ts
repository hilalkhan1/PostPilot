import {
  pgTable,
  pgEnum,
  text,
  uuid,
  timestamp,
  integer,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

/* ------------------------------------------------------------------ *
 * Enums
 * ------------------------------------------------------------------ */

/** An OAuth grant. One Meta grant covers both Facebook Pages and Instagram. */
export const providerEnum = pgEnum("provider", ["meta", "linkedin"]);

/** A publishing destination. Several of these can hang off one grant. */
export const platformEnum = pgEnum("platform", [
  "facebook",
  "instagram",
  "linkedin",
]);

export const connectionStatusEnum = pgEnum("connection_status", [
  "active",
  "expiring", // refresh window is close; a daily job should renew it
  "needs_reauth", // refresh failed or the user revoked it
  "revoked",
]);

export const postStatusEnum = pgEnum("post_status", [
  "draft",
  "scheduled",
  "publishing", // at least one target is in flight
  "done", // every target reached a terminal state
]);

/**
 * The lifecycle of a single destination. This is the column that matters:
 * partial success is the normal case, so status lives here and never on `posts`.
 */
export const targetStatusEnum = pgEnum("target_status", [
  "draft",
  "scheduled",
  "claimed", // a tick has locked this row
  "awaiting_remote", // Instagram container created, Meta still processing
  "published",
  "retrying",
  "failed",
  "needs_auth",
  "canceled",
]);

/* ------------------------------------------------------------------ *
 * Tenancy
 * ------------------------------------------------------------------ */

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  plan: text("plan").notNull().default("free"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    name: text("name"),
    /** External identity id (Clerk user id) once auth is swapped in. */
    externalId: text("external_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("users_email_idx").on(t.email),
    uniqueIndex("users_external_id_idx").on(t.externalId),
  ],
);

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("owner"),
  },
  (t) => [uniqueIndex("memberships_org_user_idx").on(t.orgId, t.userId)],
);

/* ------------------------------------------------------------------ *
 * Connections and accounts
 * ------------------------------------------------------------------ */

/**
 * One row per OAuth grant. Tokens live here.
 *
 * A single Meta consent screen returns every Page the user administers plus
 * every Instagram Business account linked to those Pages, so the grant and the
 * destination cannot be the same table.
 */
export const platformConnections = pgTable(
  "platform_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    provider: providerEnum("provider").notNull(),

    /** The provider's id for the human who granted access. */
    providerUserId: text("provider_user_id").notNull(),
    displayName: text("display_name"),

    /** AES-256-GCM sealed. Never stored or logged in plaintext. */
    accessTokenEnc: text("access_token_enc").notNull(),
    refreshTokenEnc: text("refresh_token_enc"),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),

    scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
    status: connectionStatusEnum("status").notNull().default("active"),
    lastError: text("last_error"),

    connectedAt: timestamp("connected_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("connections_org_provider_user_idx").on(
      t.orgId,
      t.provider,
      t.providerUserId,
    ),
    index("connections_expiry_idx").on(t.tokenExpiresAt),
  ],
);

/**
 * A single publishing destination: one Facebook Page, one Instagram Business
 * account, or one LinkedIn member profile.
 */
export const socialAccounts = pgTable(
  "social_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => platformConnections.id, { onDelete: "cascade" }),

    platform: platformEnum("platform").notNull(),
    /** Page id, IG user id, or `urn:li:person:{sub}`. */
    platformAccountId: text("platform_account_id").notNull(),

    handle: text("handle"),
    displayName: text("display_name").notNull(),
    avatarUrl: text("avatar_url"),

    /**
     * Facebook issues a separate, effectively non-expiring token per Page,
     * derived from the user grant. Instagram publishing uses the token of the
     * Page it is linked to, so it is stored here too.
     */
    pageTokenEnc: text("page_token_enc"),

    /** Instagram needs its parent Page id for token lookup and discovery. */
    parentPageId: text("parent_page_id"),

    status: connectionStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("accounts_org_platform_account_idx").on(
      t.orgId,
      t.platform,
      t.platformAccountId,
    ),
    index("accounts_connection_idx").on(t.connectionId),
  ],
);

/* ------------------------------------------------------------------ *
 * Media
 * ------------------------------------------------------------------ */

export const mediaAssets = pgTable(
  "media_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    storageKey: text("storage_key").notNull(),
    /**
     * Public HTTPS URL. Meta fetches media itself rather than accepting an
     * upload, so this is not a convenience — it is on the critical path.
     */
    publicUrl: text("public_url").notNull(),

    mime: text("mime").notNull(),
    bytes: integer("bytes").notNull(),
    width: integer("width"),
    height: integer("height"),
    checksum: text("checksum"),
    altText: text("alt_text"),

    /** Per-platform crops, keyed by platform: `{ "instagram": "https://..." }` */
    renditions: jsonb("renditions")
      .$type<Record<string, string>>()
      .notNull()
      .default({}),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("media_org_idx").on(t.orgId)],
);

/* ------------------------------------------------------------------ *
 * Posts and targets
 * ------------------------------------------------------------------ */

export type BaseContent = {
  text: string;
  mediaIds: string[];
  link?: string;
};

/** Anything a single platform is allowed to override on the shared content. */
export type TargetOverrides = {
  text?: string;
  mediaIds?: string[];
  firstComment?: string;
  altText?: Record<string, string>;
};

export const posts = pgTable(
  "posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),

    status: postStatusEnum("status").notNull().default("draft"),
    baseContent: jsonb("base_content").$type<BaseContent>().notNull(),

    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    /** IANA zone, e.g. "Asia/Karachi". Kept so recurring times survive DST. */
    timezone: text("timezone").notNull().default("UTC"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("posts_org_scheduled_idx").on(t.orgId, t.scheduledAt)],
);

export const postTargets = pgTable(
  "post_targets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    socialAccountId: uuid("social_account_id")
      .notNull()
      .references(() => socialAccounts.id, { onDelete: "cascade" }),

    /** Denormalised so the dispatcher is one indexed query. */
    platform: platformEnum("platform").notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),

    overrides: jsonb("overrides").$type<TargetOverrides>().notNull().default({}),
    status: targetStatusEnum("status").notNull().default("draft"),

    /** Generated once at schedule time and never regenerated per attempt. */
    idempotencyKey: uuid("idempotency_key").notNull().defaultRandom(),

    /**
     * Instagram's in-flight container id. Persisting this before anything else
     * is what makes a half-finished publish resumable instead of duplicated.
     */
    remoteContainerId: text("remote_container_id"),
    remotePostId: text("remote_post_id"),
    permalink: text("permalink"),

    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),

    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (t) => [
    /** The dispatcher's hot path: "what is due right now?" */
    index("targets_due_idx").on(t.status, t.scheduledAt),
    index("targets_post_idx").on(t.postId),
    index("targets_account_idx").on(t.socialAccountId),
  ],
);

/**
 * Append-only log of every call to a platform. When a user says "it didn't
 * post", the raw response body is the only thing that answers them.
 */
export const publishAttempts = pgTable(
  "publish_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postTargetId: uuid("post_target_id")
      .notNull()
      .references(() => postTargets.id, { onDelete: "cascade" }),

    attemptNo: integer("attempt_no").notNull(),
    step: text("step").notNull(), // "create_container" | "poll" | "publish" | ...
    outcome: text("outcome").notNull(), // "published" | "pending" | "failed"

    httpStatus: integer("http_status"),
    requestId: text("request_id"),
    responseBody: text("response_body"),

    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("attempts_target_idx").on(t.postTargetId)],
);

/* ------------------------------------------------------------------ *
 * Relations
 * ------------------------------------------------------------------ */

export const orgRelations = relations(organizations, ({ many }) => ({
  memberships: many(memberships),
  connections: many(platformConnections),
  accounts: many(socialAccounts),
  posts: many(posts),
}));

export const connectionRelations = relations(
  platformConnections,
  ({ one, many }) => ({
    org: one(organizations, {
      fields: [platformConnections.orgId],
      references: [organizations.id],
    }),
    accounts: many(socialAccounts),
  }),
);

export const accountRelations = relations(socialAccounts, ({ one, many }) => ({
  connection: one(platformConnections, {
    fields: [socialAccounts.connectionId],
    references: [platformConnections.id],
  }),
  targets: many(postTargets),
}));

export const postRelations = relations(posts, ({ one, many }) => ({
  org: one(organizations, {
    fields: [posts.orgId],
    references: [organizations.id],
  }),
  targets: many(postTargets),
}));

export const targetRelations = relations(postTargets, ({ one, many }) => ({
  post: one(posts, { fields: [postTargets.postId], references: [posts.id] }),
  account: one(socialAccounts, {
    fields: [postTargets.socialAccountId],
    references: [socialAccounts.id],
  }),
  attempts: many(publishAttempts),
}));

/* ------------------------------------------------------------------ *
 * Inferred types
 * ------------------------------------------------------------------ */

export type Organization = typeof organizations.$inferSelect;
export type User = typeof users.$inferSelect;
export type PlatformConnection = typeof platformConnections.$inferSelect;
export type SocialAccount = typeof socialAccounts.$inferSelect;
export type MediaAsset = typeof mediaAssets.$inferSelect;
export type Post = typeof posts.$inferSelect;
export type PostTarget = typeof postTargets.$inferSelect;
export type Platform = (typeof platformEnum.enumValues)[number];
export type Provider = (typeof providerEnum.enumValues)[number];
export type TargetStatus = (typeof targetStatusEnum.enumValues)[number];
