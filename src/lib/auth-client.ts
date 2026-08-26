"use client";

import { createAuthClient } from "better-auth/react";

/**
 * Browser-side auth. baseURL is left unset so it resolves against the current
 * origin — the app is served from one domain and hardcoding it here is the same
 * class of mistake that broke the OAuth redirect URIs.
 */
export const authClient = createAuthClient();

export const { signIn, signUp, signOut, useSession } = authClient;
