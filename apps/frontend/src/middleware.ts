import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_ROUTES = ["/login", "/api"];

function decodeJwtExp(token: string): number | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
    const payload = JSON.parse(atob(b64 + pad));
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isPublic = PUBLIC_ROUTES.some((p) => pathname === p || pathname.startsWith(p + "/"));
  const token = req.cookies.get("access_token")?.value;
  const exp = token ? decodeJwtExp(token) : null;
  const tokenValid = !!exp && exp * 1000 > Date.now();

  if (!isPublic && !tokenValid) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    const res = NextResponse.redirect(url);
    if (token) res.cookies.delete("access_token");
    return res;
  }

  if (pathname === "/login" && tokenValid) {
    const url = req.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|logo-gozz.png|chat-bg.jpg|sw.js).*)"]
};
