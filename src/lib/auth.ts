import { createHmac, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
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

const DEV_EMAIL = process.env.DEV_USER_EMAIL ?? "you@localhost";
const DEV_ORG = process.env.DEV_ORG_NAME ?? "My workspace";

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

const STATE_COOKIE = "pp_oauth_state";

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

export async function storeOAuthState(state: string): Promise<void> {
  const jar = await cookies();
  jar.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 10 * 60,
  });
}

export async function consumeOAuthState(): Promise<string | null> {
  const jar = await cookies();
  const value = jar.get(STATE_COOKIE)?.value ?? null;
  if (value) jar.delete(STATE_COOKIE);
  return value;
}

export function redirectUriFor(provider: string): string {
  return `${env.APP_URL}/api/connect/${provider}/callback`;
}
