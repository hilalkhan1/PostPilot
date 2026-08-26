import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { platformConnections, socialAccounts, type Provider } from "@/db/schema";
import { providerFor } from "@/adapters";
import { seal } from "@/lib/crypto";
import {
  consumeOAuthState,
  getSession,
  redirectUriFor,
  verifyOAuthState,
} from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function back(origin: string, params: Record<string, string>) {
  const url = new URL("/", origin);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  const origin = request.nextUrl.origin;
  const query = request.nextUrl.searchParams;

  // The user pressed Cancel, or the provider refused outright.
  const oauthError = query.get("error");
  if (oauthError) {
    return back(origin, {
      error: "connect_declined",
      detail: query.get("error_description") ?? oauthError,
    });
  }

  const code = query.get("code");
  const state = query.get("state");
  const stored = await consumeOAuthState();

  // Three checks, all required: the state must be present, must match the one
  // we issued, and must carry our signature. Skipping any of them allows an
  // attacker to graft their own social account onto someone else's workspace.
  if (
    !code ||
    !state ||
    !stored ||
    state !== stored ||
    !verifyOAuthState(state, provider)
  ) {
    return back(origin, { error: "invalid_state" });
  }

  try {
    const session = await getSession();
    const auth = providerFor(provider as Provider);
    const grant = await auth.exchangeCode(code, redirectUriFor(provider));

    /* ---- the grant: one row, holding the tokens ---- */
    const [connection] = await db
      .insert(platformConnections)
      .values({
        orgId: session.orgId,
        provider: provider as Provider,
        providerUserId: grant.providerUserId,
        displayName: grant.displayName,
        accessTokenEnc: seal(grant.accessToken),
        refreshTokenEnc: grant.refreshToken ? seal(grant.refreshToken) : null,
        tokenExpiresAt: grant.expiresAt ?? null,
        scopes: grant.scopes,
        status: "active",
        lastError: null,
      })
      .onConflictDoUpdate({
        target: [
          platformConnections.orgId,
          platformConnections.provider,
          platformConnections.providerUserId,
        ],
        set: {
          accessTokenEnc: seal(grant.accessToken),
          refreshTokenEnc: grant.refreshToken ? seal(grant.refreshToken) : null,
          tokenExpiresAt: grant.expiresAt ?? null,
          scopes: grant.scopes,
          status: "active",
          lastError: null,
          displayName: grant.displayName,
          updatedAt: new Date(),
        },
      })
      .returning();

    /* ---- the destinations: one grant can unlock many ---- */
    const discovered = await auth.listAccounts(grant);

    for (const account of discovered) {
      await db
        .insert(socialAccounts)
        .values({
          orgId: session.orgId,
          connectionId: connection.id,
          platform: account.platform,
          platformAccountId: account.platformAccountId,
          handle: account.handle ?? null,
          displayName: account.displayName,
          avatarUrl: account.avatarUrl ?? null,
          pageTokenEnc: account.pageToken ? seal(account.pageToken) : null,
          parentPageId: account.parentPageId ?? null,
          status: "active",
        })
        .onConflictDoUpdate({
          target: [
            socialAccounts.orgId,
            socialAccounts.platform,
            socialAccounts.platformAccountId,
          ],
          set: {
            connectionId: connection.id,
            displayName: account.displayName,
            handle: account.handle ?? null,
            avatarUrl: account.avatarUrl ?? null,
            // Page tokens are re-issued on every grant; always take the newest.
            pageTokenEnc: account.pageToken ? seal(account.pageToken) : null,
            parentPageId: account.parentPageId ?? null,
            status: "active",
          },
        });
    }

    /* ---- anything previously connected but no longer granted ---- */
    const stillLive = new Set(discovered.map((a) => a.platformAccountId));
    const existing = await db
      .select()
      .from(socialAccounts)
      .where(
        and(
          eq(socialAccounts.orgId, session.orgId),
          eq(socialAccounts.connectionId, connection.id),
        ),
      );

    for (const account of existing) {
      if (!stillLive.has(account.platformAccountId)) {
        await db
          .update(socialAccounts)
          .set({ status: "revoked" })
          .where(eq(socialAccounts.id, account.id));
      }
    }

    return back(origin, {
      connected: provider,
      accounts: String(discovered.length),
    });
  } catch (error) {
    console.error(`[connect:${provider}] failed`, error);
    return back(origin, {
      error: "connect_failed",
      detail: (error as Error).message.slice(0, 300),
    });
  }
}
