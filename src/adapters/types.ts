import type { Platform, PostTarget, Provider, SocialAccount } from "@/db/schema";

/* ------------------------------------------------------------------ *
 * Capabilities
 * ------------------------------------------------------------------ */

/**
 * Everything the UI and the validator need to know about a platform without
 * naming it. The composer renders itself from this table, which is what keeps
 * `if (platform === "instagram")` out of the rest of the codebase.
 */
export type Capabilities = {
  label: string;
  maxTextLength: number;
  maxMedia: number;
  minMedia: number;
  acceptedMime: string[];
  /** Whether the platform pulls media from a URL or wants the bytes uploaded. */
  mediaDelivery: "upload" | "public_url";
  /** Allowed width/height ratios as [min, max]; null means anything goes. */
  aspectRatioRange: [number, number] | null;
  maxImageBytes: number;
  hashtagLimit: number | null;
  supportsFirstComment: boolean;
  supportsAltText: boolean;
  supportsLinkPreview: boolean;
  /** True when publishing completes across several ticks (Instagram). */
  isAsync: boolean;
  /** Posts per rolling 24h the platform will accept, if it publishes a figure. */
  dailyPostLimit: number | null;
};

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

export type ValidationIssue = {
  field: "text" | "media" | "schedule" | "account";
  severity: "error" | "warning";
  message: string;
};

export type ValidationResult = {
  ok: boolean;
  issues: ValidationIssue[];
};

/* ------------------------------------------------------------------ *
 * Publishing
 * ------------------------------------------------------------------ */

export type ResolvedMedia = {
  id: string;
  publicUrl: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  altText: string | null;
};

export type ResolvedContent = {
  text: string;
  media: ResolvedMedia[];
  link?: string;
  firstComment?: string;
};

export type AttemptLog = {
  step: string;
  outcome: "published" | "pending" | "failed";
  httpStatus?: number;
  requestId?: string;
  responseBody?: string;
};

export type PublishContext = {
  target: PostTarget;
  account: SocialAccount;
  /**
   * Already decrypted, already refreshed, and already the *correct* token for
   * this destination — a Page token for Facebook and Instagram, the member
   * token for LinkedIn. Adapters never touch the database.
   */
  accessToken: string;
  content: ResolvedContent;
  log: (entry: AttemptLog) => Promise<void>;
};

/**
 * The result of one step of work.
 *
 * `pending` is what lets Instagram's create-poll-publish flow and LinkedIn's
 * single call share a signature: the dispatcher just calls `advance` again on
 * the next tick, and never needs to know which platform is which.
 */
export type PublishOutcome =
  | { kind: "published"; remotePostId: string; permalink: string }
  | { kind: "pending"; remoteContainerId: string; retryAfterSeconds?: number }
  | {
      kind: "failed";
      code: string;
      message: string;
      retryable: boolean;
      needsAuth?: boolean;
    };

/* ------------------------------------------------------------------ *
 * OAuth
 * ------------------------------------------------------------------ */

/** The result of exchanging an authorization code. */
export type GrantResult = {
  providerUserId: string;
  displayName: string | null;
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
  scopes: string[];
};

/** A destination discovered from a grant. One Meta grant can yield many. */
export type DiscoveredAccount = {
  platform: Platform;
  platformAccountId: string;
  displayName: string;
  handle?: string | null;
  avatarUrl?: string | null;
  /** Facebook Pages carry their own token; Instagram borrows its Page's. */
  pageToken?: string | null;
  parentPageId?: string | null;
};

/**
 * Auth is per-provider, not per-platform: one Meta consent screen returns both
 * Facebook Pages and Instagram accounts.
 */
export type ProviderAuth = {
  readonly provider: Provider;
  readonly label: string;
  readonly scopes: string[];
  getAuthUrl(state: string, redirectUri: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<GrantResult>;
  /** Enumerate every publishable destination this grant unlocks. */
  listAccounts(grant: GrantResult): Promise<DiscoveredAccount[]>;
  /** Returns a fresh grant, or throws if the user must reconnect. */
  refresh?(grant: GrantResult): Promise<GrantResult>;
};

/** Publishing is per-platform. Facebook and Instagram differ here entirely. */
export type PlatformAdapter = {
  readonly platform: Platform;
  readonly provider: Provider;
  readonly capabilities: Capabilities;
  /**
   * One step of work. Called once per tick until it stops returning `pending`.
   * Must be safe to call twice: the dispatcher persists `remoteContainerId`
   * before the next tick, so a resumed target polls rather than re-creates.
   */
  advance(ctx: PublishContext): Promise<PublishOutcome>;
};

/* ------------------------------------------------------------------ *
 * Errors
 * ------------------------------------------------------------------ */

export class PlatformError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly needsAuth = false,
    readonly httpStatus?: number,
    readonly responseBody?: string,
  ) {
    super(message);
    this.name = "PlatformError";
  }

  toOutcome(): PublishOutcome {
    return {
      kind: "failed",
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      needsAuth: this.needsAuth,
    };
  }
}
