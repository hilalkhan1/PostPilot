import { PlatformError } from "../types";

export const LINKEDIN_API = "https://api.linkedin.com";
export const LINKEDIN_OAUTH = "https://www.linkedin.com/oauth/v2";

/**
 * LinkedIn versions its REST API by month (`YYYYMM`) and retires versions after
 * roughly a year. Pin it in the environment so an expiry is a config change,
 * not a code change.
 */
export const LINKEDIN_VERSION =
  process.env.LINKEDIN_API_VERSION?.trim() || "202606";

function restHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    "LinkedIn-Version": LINKEDIN_VERSION,
    "X-Restli-Protocol-Version": "2.0.0",
    "Content-Type": "application/json",
  };
}

export type LinkedInResponse<T> = {
  data: T;
  status: number;
  headers: Headers;
  raw: string;
};

/**
 * LinkedIn reports failures as `{ status, message, serviceErrorCode }`, and
 * distinguishing "reconnect this account" from "try again in a minute" is what
 * stops the dispatcher burning retries on a permanent rejection.
 */
export async function linkedInFetch<T>(
  path: string,
  init: RequestInit & { accessToken: string },
): Promise<LinkedInResponse<T>> {
  const { accessToken, ...rest } = init;
  const url = path.startsWith("http") ? path : `${LINKEDIN_API}${path}`;

  let response: Response;
  try {
    response = await fetch(url, {
      ...rest,
      headers: { ...restHeaders(accessToken), ...(rest.headers ?? {}) },
    });
  } catch (cause) {
    throw new PlatformError(
      "network_error",
      `Could not reach LinkedIn: ${(cause as Error).message}`,
      true,
    );
  }

  const raw = await response.text();

  if (!response.ok) {
    throw classifyLinkedInError(response.status, raw);
  }

  let data: T;
  try {
    data = raw ? (JSON.parse(raw) as T) : ({} as T);
  } catch {
    data = {} as T;
  }

  return { data, status: response.status, headers: response.headers, raw };
}

export function classifyLinkedInError(
  status: number,
  raw: string,
): PlatformError {
  let message = raw.slice(0, 500);
  let serviceCode: number | undefined;

  try {
    const body = JSON.parse(raw) as {
      message?: string;
      serviceErrorCode?: number;
    };
    if (body.message) message = body.message;
    serviceCode = body.serviceErrorCode;
  } catch {
    /* keep the raw body as the message */
  }

  // The token is dead or was revoked. Retrying cannot help — the user has to
  // reconnect, so surface it rather than spending five attempts on it.
  if (status === 401) {
    return new PlatformError(
      "needs_auth",
      "LinkedIn rejected the access token. Reconnect the account.",
      false,
      true,
      status,
      raw,
    );
  }

  if (status === 403) {
    return new PlatformError(
      "forbidden",
      `LinkedIn refused this action: ${message}. Check that the app has the w_member_social permission.`,
      false,
      false,
      status,
      raw,
    );
  }

  if (status === 429) {
    return new PlatformError(
      "rate_limited",
      "LinkedIn rate limit reached. This will retry automatically.",
      true,
      false,
      status,
      raw,
    );
  }

  if (status >= 500) {
    return new PlatformError(
      "upstream_error",
      `LinkedIn returned ${status}. This will retry automatically.`,
      true,
      false,
      status,
      raw,
    );
  }

  return new PlatformError(
    serviceCode ? `linkedin_${serviceCode}` : `http_${status}`,
    message || `LinkedIn returned ${status}.`,
    false,
    false,
    status,
    raw,
  );
}

/**
 * LinkedIn's `commentary` field treats a set of characters as markup and
 * returns a 422 when they appear unescaped. Note the deliberate omission of
 * `#`: escaping it would turn every hashtag into literal text, which is almost
 * never what someone writing a social post wants.
 */
const RESERVED = /([\\|{}@[\]()<>*_~])/g;

export function escapeCommentary(text: string): string {
  return text.replace(RESERVED, "\\$1");
}
