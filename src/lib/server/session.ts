import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { decodeSession, encodeSession, SESSION_COOKIE, SESSION_MAX_AGE } from "../session-token";
import { db } from "./db";
import { env } from "./env";

/**
 * Identity layer. Until real authentication (Phase 7) each browser gets a signed HttpOnly
 * cookie that maps to a guest `User`. The cookie is normally minted by `src/proxy.ts` on the
 * first page request; `requireUser()` also mints one for API-only clients. User rows are
 * created lazily with an idempotent upsert, so concurrent first requests cannot create
 * duplicates. Every route scopes queries by `ownerId`, so swapping this module for a real
 * auth provider does not change authorization in the routes.
 */

/** Ids whose row is known to exist in this process (avoids an upsert per request). */
const known = new Set<string>();

async function ensureUser(id: string) {
  if (known.has(id)) return db.user.findUniqueOrThrow({ where: { id } });
  const user = await db.user.upsert({ where: { id }, create: { id, isGuest: true, displayName: "Guest" }, update: {} });
  if (known.size > 5000) known.clear();
  known.add(id);
  return user;
}

export async function getUser() {
  const jar = await cookies();
  const userId = decodeSession(env().SESSION_SECRET, jar.get(SESSION_COOKIE)?.value);
  return userId ? ensureUser(userId) : null;
}

/** Returns the current user, creating a guest account (and cookie) on first visit. */
export async function requireUser() {
  const existing = await getUser();
  if (existing) return existing;
  const id = randomUUID();
  const jar = await cookies();
  jar.set(SESSION_COOKIE, encodeSession(env().SESSION_SECRET, id), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return ensureUser(id);
}
