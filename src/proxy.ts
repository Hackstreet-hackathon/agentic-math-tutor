import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { decodeSession, encodeSession, SESSION_COOKIE, SESSION_MAX_AGE } from "./lib/session-token";

/**
 * Mints the guest identity on the very first page request, *before* the page's own API calls
 * run. Without this, several parallel first requests from a fresh browser each create a
 * different guest user and the last Set-Cookie wins, orphaning data created by the others.
 *
 * Only page navigations are matched. API routes are excluded on purpose: when a proxy matches
 * a route Next.js buffers request bodies (10 MB default), which would cut off PDF uploads.
 */
export function proxy(req: NextRequest) {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) return NextResponse.next(); // misconfigured: API routes will report it

  const existing = req.cookies.get(SESSION_COOKIE)?.value;
  if (decodeSession(secret, existing)) return NextResponse.next();

  const value = encodeSession(secret, randomUUID());
  // Make the new cookie visible to this same request's server components, too.
  const headers = new Headers(req.headers);
  const others = (headers.get("cookie") ?? "").split(/;\s*/).filter((c) => c && !c.startsWith(`${SESSION_COOKIE}=`));
  headers.set("cookie", [...others, `${SESSION_COOKIE}=${value}`].join("; "));

  const res = NextResponse.next({ request: { headers } });
  res.cookies.set(SESSION_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && req.nextUrl.protocol === "https:",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|pdfjs|favicon.ico|icon.svg).*)"],
};
