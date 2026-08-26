import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth-server";

export const runtime = "nodejs";

/** Sign-up, sign-in, sign-out, session — all of better-auth's endpoints. */
export const { GET, POST } = toNextJsHandler(auth);
