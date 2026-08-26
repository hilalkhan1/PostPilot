import { createHmac, randomBytes } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { memberships, organizations, users } from "@/db/schema";
import { env } from "./env";
import { safeEqual } from "./crypto";

/**
 * The auth seam.
 *
 * Development mode signs you straight into a single workspace so the first
 * milestone — a real post on a real account — is not gated behind wiring up an
 * identity provider. Swapping in Clerk means reimplementing `getSession()` to
 * read `auth()` and map the Clerk user onto a row in `users`; nothing else in
 * the codebase reads the session directly.
 */

export type Session = {
  userId: string;
  orgId: string;
  email: string;
};

// `||` rather than `??`: a hosting dashboard will happily store a variable with
// a blank value, and `??` only falls back on undefined. That produced a
// workspace named "" with a user whose email was "" on the first deploy.
const DEV_EMAIL = process.env.DEV_USER_EMAIL?.trim() || "you@localhost";
const DEV_ORG = process.env.DEV_ORG_NAME?.trim() || "My workspace";

let bootstrapped: Session | null = null;

export async function getSession(): Promise<Session> {
  if (bootstrapped) return bootstrapped;

  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.email, DEV_EMAIL))
    .limit(1);

  if (existing) {
    const [membership] = await db
      .select()
      .from(memberships)
      .where(eq(memberships.userId, existing.id))
      .limit(1);

    if (membership) {
      bootstrapped = {
        userId: existing.id,
        orgId: membership.orgId,
        email: existing.email,
      };
      return bootstrapped;
    }
  }

  // First run: create the workspace so the app is usable immediately.
  const [org] = await db
    .insert(organizations)
    .values({ name: DEV_ORG })
    .returning();

  const [user] =
    existing !== undefined
      ? [existing]
      : await db.insert(users).values({ email: DEV_EMAIL }).returning();

  await db
    .insert(memberships)
    .values({ orgId: org.id, userId: user.id, role: "owner" });

  bootstrapped = { userId: user.id, orgId: org.id, email: user.email };
  return bootstrapped;
}

/* ------------------------------------------------------------------ *
 * OAuth state
 * ------------------------------------------------------------------ */

/**
 * Per-provider so two flows cannot clobber each other. A single shared name
 * meant starting a Meta connect while a LinkedIn one was still open silently
 * destroyed the LinkedIn state.
 */
function stateCookieName(provider: string): string {
  return `pp_oauth_state_${provider}`;
}

/**
 * The `state` parameter is the only thing standing between your users and a
 * CSRF that connects an attacker's social account to their workspace. It is
 * signed with the app secret and echoed through a short-lived cookie so the
 * callback can prove it started the flow.
 */
export function createOAuthState(provider: string): string {
  const nonce = randomBytes(16).toString("base64url");
  const payload = `${provider}.${nonce}`;
  const signature = createHmac("sha256", env.ENCRYPTION_KEY)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyOAuthState(
  state: string,
  provider: string,
): boolean {
  const parts = state.split(".");
  if (parts.length !== 3) return false;
  const [statedProvider, nonce, signature] = parts;
  if (statedProvider !== provider) return false;

  const expected = createHmac("sha256", env.ENCRYPTION_KEY)
    .update(`${statedProvider}.${nonce}`)
    .digest("base64url");

  return safeEqual(signature, expected);
}

/**
 * Set the state cookie on the response itself.
 *
 * `cookies().set()` from next/headers does not reliably attach to a response
 * built with NextResponse.redirect() — the redirect is a fresh object and the
 * mutation is lost. The cookie then never reaches the browser, the callback
 * finds nothing to compare against, and every connect attempt dies on
 * `invalid_state` while looking like a provider-side problem.
 */
export function setOAuthStateCookie(
  response: NextResponse,
  provider: string,
  state: string,
): void {
  response.cookies.set(stateCookieName(provider), state, {
    httpOnly: true,
    // "lax" still travels on the provider's top-level redirect back to us,
    // which is exactly the navigation the callback arrives on.
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    // Long enough to survive a password prompt and a 2FA challenge.
    maxAge: 15 * 60,
  });
}

export function readOAuthState(
  request: NextRequest,
  provider: string,
): string | null {
  return request.cookies.get(stateCookieName(provider))?.value ?? null;
}

export function clearOAuthStateCookie(
  response: NextResponse,
  provider: string,
): void {
  response.cookies.set(stateCookieName(provider), "", { path: "/", maxAge: 0 });
}

export function redirectUriFor(provider: string): string {
  return `${env.APP_URL}/api/connect/${provider}/callback`;
}
