import type { TargetStatus } from "@/db/schema";

const PILL =
  "inline-flex items-center rounded-sm border px-1.5 py-0.5 font-mono text-[0.625rem] uppercase tracking-[0.08em] whitespace-nowrap";

/**
 * Delivery state of one destination. Colour carries the same information as the
 * word, so a queue of thirty rows can be scanned rather than read.
 */
const TARGET: Record<TargetStatus, { label: string; className: string }> = {
  draft: { label: "Draft", className: "border-line bg-surface-2 text-muted" },
  scheduled: {
    label: "Scheduled",
    className: "border-line-strong bg-surface-2 text-ink-2",
  },
  claimed: {
    label: "Publishing",
    className: "border-accent bg-accent-soft text-accent",
  },
  awaiting_remote: {
    label: "Processing",
    className: "border-accent bg-accent-soft text-accent",
  },
  published: { label: "Published", className: "border-ok bg-ok-soft text-ok" },
  retrying: { label: "Retrying", className: "border-warn bg-warn-soft text-warn" },
  failed: { label: "Failed", className: "border-crit bg-crit-soft text-crit" },
  needs_auth: {
    label: "Reconnect",
    className: "border-warn bg-warn-soft text-warn",
  },
  canceled: { label: "Canceled", className: "border-line bg-surface-2 text-muted" },
};

export function StatusPill({ status }: { status: TargetStatus }) {
  const style = TARGET[status] ?? TARGET.draft;
  return <span className={`${PILL} ${style.className}`}>{style.label}</span>;
}

/**
 * Health of a *connection*, which is a different thing from the state of a
 * post. Reusing the post pill here made an account read "PUBLISHED", which is
 * not a thing an account can be.
 */
const CONNECTION: Record<string, { label: string; className: string }> = {
  active: { label: "Connected", className: "border-ok bg-ok-soft text-ok" },
  expiring: { label: "Expiring", className: "border-warn bg-warn-soft text-warn" },
  needs_reauth: {
    label: "Reconnect",
    className: "border-warn bg-warn-soft text-warn",
  },
  revoked: { label: "Revoked", className: "border-crit bg-crit-soft text-crit" },
};

export function ConnectionPill({ status }: { status: string }) {
  const style = CONNECTION[status] ?? CONNECTION.needs_reauth;
  return <span className={`${PILL} ${style.className}`}>{style.label}</span>;
}

const PLATFORM: Record<string, { short: string; name: string }> = {
  linkedin: { short: "in", name: "LinkedIn" },
  facebook: { short: "f", name: "Facebook" },
  instagram: { short: "ig", name: "Instagram" },
};

export function PlatformBadge({
  platform,
  size = 26,
}: {
  platform: string;
  size?: number;
}) {
  const meta = PLATFORM[platform] ?? { short: platform.slice(0, 2), name: platform };
  return (
    <span
      title={meta.name}
      aria-label={meta.name}
      style={{ width: size, height: size }}
      className="inline-flex shrink-0 items-center justify-center rounded-sm border border-line-strong bg-surface-2 font-mono text-[0.625rem] lowercase text-ink-2"
    >
      {meta.short}
    </span>
  );
}

export function platformName(platform: string): string {
  return PLATFORM[platform]?.name ?? platform;
}
