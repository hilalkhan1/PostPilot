import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { platformConnections, postTargets, posts, socialAccounts } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { isProviderConfigured } from "@/lib/env";
import { isStorageConfigured } from "@/lib/storage";
import { Composer, type AccountOption } from "@/components/composer";
import { LogoMark } from "@/components/logo";
import {
  ConnectionPill,
  PlatformBadge,
  StatusPill,
  platformName,
} from "@/components/status-pill";
import { SignOutButton } from "@/components/sign-out";

export const dynamic = "force-dynamic";

/** "23 Oct 2026" — unambiguous, unlike 23/10/2026 against 10/23/2026. */
const day = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});
const dayTime = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * A hairline above the heading, not a card around the content. It gives the
 * page rhythm without wrapping everything in another box.
 */
function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-4">
      <div className="section-rule flex items-baseline gap-2.5 pt-4">
        <h2 className="text-base font-semibold">{title}</h2>
        {count && <span className="eyebrow">{count}</span>}
      </div>
      {children}
    </section>
  );
}

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const session = await requireSession();

  const accounts = await db
    .select()
    .from(socialAccounts)
    .where(eq(socialAccounts.orgId, session.orgId));

  const connections = await db
    .select()
    .from(platformConnections)
    .where(eq(platformConnections.orgId, session.orgId));

  const recent = await db
    .select()
    .from(posts)
    .where(eq(posts.orgId, session.orgId))
    .orderBy(desc(posts.createdAt))
    .limit(15);

  const targets =
    recent.length > 0
      ? await db
          .select()
          .from(postTargets)
          .where(
            inArray(
              postTargets.postId,
              recent.map((p) => p.id),
            ),
          )
      : [];

  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const live = accounts.filter((a) => a.status !== "revoked");

  const gaps = [
    !isProviderConfigured("linkedin") &&
      "LinkedIn — set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET",
    !isProviderConfigured("meta") &&
      "Facebook and Instagram — set META_APP_ID and META_APP_SECRET",
    !isStorageConfigured() &&
      "Image posting — set SUPABASE_URL and SUPABASE_SERVICE_KEY",
  ].filter(Boolean) as string[];

  const options: AccountOption[] = live.map((a) => ({
    id: a.id,
    platform: a.platform,
    displayName: a.displayName,
    handle: a.handle,
    status: a.status,
  }));

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <header className="grid gap-3 pb-8">
        <div className="flex items-baseline justify-between gap-4">
          <span className="eyebrow truncate">{session.email}</span>
          <SignOutButton />
        </div>
        <div className="flex items-center gap-3">
          <LogoMark size={30} />
          <h1
            className="text-2xl font-bold"
            style={{ fontVariationSettings: '"wdth" 112' }}
          >
            PostPilot
          </h1>
        </div>
        <p className="text-sm text-muted">
          Write once, publish everywhere — now or on a schedule.
        </p>
      </header>

      <div className="grid gap-10">
        {params.connected && (
          <p className="rounded border border-ok bg-ok-soft px-4 py-3 text-sm text-ok">
            Connected {params.connected} — found {params.accounts ?? "0"}{" "}
            destination{params.accounts === "1" ? "" : "s"}.
          </p>
        )}
        {params.error && (
          <p className="grid gap-1 rounded border border-crit bg-crit-soft px-4 py-3 text-sm text-crit">
            <span className="font-mono text-xs uppercase tracking-wider">
              {params.error.replace(/_/g, " ")}
            </span>
            {params.detail && <span>{params.detail}</span>}
          </p>
        )}

        {gaps.length > 0 && (
          <div className="grid gap-2 rounded border border-warn bg-warn-soft px-4 py-3">
            <span className="eyebrow text-warn">Not configured</span>
            <ul className="grid gap-1 text-sm text-warn">
              {gaps.map((gap) => (
                <li key={gap}>{gap}</li>
              ))}
            </ul>
          </div>
        )}

        <Section
          title="Accounts"
          count={live.length > 0 ? `${live.length} connected` : undefined}
        >
          {accounts.length === 0 ? (
            <p className="max-w-prose text-sm text-muted">
              Nothing connected yet. One Facebook connection brings in every Page
              you administer and every Instagram Business account linked to them.
            </p>
          ) : (
            /* gap-px over a line-coloured background draws the dividers, so
               each row needs no border of its own. */
            <ul className="grid gap-px overflow-hidden rounded border border-line bg-line">
              {accounts.map((account) => {
                const connection = connections.find(
                  (c) => c.id === account.connectionId,
                );
                const expires = connection?.tokenExpiresAt;
                return (
                  <li
                    key={account.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-surface px-4 py-3"
                  >
                    <PlatformBadge platform={account.platform} />
                    <span className="grid min-w-0">
                      <span className="truncate text-sm font-medium">
                        {account.displayName}
                      </span>
                      <span className="truncate text-xs text-muted">
                        {platformName(account.platform)}
                        {account.handle ? ` · ${account.handle}` : ""}
                      </span>
                    </span>
                    <span className="ml-auto flex items-center gap-3">
                      {expires && (
                        <span className="tnum hidden text-xs text-muted sm:inline">
                          expires {day.format(expires)}
                        </span>
                      )}
                      <ConnectionPill status={account.status} />
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="flex flex-wrap gap-2">
            <a
              href="/api/connect/linkedin"
              className={`btn btn-quiet ${isProviderConfigured("linkedin") ? "" : "pointer-events-none opacity-40"}`}
            >
              Connect LinkedIn
            </a>
            <a
              href="/api/connect/meta"
              className={`btn btn-quiet ${isProviderConfigured("meta") ? "" : "pointer-events-none opacity-40"}`}
            >
              Connect Facebook &amp; Instagram
            </a>
          </div>
        </Section>

        <Section title="New post">
          <Composer accounts={options} />
        </Section>

        <Section
          title="Queue"
          count={recent.length > 0 ? `${recent.length} recent` : undefined}
        >
          {recent.length === 0 ? (
            <p className="text-sm text-muted">Nothing scheduled yet.</p>
          ) : (
            <ul className="grid gap-3">
              {recent.map((post) => {
                const mine = targets.filter((t) => t.postId === post.id);
                return (
                  <li
                    key={post.id}
                    className="grid gap-3 rounded border border-line bg-surface p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                      <p className="max-w-prose whitespace-pre-wrap text-sm text-ink-2">
                        {post.baseContent.text.slice(0, 200) || (
                          <em className="text-muted">No text</em>
                        )}
                        {post.baseContent.text.length > 200 && "…"}
                      </p>
                      {post.scheduledAt && (
                        <span className="tnum shrink-0 font-mono text-xs text-muted">
                          {dayTime.format(post.scheduledAt)}
                        </span>
                      )}
                    </div>

                    <ul className="grid gap-2 border-t border-line pt-3">
                      {mine.map((target) => {
                        const account = accountById.get(target.socialAccountId);
                        return (
                          <li key={target.id} className="grid gap-1">
                            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm">
                              <PlatformBadge platform={target.platform} size={22} />
                              <span className="truncate text-ink-2">
                                {account?.displayName ?? "Disconnected account"}
                              </span>
                              <StatusPill status={target.status} />
                              {target.attemptCount > 1 && (
                                <span className="tnum font-mono text-xs text-muted">
                                  {target.attemptCount} attempts
                                </span>
                              )}
                              {target.permalink && (
                                <a
                                  href={target.permalink}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="ml-auto text-xs text-accent underline underline-offset-2"
                                >
                                  View
                                </a>
                              )}
                            </div>
                            {target.errorMessage && (
                              <p className="pl-[30px] text-xs text-crit">
                                {target.errorMessage}
                              </p>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}
