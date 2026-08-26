import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/db";
import { accounts, sessions, users, verifications } from "@/db/schema";
import { env } from "./env";

/**
 * Real user accounts.
 *
 * Separate from `auth.ts`, which holds the app's own session/workspace
 * resolution and the platform OAuth state — those are about *publishing*
 * identity, this is about who is signed in.
 *
 * The schema map is required because better-auth expects singular keys
 * (user/session/account/verification) while the Drizzle exports are plural.
 */
export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user: users, session: sessions, account: accounts, verification: verifications },
  }),

  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.APP_URL,

  emailAndPassword: {
    enabled: true,
    // No mail provider is wired up yet, so requiring verification would lock
    // every new account out. Turn this on the moment one exists.
    requireEmailVerification: false,
    minPasswordLength: 10,
  },

  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },

  // Lets server actions and route handlers set the session cookie.
  plugins: [nextCookies()],
});

export type AuthSession = typeof auth.$Infer.Session;
