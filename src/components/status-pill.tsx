import type { TargetStatus } from "@/db/schema";

/**
 * Delivery state, encoded in colour as well as text so a queue of thirty rows
 * can be scanned rather than read.
 */
const STYLES: Record<TargetStatus, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-surface-2 text-muted border-line" },
  scheduled: {
    label: "Scheduled",
    className: "bg-surface-2 text-ink-2 border-line-strong",
  },
  claimed: {
    label: "Publishing",
    className: "bg-accent-soft text-accent border-accent",
  },
  awaiting_remote: {
    label: "Processing",
    className: "bg-accent-soft text-accent border-accent",
  },
  published: { label: "Published", className: "bg-ok-soft text-ok border-ok" },
  retrying: {
    label: "Retrying",
    className: "bg-warn-soft text-warn border-warn",
  },
  failed: { label: "Failed", className: "bg-crit-soft text-crit border-crit" },
  needs_auth: {
    label: "Reconnect",
    className: "bg-warn-soft text-warn border-warn",
  },
  canceled: {
    label: "Canceled",
    className: "bg-surface-2 text-muted border-line",
  },
};

export function StatusPill({ status }: { status: TargetStatus }) {
  const style = STYLES[status] ?? STYLES.draft;
  return (
    <span
      className={`inline-block rounded border px-1.5 py-0.5 font-mono text-[0.65rem] uppercase tracking-wider ${style.className}`}
    >
      {style.label}
    </span>
  );
}

const PLATFORM_LABEL: Record<string, string> = {
  linkedin: "in",
  facebook: "f",
  instagram: "ig",
};

export function PlatformBadge({ platform }: { platform: string }) {
  return (
    <span
      title={platform}
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-line bg-surface-2 font-mono text-[0.65rem] lowercase text-ink-2"
    >
      {PLATFORM_LABEL[platform] ?? platform.slice(0, 2)}
    </span>
  );
}
