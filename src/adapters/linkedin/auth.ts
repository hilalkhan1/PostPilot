import { env } from "@/lib/env";
import { PlatformError, type DiscoveredAccount, type GrantResult, type ProviderAuth } from "../types";
import { LINKEDIN_OAUTH, linkedInFetch } from "./client";

/**
 * `w_member_social` arrives from the self-serve "Share on LinkedIn" product —
 * no review conversation. Only company Pages need the partner queue, which is
 * why v1 posts to member profiles.
 */
const SCOPES = ["openid", "profile", "email", "w_member_social"];

type TokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  scope?: string;
};

type UserInfo = {
  sub: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  email?: string;
  picture?: string;
};

export const linkedInAuth: ProviderAuth = {
  provider: "linkedin",
  label: "LinkedIn",
  scopes: SCOPES,

  getAuthUrl(state, redirectUri) {
    if (!env.LINKEDIN_CLIENT_ID) {
      throw new Error(
        "LINKEDIN_CLIENT_ID is not set. Add it to .env.local before connecting LinkedIn.",
      );
    }
    const params = new URLSearchParams({
      response_type: "code",
      client_id: env.LINKEDIN_CLIENT_ID,
      redirect_uri: redirectUri,
      state,
      scope: SCOPES.join(" "),
    });
    return `${LINKEDIN_OAUTH}/authorization?${params}`;
  },

  async exchangeCode(code, redirectUri) {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: env.LINKEDIN_CLIENT_ID!,
      client_secret: env.LINKEDIN_CLIENT_SECRET!,
    });

    // The token endpoint is form-encoded and does NOT take the versioned REST
    // headers, so it bypasses linkedInFetch.
    const response = await fetch(`${LINKEDIN_OAUTH}/accessToken`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    const raw = await response.text();
    if (!response.ok) {
      throw new PlatformError(
        "oauth_exchange_failed",
        `LinkedIn rejected the authorization code: ${raw.slice(0, 300)}`,
        false,
        false,
        response.status,
        raw,
      );
    }

    const token = JSON.parse(raw) as TokenResponse;

    const { data: profile } = await linkedInFetch<UserInfo>("/v2/userinfo", {
      method: "GET",
      accessToken: token.access_token,
    });

    return {
      providerUserId: profile.sub,
      displayName:
        profile.name ??
        [profile.given_name, profile.family_name].filter(Boolean).join(" ") ??
        null,
      accessToken: token.access_token,
      // Refresh tokens are only issued to approved apps. Without one the user
      // reconnects every ~60 days, which the connection health UI must surface.
      refreshToken: token.refresh_token ?? null,
      expiresAt: new Date(Date.now() + token.expires_in * 1000),
      scopes: token.scope?.split(/[\s,]+/) ?? SCOPES,
    };
  },

  /**
   * A LinkedIn grant maps to exactly one destination: the member's own profile.
   * (Company Pages would appear here too, once partner access is granted.)
   */
  async listAccounts(grant): Promise<DiscoveredAccount[]> {
    const { data: profile } = await linkedInFetch<UserInfo>("/v2/userinfo", {
      method: "GET",
      accessToken: grant.accessToken,
    });

    return [
      {
        platform: "linkedin",
        platformAccountId: `urn:li:person:${profile.sub}`,
        displayName: profile.name ?? grant.displayName ?? "LinkedIn profile",
        handle: profile.email ?? null,
        avatarUrl: profile.picture ?? null,
      },
    ];
  },

  async refresh(grant): Promise<GrantResult> {
    if (!grant.refreshToken) {
      throw new PlatformError(
        "needs_auth",
        "LinkedIn did not issue a refresh token for this app, so this connection cannot be renewed automatically. The member needs to reconnect.",
        false,
        true,
      );
    }

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: grant.refreshToken,
      client_id: env.LINKEDIN_CLIENT_ID!,
      client_secret: env.LINKEDIN_CLIENT_SECRET!,
    });

    const response = await fetch(`${LINKEDIN_OAUTH}/accessToken`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    const raw = await response.text();
    if (!response.ok) {
      throw new PlatformError(
        "needs_auth",
        `LinkedIn refused to refresh this token: ${raw.slice(0, 300)}`,
        false,
        true,
        response.status,
        raw,
      );
    }

    const token = JSON.parse(raw) as TokenResponse;
    return {
      ...grant,
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? grant.refreshToken,
      expiresAt: new Date(Date.now() + token.expires_in * 1000),
    };
  },
};
