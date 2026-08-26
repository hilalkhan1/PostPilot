import { createHmac, randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { memberships, organizations } from "@/db/schema";
import { auth } from "./auth-server";
import { env } from "./env";
import { safeEqual } from "./crypto";

/**
 * Workspace resolution and platform OAuth state.
 *
 * Sign-in itself is better-auth's job (`auth-server.ts`). This maps the
 * signed-in user onto the workspace whose data they may see, and holds the
 * CSRF state for connecting LinkedIn and Meta accounts — a different kind of
 * identity from "who is logged in", which is why the two live apart.
 */

export type Session = {
  userId: string;
  orgId: string;
  email: string;
  name: string;
};

/**
 * The signed-in user, or null.
 *
 * Every workspace-scoped query hangs off the orgId this returns, so this is the
 * single place that decides whose data a request may see. It replaces a
 * development stub that returned one shared workspace to anybody who asked —
 * which, on a public URL, meant everybody.
 */
export async function getSession(): Promise<Session | null> {
  const result = await auth.api.getSession({ headers: await headers() });
  if (!result?.user) return null;

  const { user } = result;

  const [existing] = await db
    .select({ orgId: memberships.orgId })
    .from(memberships)
    .where(eq(memberships.userId, user.id))
    .limit(1);

  if (existing) {
    return {
      userId: user.id,
      orgId: existing.orgId,
      email: user.email,
      name: user.name,
    };
  }

  /*
   * First sign-in: give this user their own workspace.
   *
   * Done here rather than in a sign-up hook so a user created by any route —
   * a future invite, a social provider, a seed script — still lands in a
   * workspace instead of a half-state with no org.
   */
  const [org] = await db
    .insert(organizations)
    .values({ name: `${user.name || user.email}'s workspace` })
    .returning();

  await db
    .insert(memberships)
    .values({ orgId: org.id, userId: user.id, role: "owner" });

  return {
    userId: user.id,
    orgId: org.id,
    email: user.email,
    name: user.name,
  };
}

/** For pages and routes that cannot run without a user. */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  return session;
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
