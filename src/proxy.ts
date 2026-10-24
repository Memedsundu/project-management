import { NextResponse, type NextRequest } from "next/server";

/**
 * A light gate: send visitors without a session cookie to the sign-in page.
 * The real check (session in the database) runs in the app layout and in
 * every server action and route handler.
 */
const PUBLIC = ["/sign-in", "/setup", "/pair", "/api/cron", "/api/health", "/offline"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/"))) return NextResponse.next();
  if (request.cookies.has("sid")) return NextResponse.next();
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (pathname === "/") return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = "/sign-in";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/|favicon|icons/|manifest.webmanifest|sw.js|robots.txt|.*\\.(?:png|svg|ico|webp|woff2?)$).*)"],
};
