import { NextResponse, type NextRequest } from "next/server";
import { providerFor } from "@/adapters";
import type { Provider } from "@/db/schema";
import { isProviderConfigured } from "@/lib/env";
import {
  createOAuthState,
  redirectUriFor,
  setOAuthStateCookie,
} from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPPORTED: Provider[] = ["linkedin", "meta"];

/** Kicks off an OAuth flow: mint a signed state, stash it, bounce the user. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;

  if (!SUPPORTED.includes(provider as Provider)) {
    return NextResponse.json(
      { error: `Unknown provider "${provider}".` },
      { status: 404 },
    );
  }

  if (!isProviderConfigured(provider as Provider)) {
    const url = new URL("/", request.nextUrl.origin);
    url.searchParams.set("error", `${provider}_not_configured`);
    return NextResponse.redirect(url);
  }

  const auth = providerFor(provider as Provider);
  const state = createOAuthState(provider);

  // The cookie must be attached to this very response — see setOAuthStateCookie.
  const response = NextResponse.redirect(
    auth.getAuthUrl(state, redirectUriFor(provider)),
  );
  setOAuthStateCookie(response, provider, state);
  return response;
}
