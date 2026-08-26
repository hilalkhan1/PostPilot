import { env } from "@/lib/env";
import { PlatformError, type DiscoveredAccount, type ProviderAuth } from "../types";
import { graphFetch, graphUrl } from "./client";

/**
 * One consent screen covers both platforms:
 *   - pages_manage_posts  → publish to a Page
 *   - instagram_content_publish → publish to a linked Instagram Business account
 *
 * While the app sits in Development mode these work for anyone with a role on
 * the app, with no App Review. Review is what opens it to everyone else.
 */
const SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "instagram_basic",
  "instagram_content_publish",
  "business_management",
];

type TokenResponse = {
  access_token: string;
  token_type: string;
  expires_in?: number;
};

type MeResponse = { id: string; name?: string };

type PagesResponse = {
  data: {
    id: string;
    name: string;
    access_token: string;
    picture?: { data?: { url?: string } };
    instagram_business_account?: {
      id: string;
      username?: string;
      name?: string;
      profile_picture_url?: string;
    };
  }[];
};

export const metaAuth: ProviderAuth = {
  provider: "meta",
  label: "Facebook & Instagram",
  scopes: SCOPES,

  getAuthUrl(state, redirectUri) {
    if (!env.META_APP_ID) {
      throw new Error(
        "META_APP_ID is not set. Add it to .env.local before connecting Meta.",
      );
    }
    const params = new URLSearchParams({
      client_id: env.META_APP_ID,
      redirect_uri: redirectUri,
      state,
      response_type: "code",
      scope: SCOPES.join(","),
    });
    return `https://www.facebook.com/${env.META_API_VERSION}/dialog/oauth?${params}`;
  },

  async exchangeCode(code, redirectUri) {
    // Step 1: code → short-lived user token (about one hour).
    const shortParams = new URLSearchParams({
      client_id: env.META_APP_ID!,
      client_secret: env.META_APP_SECRET!,
      redirect_uri: redirectUri,
      code,
    });
    const { data: short } = await graphFetch<TokenResponse>(
      `${graphUrl("/oauth/access_token")}?${shortParams}`,
    );

    // Step 2: exchange it for a long-lived one (about sixty days). Skipping
    // this is the reason so many Meta integrations break an hour after setup.
    const longParams = new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: env.META_APP_ID!,
      client_secret: env.META_APP_SECRET!,
      fb_exchange_token: short.access_token,
    });
    const { data: long } = await graphFetch<TokenResponse>(
      `${graphUrl("/oauth/access_token")}?${longParams}`,
    );

    const { data: me } = await graphFetch<MeResponse>(
      `${graphUrl("/me")}?fields=id,name&access_token=${encodeURIComponent(long.access_token)}`,
    );

    return {
      providerUserId: me.id,
      displayName: me.name ?? null,
      accessToken: long.access_token,
      refreshToken: null, // Meta renews by re-exchanging, not by refresh token
      expiresAt: long.expires_in
        ? new Date(Date.now() + long.expires_in * 1000)
        : null,
      scopes: SCOPES,
    };
  },

  /**
   * The payoff for treating Meta as one provider: a single call returns every
   * Page *and* the Instagram Business account linked to each, along with the
   * per-Page token that both platforms publish with.
   */
  async listAccounts(grant): Promise<DiscoveredAccount[]> {
    const params = new URLSearchParams({
      access_token: grant.accessToken,
      fields:
        "id,name,access_token,picture{url},instagram_business_account{id,username,name,profile_picture_url}",
      limit: "100",
    });

    const { data } = await graphFetch<PagesResponse>(
      `${graphUrl("/me/accounts")}?${params}`,
    );

    const accounts: DiscoveredAccount[] = [];

    for (const page of data.data ?? []) {
      accounts.push({
        platform: "facebook",
        platformAccountId: page.id,
        displayName: page.name,
        handle: null,
        avatarUrl: page.picture?.data?.url ?? null,
        pageToken: page.access_token,
        parentPageId: null,
      });

      const ig = page.instagram_business_account;
      if (ig?.id) {
        accounts.push({
          platform: "instagram",
          platformAccountId: ig.id,
          displayName: ig.name ?? ig.username ?? page.name,
          handle: ig.username ? `@${ig.username}` : null,
          avatarUrl: ig.profile_picture_url ?? null,
          // Instagram publishes with the token of the Page it hangs off.
          pageToken: page.access_token,
          parentPageId: page.id,
        });
      }
    }

    if (accounts.length === 0) {
      throw new PlatformError(
        "no_pages",
        "That Facebook account administers no Pages, so there is nothing to publish to. Create a Page, then connect again. For Instagram, the account must be Business or Creator and linked to that Page.",
        false,
      );
    }

    return accounts;
  },

  /**
   * Long-lived user tokens are extended by re-exchanging them, which works
   * until the grant itself lapses. Page tokens derived from a live user token
   * do not expire, so Pages keep working across this.
   */
  async refresh(grant) {
    const params = new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: env.META_APP_ID!,
      client_secret: env.META_APP_SECRET!,
      fb_exchange_token: grant.accessToken,
    });

    const { data } = await graphFetch<TokenResponse>(
      `${graphUrl("/oauth/access_token")}?${params}`,
    );

    return {
      ...grant,
      accessToken: data.access_token,
      expiresAt: data.expires_in
        ? new Date(Date.now() + data.expires_in * 1000)
        : null,
    };
  },
};
