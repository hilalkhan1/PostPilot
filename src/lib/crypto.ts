import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { env } from "./env";

/**
 * AES-256-GCM envelope encryption for platform tokens.
 *
 * Sealed values are versioned (`v1.<iv>.<tag>.<ciphertext>`) so a future key
 * rotation can recognise and re-wrap old records rather than guessing.
 */

const VERSION = "v1";
const IV_BYTES = 12; // 96-bit nonce, the GCM default

let cachedKey: Buffer | null = null;

function key(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = Buffer.from(env.ENCRYPTION_KEY, "base64");
  if (raw.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY must decode to exactly 32 bytes (got ${raw.length}). Generate one with: openssl rand -base64 32`,
    );
  }
  cachedKey = raw;
  return raw;
}

export function seal(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function open(sealed: string): string {
  const parts = sealed.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("Malformed sealed value: unrecognised envelope format.");
  }
  const [, ivB64, tagB64, ctB64] = parts;
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key(),
    Buffer.from(ivB64, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/** `open`, but returns null instead of throwing on a tampered or stale value. */
export function tryOpen(sealed: string | null | undefined): string | null {
  if (!sealed) return null;
  try {
    return open(sealed);
  } catch {
    return null;
  }
}

/** Constant-time comparison for the cron bearer secret. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Keep tokens out of logs and Sentry payloads. */
export function redact(value: string | null | undefined): string {
  if (!value) return "(none)";
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}
