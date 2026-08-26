import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/db";
import { safeEqual } from "@/lib/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Configuration and connectivity check.
 *
 * The dashboard renders dynamically and touches the database on first paint, so
 * a missing variable or an unmigrated schema surfaces as an opaque "server-side
 * exception" digest with nothing actionable in it. This reports which of the
 * three failure classes you are actually in.
 *
 * Unauthenticated callers get booleans only — never a value, a hostname or a
 * connection string. Pass the cron bearer for error detail:
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://your-app/api/health
 */
export async function GET(request: NextRequest) {
  const header = request.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  const verbose = Boolean(
    secret && header?.startsWith("Bearer ") && safeEqual(header.slice(7), secret),
  );

  const env = {
    DATABASE_URL: Boolean(process.env.DATABASE_URL),
    ENCRYPTION_KEY: Boolean(process.env.ENCRYPTION_KEY),
    CRON_SECRET: Boolean(process.env.CRON_SECRET),
    APP_URL: Boolean(process.env.APP_URL),
    LINKEDIN_CLIENT_ID: Boolean(process.env.LINKEDIN_CLIENT_ID),
    LINKEDIN_CLIENT_SECRET: Boolean(process.env.LINKEDIN_CLIENT_SECRET),
    META_APP_ID: Boolean(process.env.META_APP_ID),
    META_APP_SECRET: Boolean(process.env.META_APP_SECRET),
    SUPABASE_URL: Boolean(process.env.SUPABASE_URL),
    SUPABASE_SERVICE_KEY: Boolean(process.env.SUPABASE_SERVICE_KEY),
  };

  const missing = (["DATABASE_URL", "ENCRYPTION_KEY", "CRON_SECRET"] as const).filter(
    (key) => !env[key],
  );

  // A 32-byte key is the difference between working and a boot-time throw, and
  // it is the value most often mangled by pasting quotes into a Vercel field.
  let keyBytes: number | null = null;
  if (process.env.ENCRYPTION_KEY) {
    try {
      keyBytes = Buffer.from(process.env.ENCRYPTION_KEY, "base64").length;
    } catch {
      keyBytes = -1;
    }
  }

  let database: "ok" | "unreachable" | "no_schema" | "skipped" = "skipped";
  let detail: string | null = null;

  if (env.DATABASE_URL) {
    try {
      await sql`SELECT 1`;
      try {
        await sql`SELECT 1 FROM users LIMIT 1`;
        database = "ok";
      } catch (error) {
        database = "no_schema";
        detail = (error as Error).message;
      }
    } catch (error) {
      database = "unreachable";
      detail = (error as Error).message;
    }
  }

  const ok =
    missing.length === 0 && database === "ok" && keyBytes === 32;

  const hints: string[] = [];
  if (missing.length > 0) {
    hints.push(
      `Set ${missing.join(", ")} in Vercel → Settings → Environment Variables, then redeploy. Changing a variable does not affect the deployment already running.`,
    );
  }
  if (keyBytes !== null && keyBytes !== 32) {
    hints.push(
      `ENCRYPTION_KEY decodes to ${keyBytes} bytes, not 32. Most likely the surrounding quotes were pasted into Vercel, or the trailing "=" was trimmed.`,
    );
  }
  if (database === "no_schema") {
    hints.push(
      'Tables are missing. Run "npm run db:push" locally against the same DATABASE_URL.',
    );
  }
  if (database === "unreachable") {
    hints.push(
      "Could not connect. Check you used Neon's POOLED connection string (the host contains -pooler) and that it ends with ?sslmode=require.",
    );
  }

  return NextResponse.json(
    {
      ok,
      database,
      encryptionKeyBytes: keyBytes,
      env,
      hints,
      ...(verbose && detail ? { detail } : {}),
    },
    { status: ok ? 200 : 503 },
  );
}
