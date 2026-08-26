/**
 * Shared-password gate.
 *
 * A stopgap in front of the whole app so a public URL is not a public
 * workspace. It is deliberately not user auth — everyone who passes it lands in
 * the same session. Real accounts live in `src/lib/auth.ts`; this stays useful
 * afterwards as a way to keep a staging deployment off the open internet.
 *
 * Uses Web Crypto rather than node:crypto because middleware runs on the Edge
 * runtime, where the node builtin is unavailable.
 */

export const GATE_COOKIE = "pp_gate";

/** The gate is only active when a password is configured. */
export function gatePassword(): string | null {
  const value = process.env.SITE_PASSWORD;
  return value && value.trim() !== "" ? value.trim() : null;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

function toBase64Url(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * The cookie is `<expiry>.<hmac>` — the password itself is never stored in it,
 * so a stolen cookie cannot be turned back into the password, and every ticket
 * expires on its own.
 */
export async function issueGateTicket(
  secret: string,
  ttlSeconds = 30 * 24 * 60 * 60,
): Promise<string> {
  const expires = Date.now() + ttlSeconds * 1000;
  const key = await hmacKey(secret);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(String(expires)),
  );
  return `${expires}.${toBase64Url(signature)}`;
}

export async function verifyGateTicket(
  ticket: string | undefined,
  secret: string,
): Promise<boolean> {
  if (!ticket) return false;

  const separator = ticket.indexOf(".");
  if (separator < 1) return false;

  const expires = ticket.slice(0, separator);
  const signature = ticket.slice(separator + 1);

  const expiresAt = Number(expires);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;

  const key = await hmacKey(secret);
  const expected = toBase64Url(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(expires)),
  );

  return timingSafeEqualString(signature, expected);
}

/** Constant-time string compare — Edge has no crypto.timingSafeEqual. */
function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Same idea, for comparing the submitted password itself. */
export function passwordMatches(submitted: string, actual: string): boolean {
  return timingSafeEqualString(submitted, actual);
}
