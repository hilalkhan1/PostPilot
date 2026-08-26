"use client";

import { useMemo, useRef, useState } from "react";
import { CAPABILITIES } from "@/adapters/capabilities";
import { validateForPlatform } from "@/adapters/validate";
import type { ResolvedMedia } from "@/adapters/types";
import type { Platform } from "@/db/schema";
import { PlatformBadge } from "./status-pill";

export type AccountOption = {
  id: string;
  platform: Platform;
  displayName: string;
  handle: string | null;
  status: string;
};

/**
 * The composer renders itself from the capability table — character limits,
 * media requirements, hashtag caps and aspect-ratio rules all come from there.
 * That is what keeps `if (platform === "instagram")` out of this file, and what
 * makes adding a fourth platform a data change rather than a UI change.
 */
export function Composer({ accounts }: { accounts: AccountOption[] }) {
  const [text, setText] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [media, setMedia] = useState<ResolvedMedia[]>([]);
  const [scheduledAt, setScheduledAt] = useState("");
  const [timezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  );
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );
  const fileInput = useRef<HTMLInputElement>(null);

  const selectedAccounts = accounts.filter((a) => selected.includes(a.id));
  const platforms = useMemo(
    () => [...new Set(selectedAccounts.map((a) => a.platform))],
    [selectedAccounts],
  );

  /* Live validation, running the exact code the dispatcher will run later. */
  const checks = useMemo(
    () =>
      platforms.map((platform) => ({
        platform,
        result: validateForPlatform(platform, { text, media }),
      })),
    [platforms, text, media],
  );

  const errors = checks.flatMap((c) =>
    c.result.issues
      .filter((i) => i.severity === "error")
      .map((i) => ({ platform: c.platform, message: i.message })),
  );
  const warnings = checks.flatMap((c) =>
    c.result.issues
      .filter((i) => i.severity === "warning")
      .map((i) => ({ platform: c.platform, message: i.message })),
  );

  /*
   * Why the button is disabled, in the order the user can act on it.
   *
   * Validation only runs over the *selected* platforms, so with nothing
   * selected there are no errors to report and the button sat greyed out with
   * no explanation at all. A disabled control that does not say why is a bug,
   * not a safeguard.
   */
  const blockedReason = uploading
    ? "Waiting for the image to finish uploading."
    : selected.length === 0
      ? "Pick at least one account above."
      : errors.length > 0
        ? `Fix ${errors.length} issue${errors.length === 1 ? "" : "s"} first.`
        : null;

  const canSubmit = blockedReason === null && !busy;

  function toggle(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function handleUpload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setFlash(null);
    try {
      for (const file of Array.from(files)) {
        const body = new FormData();
        body.append("file", file);
        const response = await fetch("/api/media", { method: "POST", body });
        const json = await response.json();
        if (!response.ok) throw new Error(json.error ?? "Upload failed.");
        const a = json.asset;
        setMedia((prev) => [
          ...prev,
          {
            id: a.id,
            publicUrl: a.publicUrl,
            mime: a.mime,
            bytes: a.bytes,
            width: a.width,
            height: a.height,
            altText: a.altText,
          },
        ]);
      }
    } catch (error) {
      setFlash({ kind: "err", text: (error as Error).message });
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function submit() {
    setBusy(true);
    setFlash(null);
    try {
      const response = await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          mediaIds: media.map((m) => m.id),
          accountIds: selected,
          scheduledAt: scheduledAt || undefined,
          timezone,
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Could not create post.");

      setFlash({
        kind: "ok",
        text: json.publishNow
          ? `Published to ${selected.length} account${selected.length === 1 ? "" : "s"}.`
          : `Scheduled for ${new Date(json.post.scheduledAt).toLocaleString()}.`,
      });
      setText("");
      setMedia([]);
      setScheduledAt("");
      setTimeout(() => window.location.reload(), 1200);
    } catch (error) {
      setFlash({ kind: "err", text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (accounts.length === 0) {
    return (
      <div className="rounded border border-line bg-surface p-6">
        <p className="text-sm text-muted">
          Connect an account above and the composer will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-5 rounded border border-line bg-surface p-5">
      {/* ---- destinations ---- */}
      <div className="grid gap-2">
        <span className="eyebrow">Publish to</span>
        <div className="flex flex-wrap gap-2">
          {accounts.map((account) => {
            const on = selected.includes(account.id);
            const dead = account.status !== "active";
            return (
              <button
                key={account.id}
                type="button"
                onClick={() => toggle(account.id)}
                disabled={dead}
                className={`flex items-center gap-2.5 rounded border px-3 py-2 text-left text-sm transition-colors ${
                  on
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-line bg-surface text-ink-2 hover:border-line-strong"
                } ${dead ? "cursor-not-allowed opacity-40" : ""}`}
              >
                <PlatformBadge platform={account.platform} size={22} />
                <span className="grid">
                  <span className="font-medium">{account.displayName}</span>
                  {account.handle && (
                    <span className="text-xs text-muted">{account.handle}</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ---- text ---- */}
      <div className="grid gap-2">
        <span className="eyebrow">Post</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          placeholder="What are you sharing?"
          className="field resize-y leading-relaxed"
        />
        {platforms.length > 0 && (
          <div className="flex flex-wrap gap-3">
            {platforms.map((platform) => {
              const caps = CAPABILITIES[platform];
              const left = caps.maxTextLength - text.length;
              return (
                <span
                  key={platform}
                  className={`tnum font-mono text-xs ${left < 0 ? "text-crit" : left < 50 ? "text-warn" : "text-muted"}`}
                >
                  {caps.label} {left.toLocaleString()}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* ---- media ---- */}
      <div className="grid gap-2">
        <span className="eyebrow">Images</span>
        <div className="flex flex-wrap items-center gap-2">
          {media.map((asset) => (
            <div
              key={asset.id}
              className="relative h-16 w-16 overflow-hidden rounded border border-line"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={asset.publicUrl}
                alt={asset.altText ?? ""}
                className="h-full w-full object-cover"
              />
              <button
                type="button"
                onClick={() =>
                  setMedia((prev) => prev.filter((m) => m.id !== asset.id))
                }
                className="absolute right-0 top-0 bg-crit px-1 text-xs leading-tight text-white"
                aria-label="Remove image"
              >
                ×
              </button>
            </div>
          ))}
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => handleUpload(e.target.files)}
            className="max-w-full text-xs text-muted file:mr-3 file:cursor-pointer file:rounded file:border file:border-line-strong file:bg-surface file:px-3 file:py-1.5 file:font-medium file:text-ink-2 hover:file:border-accent hover:file:text-accent"
          />
          {uploading && <span className="text-xs text-muted">Uploading…</span>}
        </div>
      </div>

      {/* ---- schedule ---- */}
      <div className="grid gap-2">
        <span className="eyebrow">When</span>
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            className="field w-auto"
          />
          <span className="text-xs text-muted">
            {scheduledAt ? timezone : "Leave empty to publish immediately"}
          </span>
          {scheduledAt && (
            <button
              type="button"
              onClick={() => setScheduledAt("")}
              className="text-xs text-accent underline"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* ---- validation ---- */}
      {(errors.length > 0 || warnings.length > 0) && (
        <div className="grid gap-1.5">
          {errors.map((issue, i) => (
            <p
              key={`e${i}`}
              className="rounded border border-crit bg-crit-soft px-3 py-2 text-xs text-crit"
            >
              <strong className="font-mono uppercase">{issue.platform}</strong>{" "}
              {issue.message}
            </p>
          ))}
          {warnings.map((issue, i) => (
            <p
              key={`w${i}`}
              className="rounded border border-warn bg-warn-soft px-3 py-2 text-xs text-warn"
            >
              <strong className="font-mono uppercase">{issue.platform}</strong>{" "}
              {issue.message}
            </p>
          ))}
        </div>
      )}

      {flash && (
        <p
          className={`rounded border px-3 py-2 text-sm ${
            flash.kind === "ok"
              ? "border-ok bg-ok-soft text-ok"
              : "border-crit bg-crit-soft text-crit"
          }`}
        >
          {flash.text}
        </p>
      )}

      <div className="flex items-center gap-3 border-t border-line pt-4">
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className="btn btn-primary"
        >
          {busy
            ? "Working…"
            : scheduledAt
              ? "Schedule"
              : selected.length === 0
                ? "Publish"
                : `Publish to ${selected.length} account${selected.length === 1 ? "" : "s"}`}
        </button>
        {blockedReason && (
          <span className="text-xs text-muted">{blockedReason}</span>
        )}
      </div>
    </div>
  );
}
