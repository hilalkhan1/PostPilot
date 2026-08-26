import { and, eq, inArray } from "drizzle-orm";
import { db, sql as raw } from "@/db";
import {
  mediaAssets,
  platformConnections,
  postTargets,
  posts,
  publishAttempts,
  socialAccounts,
  type PostTarget,
} from "@/db/schema";
import { adapterFor, providerFor } from "@/adapters";
import { validateForPlatform } from "@/adapters/validate";
import type {
  AttemptLog,
  PublishOutcome,
  ResolvedContent,
  ResolvedMedia,
} from "@/adapters/types";
import { open, seal } from "./crypto";

/**
 * Backoff between attempts, in seconds. Deliberately coarse: the tick runs
 * every minute, so anything finer than a minute is noise.
 */
const BACKOFF_SECONDS = [60, 5 * 60, 15 * 60, 60 * 60, 6 * 60 * 60];
const MAX_ATTEMPTS = BACKOFF_SECONDS.length;

/** How long a `claimed` row may sit before we assume the function died. */
const STALE_CLAIM_MINUTES = 10;

/** Refresh a token this far ahead of its expiry rather than waiting for a 401. */
const REFRESH_WINDOW_DAYS = 7;

export type TickResult = {
  claimed: number;
  published: number;
  pending: number;
  failed: number;
  needsAuth: number;
  errors: string[];
};

/* ------------------------------------------------------------------ *
 * Claiming
 * ------------------------------------------------------------------ */

/**
 * Take ownership of everything that is due, in one statement.
 *
 * `FOR UPDATE SKIP LOCKED` is the entire concurrency story: two overlapping
 * ticks simply take different rows, so no Redis and no lock service is needed.
 * Stale claims are folded into the same query — a row that has been `claimed`
 * for longer than the timeout belongs to a function that died mid-flight, and
 * gets picked up again rather than sitting there forever.
 */
async function claimDue(limit: number): Promise<PostTarget[]> {
  // Raw SQL returns snake_case columns, so this deliberately returns only ids
  // and lets Drizzle re-read the rows with its own column mapping. Casting
  // `RETURNING *` straight to PostTarget would typecheck and then hand every
  // caller `undefined` for remoteContainerId — which on Instagram means a fresh
  // container, and a duplicate post, on every single tick.
  const claimed = await raw<{ id: string }[]>`
    UPDATE post_targets
       SET status = 'claimed', claimed_at = now()
     WHERE id IN (
       SELECT id FROM post_targets
        WHERE (
                status IN ('scheduled', 'retrying', 'awaiting_remote')
                AND scheduled_at <= now()
                AND (next_attempt_at IS NULL OR next_attempt_at <= now())
              )
           OR (
                status = 'claimed'
                AND claimed_at < now() - (${STALE_CLAIM_MINUTES} * interval '1 minute')
              )
        ORDER BY scheduled_at ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
     )
    RETURNING id`;

  if (claimed.length === 0) return [];

  return db
    .select()
    .from(postTargets)
    .where(
      inArray(
        postTargets.id,
        claimed.map((row) => row.id),
      ),
    );
}

/* ------------------------------------------------------------------ *
 * Content resolution
 * ------------------------------------------------------------------ */

/** Merge the shared content with this target's overrides and load its media. */
async function resolveContent(target: PostTarget): Promise<ResolvedContent> {
  const [post] = await db
    .select()
    .from(posts)
    .where(eq(posts.id, target.postId))
    .limit(1);

  if (!post) throw new Error(`Post ${target.postId} vanished.`);

  const overrides = target.overrides ?? {};
  const text = overrides.text ?? post.baseContent.text ?? "";
  const mediaIds = overrides.mediaIds ?? post.baseContent.mediaIds ?? [];

  let media: ResolvedMedia[] = [];
  if (mediaIds.length > 0) {
    const assets = await db
      .select()
      .from(mediaAssets)
      .where(inArray(mediaAssets.id, mediaIds));

    // Preserve the author's ordering; a carousel is not a set.
    const byId = new Map(assets.map((a) => [a.id, a]));
    media = mediaIds
      .map((id) => byId.get(id))
      .filter((a): a is NonNullable<typeof a> => Boolean(a))
      .map((a) => ({
        id: a.id,
        publicUrl: a.renditions?.[target.platform] ?? a.publicUrl,
        mime: a.mime,
        bytes: a.bytes,
        width: a.width,
        height: a.height,
        altText: overrides.altText?.[a.id] ?? a.altText,
      }));
  }

  return {
    text,
    media,
    link: post.baseContent.link,
    firstComment: overrides.firstComment,
  };
}

/* ------------------------------------------------------------------ *
 * Tokens
 * ------------------------------------------------------------------ */

type TokenBundle = {
  accessToken: string;
  connectionId: string;
};

/**
 * Hand the adapter the *correct* token for this destination: a Page token for
 * Facebook and Instagram, the member token for LinkedIn. Adapters never reach
 * into the database, so all of that resolution happens here.
 */
async function resolveToken(target: PostTarget): Promise<TokenBundle> {
  const [account] = await db
    .select()
    .from(socialAccounts)
    .where(eq(socialAccounts.id, target.socialAccountId))
    .limit(1);

  if (!account) throw new Error("This account has been disconnected.");

  const [connection] = await db
    .select()
    .from(platformConnections)
    .where(eq(platformConnections.id, account.connectionId))
    .limit(1);

  if (!connection) throw new Error("This connection has been removed.");

  // Proactive refresh: waiting for a 401 means a user's scheduled post is the
  // thing that discovers the token died.
  const expiresSoon =
    connection.tokenExpiresAt &&
    connection.tokenExpiresAt.getTime() - Date.now() <
      REFRESH_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  let accessToken = open(connection.accessTokenEnc);

  if (expiresSoon) {
    const auth = providerFor(connection.provider);
    if (auth.refresh) {
      try {
        const renewed = await auth.refresh({
          providerUserId: connection.providerUserId,
          displayName: connection.displayName,
          accessToken,
          refreshToken: connection.refreshTokenEnc
            ? open(connection.refreshTokenEnc)
            : null,
          expiresAt: connection.tokenExpiresAt,
          scopes: connection.scopes,
        });

        accessToken = renewed.accessToken;
        await db
          .update(platformConnections)
          .set({
            accessTokenEnc: seal(renewed.accessToken),
            refreshTokenEnc: renewed.refreshToken
              ? seal(renewed.refreshToken)
              : connection.refreshTokenEnc,
            tokenExpiresAt: renewed.expiresAt ?? null,
            status: "active",
            lastError: null,
            updatedAt: new Date(),
          })
          .where(eq(platformConnections.id, connection.id));
      } catch (error) {
        await db
          .update(platformConnections)
          .set({
            status: "needs_reauth",
            lastError: (error as Error).message,
            updatedAt: new Date(),
          })
          .where(eq(platformConnections.id, connection.id));
        // Fall through: the existing token may still have hours left on it.
      }
    }
  }

  // Facebook and Instagram publish with the Page's own token, not the user's.
  const pageToken = account.pageTokenEnc ? open(account.pageTokenEnc) : null;

  return {
    accessToken: pageToken ?? accessToken,
    connectionId: connection.id,
  };
}

/* ------------------------------------------------------------------ *
 * Persisting an outcome
 * ------------------------------------------------------------------ */

async function persist(
  target: PostTarget,
  outcome: PublishOutcome,
): Promise<void> {
  const attempt = target.attemptCount + 1;

  if (outcome.kind === "published") {
    await db
      .update(postTargets)
      .set({
        status: "published",
        remotePostId: outcome.remotePostId,
        permalink: outcome.permalink,
        publishedAt: new Date(),
        attemptCount: attempt,
        claimedAt: null,
        errorCode: null,
        errorMessage: null,
      })
      .where(eq(postTargets.id, target.id));
    return;
  }

  if (outcome.kind === "pending") {
    // The container id is written here, before the next tick can run. That
    // ordering is what makes an interrupted publish resume instead of duplicate.
    await db
      .update(postTargets)
      .set({
        status: "awaiting_remote",
        remoteContainerId: outcome.remoteContainerId,
        attemptCount: attempt,
        claimedAt: null,
        nextAttemptAt: new Date(
          Date.now() + (outcome.retryAfterSeconds ?? 30) * 1000,
        ),
      })
      .where(eq(postTargets.id, target.id));
    return;
  }

  if (outcome.needsAuth) {
    await db
      .update(postTargets)
      .set({
        status: "needs_auth",
        attemptCount: attempt,
        claimedAt: null,
        errorCode: outcome.code,
        errorMessage: outcome.message,
      })
      .where(eq(postTargets.id, target.id));
    return;
  }

  const exhausted = !outcome.retryable || attempt >= MAX_ATTEMPTS;
  const backoff = BACKOFF_SECONDS[Math.min(attempt - 1, MAX_ATTEMPTS - 1)];
  // Jitter stops a batch of targets that failed together from retrying together.
  const jitter = Math.floor(backoff * 0.2 * Math.random());

  await db
    .update(postTargets)
    .set({
      status: exhausted ? "failed" : "retrying",
      attemptCount: attempt,
      claimedAt: null,
      nextAttemptAt: exhausted
        ? null
        : new Date(Date.now() + (backoff + jitter) * 1000),
      errorCode: outcome.code,
      errorMessage: outcome.message,
    })
    .where(eq(postTargets.id, target.id));
}

/** Roll the parent post up once every one of its targets is settled. */
async function settlePost(postId: string): Promise<void> {
  const siblings = await db
    .select({ status: postTargets.status })
    .from(postTargets)
    .where(eq(postTargets.postId, postId));

  const terminal = new Set(["published", "failed", "canceled", "needs_auth"]);
  const allDone = siblings.every((s) => terminal.has(s.status));

  await db
    .update(posts)
    .set({ status: allDone ? "done" : "publishing", updatedAt: new Date() })
    .where(eq(posts.id, postId));
}

/* ------------------------------------------------------------------ *
 * The tick
 * ------------------------------------------------------------------ */

export async function runTick(limit = 25): Promise<TickResult> {
  const result: TickResult = {
    claimed: 0,
    published: 0,
    pending: 0,
    failed: 0,
    needsAuth: 0,
    errors: [],
  };

  const due = await claimDue(limit);
  result.claimed = due.length;

  for (const target of due) {
    try {
      const [account] = await db
        .select()
        .from(socialAccounts)
        .where(eq(socialAccounts.id, target.socialAccountId))
        .limit(1);

      if (!account) {
        await persist(target, {
          kind: "failed",
          code: "account_removed",
          message: "The destination account was disconnected before this post went out.",
          retryable: false,
        });
        result.failed++;
        continue;
      }

      const content = await resolveContent(target);

      // The same validator the composer runs. Catching it here too means a
      // draft edited after scheduling cannot slip through in a broken state.
      const check = validateForPlatform(target.platform, content);
      if (!check.ok) {
        await persist(target, {
          kind: "failed",
          code: "validation_failed",
          message: check.issues
            .filter((i) => i.severity === "error")
            .map((i) => i.message)
            .join(" "),
          retryable: false,
        });
        result.failed++;
        continue;
      }

      const { accessToken } = await resolveToken(target);
      const adapter = adapterFor(target.platform);

      const log = async (entry: AttemptLog) => {
        await db.insert(publishAttempts).values({
          postTargetId: target.id,
          attemptNo: target.attemptCount + 1,
          step: entry.step,
          outcome: entry.outcome,
          httpStatus: entry.httpStatus ?? null,
          requestId: entry.requestId ?? null,
          responseBody: entry.responseBody?.slice(0, 4000) ?? null,
          finishedAt: new Date(),
        });
      };

      const outcome = await adapter.advance({
        target,
        account,
        accessToken,
        content,
        log,
      });

      await persist(target, outcome);
      await settlePost(target.postId);

      if (outcome.kind === "published") result.published++;
      else if (outcome.kind === "pending") result.pending++;
      else if (outcome.needsAuth) result.needsAuth++;
      else result.failed++;
    } catch (error) {
      const message = (error as Error).message;
      result.errors.push(`${target.id}: ${message}`);
      await persist(target, {
        kind: "failed",
        code: "dispatcher_error",
        message,
        retryable: true,
      });
      result.failed++;
    }
  }

  return result;
}

/** Cancel every target of a post that has not gone out yet. */
export async function cancelPost(postId: string): Promise<number> {
  const updated = await db
    .update(postTargets)
    .set({ status: "canceled", nextAttemptAt: null })
    .where(
      and(
        eq(postTargets.postId, postId),
        inArray(postTargets.status, ["draft", "scheduled", "retrying"]),
      ),
    )
    .returning({ id: postTargets.id });

  await settlePost(postId);
  return updated.length;
}
