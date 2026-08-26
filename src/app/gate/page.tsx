import { LogoMark } from "@/components/logo";
import { gatePassword } from "@/lib/gate";

export const dynamic = "force-dynamic";

export default async function Gate({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const configured = gatePassword() !== null;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6">
      <div className="grid gap-2">
        <LogoMark size={36} />
        <h1 className="text-2xl font-bold tracking-tight">PostPilot</h1>
        <p className="text-sm text-muted">
          This workspace is private. Enter the password to continue.
        </p>
      </div>

      {!configured ? (
        <p className="rounded border border-warn bg-warn-soft px-4 py-3 text-sm text-warn">
          No <code>SITE_PASSWORD</code> is set, so there is nothing to unlock —
          and nothing protecting this deployment either.
        </p>
      ) : (
        <form
          action="/api/gate"
          method="POST"
          className="grid gap-3 rounded-md border border-line bg-surface p-5"
        >
          <label htmlFor="password" className="eyebrow">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoFocus
            autoComplete="current-password"
            className="w-full rounded border border-line bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <input type="hidden" name="next" value={params.next ?? "/"} />

          {params.error && (
            <p className="rounded border border-crit bg-crit-soft px-3 py-2 text-xs text-crit">
              That password is not right.
            </p>
          )}

          <button
            type="submit"
            className="rounded bg-accent px-4 py-2 text-sm font-medium text-white"
          >
            Unlock
          </button>
        </form>
      )}

      <p className="text-xs text-muted">
        A shared password, not an account. Everyone who unlocks it shares one
        workspace.
      </p>
    </main>
  );
}
