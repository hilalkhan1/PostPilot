import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { platformConnections, postTargets, posts, socialAccounts } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { isProviderConfigured } from "@/lib/env";
import { isStorageConfigured } from "@/lib/storage";
import { Composer, type AccountOption } from "@/components/composer";
import { LogoMark } from "@/components/logo";
import { PlatformBadge, StatusPill } from "@/components/status-pill";
import { SignOutButton } from "@/components/sign-out";

export const dynamic = "force-dynamic";

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
  const linkedinReady = isProviderConfigured("linkedin");
  const metaReady = isProviderConfigured("meta");
  const storageReady = isStorageConfigured();

  const options: AccountOption[] = accounts
    .filter((a) => a.status !== "revoked")
    .map((a) => ({
      id: a.id,
      platform: a.platform,
      displayName: a.displayName,
      handle: a.handle,
      status: a.status,
    }));

  return (
    <main className="mx-auto grid max-w-4xl gap-8 px-6 py-10">
      {/* ---- masthead ---- */}
      <header className="grid gap-2 border-b border-line pb-5">
        <div className="flex items-center justify-between gap-3">
          <span className="eyebrow">{session.email}</span>
          <SignOutButton />
        </div>
        <h1 className="flex items-center gap-2.5 text-3xl font-bold tracking-tight">
          <LogoMark size={36} />
          PostPilot
        </h1>
        <p className="text-sm text-muted">
          Write once, publish everywhere — now or on a schedule.
        </p>
      </header>

      {/* ---- flash from the OAuth round trip ---- */}
      {params.connected && (
        <p className="rounded border border-ok bg-ok-soft px-4 py-3 text-sm text-ok">
          Connected {params.connected} — found {params.accounts ?? "0"} account
          {params.accounts === "1" ? "" : "s"}.
        </p>
      )}
      {params.error && (
        <p className="rounded border border-crit bg-crit-soft px-4 py-3 text-sm text-crit">
          <strong className="font-mono uppercase">{params.error}</strong>
          {params.detail ? ` — ${params.detail}` : ""}
        </p>
      )}

      {/* ---- setup gaps, stated plainly ---- */}
      {(!linkedinReady || !metaReady || !storageReady) && (
        <section className="grid gap-2 rounded border border-warn bg-warn-soft px-4 py-3 text-sm text-warn">
          <strong className="eyebrow text-warn">Setup</strong>
          <ul className="grid gap-1">
            {!linkedinReady && (
              <li>
                LinkedIn is not configured — set{" "}
                <code>LINKEDIN_CLIENT_ID</code> and{" "}
                <code>LINKEDIN_CLIENT_SECRET</code>.
              </li>
            )}
            {!metaReady && (
              <li>
                Meta is not configured — set <code>META_APP_ID</code> and{" "}
                <code>META_APP_SECRET</code>.
              </li>
            )}
            {!storageReady && (
              <li>
                Storage is not configured — set <code>SUPABASE_URL</code> and{" "}
                <code>SUPABASE_SERVICE_KEY</code>. Facebook and Instagram fetch
                images from a public URL, so they cannot post pictures without it.
              </li>
            )}
          </ul>
        </section>
      )}

      {/* ---- connections ---- */}
      <section className="grid gap-3">
        <h2 className="text-lg font-semibold">Accounts</h2>

        <div className="flex flex-wrap gap-2">
          <a
            href="/api/connect/linkedin"
            className={`rounded border px-4 py-2 text-sm ${
              linkedinReady
                ? "border-line-strong bg-surface hover:border-accent hover:text-accent"
                : "pointer-events-none border-line bg-surface-2 text-muted opacity-50"
            }`}
          >
            Connect LinkedIn
          </a>
          <a
            href="/api/connect/meta"
            className={`rounded border px-4 py-2 text-sm ${
              metaReady
                ? "border-line-strong bg-surface hover:border-accent hover:text-accent"
                : "pointer-events-none border-line bg-surface-2 text-muted opacity-50"
            }`}
          >
            Connect Facebook &amp; Instagram
          </a>
        </div>

        {accounts.length === 0 ? (
          <p className="text-sm text-muted">
            Nothing connected yet. One Meta connection brings in every Page you
            administer and every Instagram Business account linked to them.
          </p>
        ) : (
          <ul className="grid gap-2">
            {accounts.map((account) => {
              const connection = connections.find(
                (c) => c.id === account.connectionId,
              );
              const expires = connection?.tokenExpiresAt;
              return (
                <li
                  key={account.id}
                  className="flex flex-wrap items-center gap-3 rounded border border-line bg-surface px-4 py-3"
                >
                  <PlatformBadge platform={account.platform} />
                  <span className="grid">
                    <span className="text-sm font-medium">
                      {account.displayName}
                    </span>
                    {account.handle && (
                      <span className="text-xs text-muted">
                        {account.handle}
                      </span>
                    )}
                  </span>
                  <span className="ml-auto flex items-center gap-3">
                    {expires && (
                      <span className="tnum text-xs text-muted">
                        token expires {expires.toLocaleDateString()}
                      </span>
                    )}
                    <StatusPill
                      status={
                        account.status === "active" ? "published" : "needs_auth"
                      }
                    />
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ---- composer ---- */}
      <section className="grid gap-3">
        <h2 className="text-lg font-semibold">New post</h2>
        <Composer accounts={options} />
      </section>

      {/* ---- queue ---- */}
      <section className="grid gap-3">
        <h2 className="text-lg font-semibold">Queue</h2>
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
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <p className="max-w-lg whitespace-pre-wrap text-sm text-ink-2">
                      {post.baseContent.text.slice(0, 240) || (
                        <em className="text-muted">No text</em>
                      )}
                      {post.baseContent.text.length > 240 && "…"}
                    </p>
                    <span className="tnum shrink-0 text-xs text-muted">
                      {post.scheduledAt?.toLocaleString() ?? "—"}
                    </span>
                  </div>

                  {/* Per-target rows: this is where partial success becomes visible. */}
                  <ul className="grid gap-1.5 border-t border-line pt-3">
                    {mine.map((target) => {
                      const account = accountById.get(target.socialAccountId);
                      return (
                        <li
                          key={target.id}
                          className="flex flex-wrap items-center gap-2 text-sm"
                        >
                          <PlatformBadge platform={target.platform} />
                          <span className="text-ink-2">
                            {account?.displayName ?? "Disconnected account"}
                          </span>
                          <StatusPill status={target.status} />
                          {target.attemptCount > 1 && (
                            <span className="tnum text-xs text-muted">
                              attempt {target.attemptCount}
                            </span>
                          )}
                          {target.permalink && (
                            <a
                              href={target.permalink}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs text-accent underline"
                            >
                              View
                            </a>
                          )}
                          {target.errorMessage && (
                            <span className="w-full text-xs text-crit">
                              {target.errorMessage}
                            </span>
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
      </section>
    </main>
  );
}
