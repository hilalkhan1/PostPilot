import { NextResponse, type NextRequest } from "next/server";
import { runTick } from "@/lib/dispatcher";
import { safeEqual } from "@/lib/crypto";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The publisher.
 *
 * An external scheduler (cron-job.org, every 60 seconds) calls this. Vercel's
 * own Hobby cron runs at most once a day inside a one-hour window, which is
 * unusable for a scheduling product — moving the heartbeat off-platform is what
 * makes the free tier work at all.
 *
 * Point cron-job.org at:  https://your-app.vercel.app/api/cron/tick
 * with the header:        Authorization: Bearer <CRON_SECRET>
 */
function authorize(request: NextRequest): boolean {
  const secret = env.CRON_SECRET;

  const header = request.headers.get("authorization");
  if (header?.startsWith("Bearer ")) {
    return safeEqual(header.slice(7), secret);
  }

  // Fallback for cron services that cannot send custom headers. Prefer the
  // header: query strings end up in access logs.
  const key = request.nextUrl.searchParams.get("key");
  return key ? safeEqual(key, secret) : false;
}

async function handle(request: NextRequest) {
  if (!authorize(request)) {
    // Deliberately terse: this endpoint publishes to social media, so it should
    // not confirm anything to an unauthenticated caller.
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const started = Date.now();

  try {
    const result = await runTick(25);
    return NextResponse.json({
      ok: true,
      ms: Date.now() - started,
      ...result,
    });
  } catch (error) {
    console.error("[tick] failed", error);
    return NextResponse.json(
      { ok: false, error: (error as Error).message },
      { status: 500 },
    );
  }
}

export const GET = handle;
export const POST = handle;
