import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed session cookie value: `<userId>.<hmac>`. Pure (no framework imports) so it can be
 * used by both the request proxy and the route helpers.
 */
export const SESSION_COOKIE = "mn_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 365;

const sign = (secret: string, userId: string) => createHmac("sha256", secret).update(userId).digest("base64url");

export const encodeSession = (secret: string, userId: string) => `${userId}.${sign(secret, userId)}`;

export function decodeSession(secret: string, value: string | undefined): string | null {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot < 1) return null;
  const userId = value.slice(0, dot);
  const given = Buffer.from(value.slice(dot + 1));
  const expected = Buffer.from(sign(secret, userId));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return userId;
}
