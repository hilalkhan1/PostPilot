import { NextResponse, type NextRequest } from "next/server";
import { GATE_COOKIE, gatePassword, verifyGateTicket } from "@/lib/gate";

/**
 * Everything behind the shared-password gate.
 *
 * Deliberately a deny-by-default matcher: the exceptions are listed rather than
 * the protected paths, so a route added later is covered without anyone having
 * to remember to protect it.
 */
export const config = {
  matcher: [
    /*
     * Everything except:
     *   api/cron   — carries its own bearer secret, and an external scheduler
     *                cannot complete a password form
     *   api/gate   — the gate itself, or there is no way in
     *   api/health — returns booleans only, never a value; being able to check
     *                a deployment without unlocking it is the point of it
     *   gate       — the form page
     *   _next, favicon, icon, and static assets
     */
    "/((?!api/cron|api/gate|api/health|gate|_next/static|_next/image|favicon.ico|icon.svg|apple-touch-icon.png|logo-.*\\.(?:svg|png)).*)",
  ],
};

export async function middleware(request: NextRequest) {
  const password = gatePassword();

  // No password configured means no gate — local development stays frictionless.
  // The health endpoint reports this so an unprotected deployment is visible.
  if (!password) return NextResponse.next();

  const ticket = request.cookies.get(GATE_COOKIE)?.value;
  if (await verifyGateTicket(ticket, password)) return NextResponse.next();

  // An unauthenticated API call should get a status code, not an HTML form.
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Locked" }, { status: 401 });
  }

  const gate = new URL("/gate", request.nextUrl.origin);
  const target = request.nextUrl.pathname + request.nextUrl.search;
  if (target !== "/") gate.searchParams.set("next", target);
  return NextResponse.redirect(gate);
}
