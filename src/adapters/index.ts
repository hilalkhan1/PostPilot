import type { Platform, Provider } from "@/db/schema";
import type { PlatformAdapter, ProviderAuth } from "./types";
import { linkedInAdapter } from "./linkedin/adapter";
import { linkedInAuth } from "./linkedin/auth";
import { facebookAdapter } from "./meta/facebook";
import { instagramAdapter } from "./meta/instagram";
import { metaAuth } from "./meta/auth";

/**
 * The only place that maps a name to an implementation.
 *
 * Adding a platform means adding a row here and a capability entry — never
 * touching the composer, the dispatcher, or the API routes.
 */
export const ADAPTERS: Record<Platform, PlatformAdapter> = {
  linkedin: linkedInAdapter,
  facebook: facebookAdapter,
  instagram: instagramAdapter,
};

export const PROVIDERS: Record<Provider, ProviderAuth> = {
  linkedin: linkedInAuth,
  meta: metaAuth,
};

/** Which destinations a single OAuth grant can unlock. */
export const PLATFORMS_BY_PROVIDER: Record<Provider, Platform[]> = {
  linkedin: ["linkedin"],
  meta: ["facebook", "instagram"],
};

export function adapterFor(platform: Platform): PlatformAdapter {
  const adapter = ADAPTERS[platform];
  if (!adapter) throw new Error(`No adapter registered for "${platform}".`);
  return adapter;
}

export function providerFor(provider: Provider): ProviderAuth {
  const auth = PROVIDERS[provider];
  if (!auth) throw new Error(`No auth provider registered for "${provider}".`);
  return auth;
}

export * from "./types";
export * from "./capabilities";
export * from "./validate";
