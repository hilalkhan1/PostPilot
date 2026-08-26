import { NextResponse, type NextRequest } from "next/server";
import {
  GATE_COOKIE,
  gatePassword,
  issueGateTicket,
  passwordMatches,
} from "@/lib/gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A crude but real brake on guessing: one attempt per second per IP. */
const lastAttempt = new Map<string, number>();

export async function POST(request: NextRequest) {
  const password = gatePassword();
  if (!password) {
    return NextResponse.json(
      { error: "No gate is configured." },
      { status: 400 },
    );
  }

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const previous = lastAttempt.get(ip) ?? 0;
  if (Date.now() - previous < 1000) {
    return NextResponse.json(
      { error: "Too many attempts. Wait a moment." },
      { status: 429 },
    );
  }
  lastAttempt.set(ip, Date.now());

  const form = await request.formData();
  const submitted = String(form.get("password") ?? "");
  const next = String(form.get("next") ?? "/");

  if (!passwordMatches(submitted, password)) {
    const url = new URL("/gate", request.nextUrl.origin);
    url.searchParams.set("error", "1");
    if (next !== "/") url.searchParams.set("next", next);
    return NextResponse.redirect(url, { status: 303 });
  }

  // Only ever redirect to a path on this origin — never to a supplied URL.
  const destination = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  const response = NextResponse.redirect(
    new URL(destination, request.nextUrl.origin),
    { status: 303 },
  );

  response.cookies.set(GATE_COOKIE, await issueGateTicket(password), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  });

  return response;
}
