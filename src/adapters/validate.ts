import type { Platform } from "@/db/schema";
import { capabilitiesFor } from "./capabilities";
import type { ResolvedContent, ValidationIssue, ValidationResult } from "./types";

/**
 * One validator, driven entirely by the capability table.
 *
 * This runs in the composer *and* in the dispatcher. Running the same code in
 * both places is the whole point: a caption that is too long should be caught
 * while the user is typing, not at 3am by a cron tick.
 */
export function validateForPlatform(
  platform: Platform,
  content: ResolvedContent,
): ValidationResult {
  const caps = capabilitiesFor(platform);
  const issues: ValidationIssue[] = [];

  const text = content.text ?? "";
  const media = content.media ?? [];

  /* --- text --- */
  if (text.length > caps.maxTextLength) {
    issues.push({
      field: "text",
      severity: "error",
      message: `${caps.label} allows ${caps.maxTextLength.toLocaleString()} characters. This is ${(text.length - caps.maxTextLength).toLocaleString()} over.`,
    });
  }

  if (text.trim() === "" && media.length === 0) {
    issues.push({
      field: "text",
      severity: "error",
      message: "Add some text or an image before publishing.",
    });
  }

  if (caps.hashtagLimit !== null) {
    const hashtags = text.match(/#[\p{L}\p{N}_]+/gu) ?? [];
    if (hashtags.length > caps.hashtagLimit) {
      issues.push({
        field: "text",
        severity: "error",
        message: `${caps.label} allows ${caps.hashtagLimit} hashtags. This has ${hashtags.length}.`,
      });
    }
  }

  if (!caps.supportsLinkPreview && /https?:\/\//.test(text)) {
    issues.push({
      field: "text",
      severity: "warning",
      message: `Links are not clickable on ${caps.label} — readers will have to type it out.`,
    });
  }

  /* --- media count --- */
  if (media.length < caps.minMedia) {
    issues.push({
      field: "media",
      severity: "error",
      message: `${caps.label} requires at least ${caps.minMedia} image${caps.minMedia === 1 ? "" : "s"}.`,
    });
  }

  if (media.length > caps.maxMedia) {
    issues.push({
      field: "media",
      severity: "error",
      message: `${caps.label} accepts at most ${caps.maxMedia} image${caps.maxMedia === 1 ? "" : "s"}. This has ${media.length}.`,
    });
  }

  /* --- per-asset checks --- */
  for (const asset of media) {
    if (!caps.acceptedMime.includes(asset.mime)) {
      const accepted = caps.acceptedMime
        .map((m) => m.replace("image/", "").toUpperCase())
        .join(" or ");
      issues.push({
        field: "media",
        severity: "error",
        message: `${caps.label} only accepts ${accepted}. Convert this ${asset.mime.replace("image/", "").toUpperCase()} file first.`,
      });
    }

    if (asset.bytes > caps.maxImageBytes) {
      issues.push({
        field: "media",
        severity: "error",
        message: `${caps.label} caps images at ${Math.round(caps.maxImageBytes / (1024 * 1024))} MB. This one is ${(asset.bytes / (1024 * 1024)).toFixed(1)} MB.`,
      });
    }

    if (caps.aspectRatioRange && asset.width && asset.height) {
      const [min, max] = caps.aspectRatioRange;
      const ratio = asset.width / asset.height;
      if (ratio < min || ratio > max) {
        issues.push({
          field: "media",
          severity: "error",
          message: `${caps.label} needs an aspect ratio between ${min}:1 and ${max}:1. This image is ${ratio.toFixed(2)}:1 — crop it before scheduling.`,
        });
      }
    }

    if (caps.supportsAltText && !asset.altText) {
      issues.push({
        field: "media",
        severity: "warning",
        message: "No alt text — screen readers will skip this image.",
      });
    }
  }

  /* --- overrides that will be silently dropped --- */
  if (content.firstComment && !caps.supportsFirstComment) {
    issues.push({
      field: "text",
      severity: "warning",
      message: `${caps.label} has no first comment — that text will not be posted.`,
    });
  }

  return { ok: !issues.some((i) => i.severity === "error"), issues };
}

/** Convenience for the composer: validate one draft against many platforms. */
export function validateAll(
  platforms: Platform[],
  contentFor: (platform: Platform) => ResolvedContent,
): Record<string, ValidationResult> {
  const out: Record<string, ValidationResult> = {};
  for (const platform of platforms) {
    out[platform] = validateForPlatform(platform, contentFor(platform));
  }
  return out;
}
