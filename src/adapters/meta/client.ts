import { env } from "@/lib/env";
import { PlatformError } from "../types";

export const GRAPH = "https://graph.facebook.com";

export function graphUrl(path: string): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${GRAPH}/${env.META_API_VERSION}${clean}`;
}

type MetaErrorBody = {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    error_user_title?: string;
    error_user_msg?: string;
    fbtrace_id?: string;
  };
};

/** Codes that mean "the token is dead" — retrying cannot help. */
const AUTH_CODES = new Set([102, 190, 458, 459, 463, 467]);

/** Codes that mean "you are going too fast" — retrying is exactly right. */
const RATE_LIMIT_CODES = new Set([4, 17, 32, 341, 613]);

/** Codes that mean "transient upstream wobble". */
const TRANSIENT_CODES = new Set([1, 2]);

/** Codes that mean "your app is not allowed to do this" — a permanent no. */
const PERMISSION_CODES = new Set([10, 200, 803]);

export function classifyMetaError(
  status: number,
  raw: string,
): PlatformError {
  let body: MetaErrorBody = {};
  try {
    body = JSON.parse(raw) as MetaErrorBody;
  } catch {
    /* fall through to the status-based branches */
  }

  const err = body.error ?? {};
  const code = err.code;
  const subcode = err.error_subcode;
  // error_user_msg is the human-readable one Meta intends to be shown.
  const message =
    err.error_user_msg ?? err.message ?? raw.slice(0, 400) ?? "Unknown error";
  const label = code ? `meta_${code}${subcode ? `_${subcode}` : ""}` : `http_${status}`;

  if (code && AUTH_CODES.has(code)) {
    return new PlatformError(
      "needs_auth",
      "Meta rejected the access token. The account needs to be reconnected.",
      false,
      true,
      status,
      raw,
    );
  }

  if (code && RATE_LIMIT_CODES.has(code)) {
    return new PlatformError(
      "rate_limited",
      `Meta rate limit reached: ${message}. This will retry automatically.`,
      true,
      false,
      status,
      raw,
    );
  }

  if (code && TRANSIENT_CODES.has(code)) {
    return new PlatformError(
      label,
      `Meta reported a temporary problem: ${message}. This will retry automatically.`,
      true,
      false,
      status,
      raw,
    );
  }

  if (code && PERMISSION_CODES.has(code)) {
    return new PlatformError(
      label,
      `Meta refused this action: ${message}. Check the app's permissions and that the account has a role on the app while it is in Development mode.`,
      false,
      false,
      status,
      raw,
    );
  }

  if (status >= 500) {
    return new PlatformError(
      label,
      `Meta returned ${status}. This will retry automatically.`,
      true,
      false,
      status,
      raw,
    );
  }

  return new PlatformError(label, message, false, false, status, raw);
}

export async function graphFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<{ data: T; status: number; raw: string }> {
  const url = path.startsWith("http") ? path : graphUrl(path);

  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (cause) {
    throw new PlatformError(
      "network_error",
      `Could not reach Meta: ${(cause as Error).message}`,
      true,
    );
  }

  const raw = await response.text();
  if (!response.ok) throw classifyMetaError(response.status, raw);

  let data: T;
  try {
    data = raw ? (JSON.parse(raw) as T) : ({} as T);
  } catch {
    data = {} as T;
  }
  return { data, status: response.status, raw };
}

/** POST with form encoding, which is what the Graph API expects for writes. */
export async function graphPost<T>(
  path: string,
  params: Record<string, string>,
): Promise<{ data: T; status: number; raw: string }> {
  return graphFetch<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
}
