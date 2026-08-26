/**
 * Environment access with an early, readable failure.
 *
 * Only DATABASE_URL and ENCRYPTION_KEY are required to boot. Every platform
 * credential is optional so you can run the app with just LinkedIn configured
 * and add Meta later without the whole thing refusing to start.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== "" ? value : undefined;
}

export const env = {
  get DATABASE_URL() {
    return required("DATABASE_URL");
  },
  /** 32 bytes, base64-encoded. Generate: openssl rand -base64 32 */
  get ENCRYPTION_KEY() {
    return required("ENCRYPTION_KEY");
  },
  get APP_URL() {
    return process.env.APP_URL ?? "http://localhost:3000";
  },
  /** Shared secret the external cron must present. */
  get CRON_SECRET() {
    return required("CRON_SECRET");
  },

  // --- LinkedIn ---
  get LINKEDIN_CLIENT_ID() {
    return optional("LINKEDIN_CLIENT_ID");
  },
  get LINKEDIN_CLIENT_SECRET() {
    return optional("LINKEDIN_CLIENT_SECRET");
  },

  // --- Meta (covers Facebook Pages and Instagram) ---
  get META_APP_ID() {
    return optional("META_APP_ID");
  },
  get META_APP_SECRET() {
    return optional("META_APP_SECRET");
  },
  get META_API_VERSION() {
    return process.env.META_API_VERSION ?? "v21.0";
  },

  // --- Supabase Storage ---
  get SUPABASE_URL() {
    return optional("SUPABASE_URL");
  },
  get SUPABASE_SERVICE_KEY() {
    return optional("SUPABASE_SERVICE_KEY");
  },
  get SUPABASE_BUCKET() {
    return process.env.SUPABASE_BUCKET ?? "media";
  },
} as const;

/** True when a provider has enough configuration to attempt an OAuth flow. */
export function isProviderConfigured(provider: "meta" | "linkedin"): boolean {
  if (provider === "linkedin") {
    return Boolean(env.LINKEDIN_CLIENT_ID && env.LINKEDIN_CLIENT_SECRET);
  }
  return Boolean(env.META_APP_ID && env.META_APP_SECRET);
}
