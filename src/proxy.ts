import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { jwtVerify } from "jose";
import type { NextRequest } from "next/server";

// Next.js 16: Proxy runs in Node.js runtime (not Edge).
// jose works fully in Node.js — the Edge Runtime warning in build output is
// from bundling JWE code that we don't use; jwtVerify (JWS/HS256) is fine.

// ─────────────────────────────────────────────────────────────────────────────
// Admin middleware (NextAuth JWT)
// ─────────────────────────────────────────────────────────────────────────────

async function isAdminAuthenticated(req: NextRequest): Promise<boolean> {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  return !!token;
}

// ─────────────────────────────────────────────────────────────────────────────
// Portal middleware (custom portal JWT — Edge Runtime compatible via jose)
// ─────────────────────────────────────────────────────────────────────────────

async function isPortalAuthenticated(req: NextRequest): Promise<boolean> {
  try {
    const token = req.cookies.get("portal_token")?.value;
    if (!token) return false;
    const secret = process.env.PORTAL_JWT_SECRET;
    if (!secret) return false;
    await jwtVerify(token, new TextEncoder().encode(secret));
    return true;
  } catch {
    return false;
  }
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ── Portal routes ──────────────────────────────────────────────────────────

  // Public portal pages/APIs — no auth required
  const isPortalPublicPage =
    pathname === "/portal/login" ||
    pathname === "/portal/accept-invite" ||
    pathname.startsWith("/portal/accept-invite") ||
    pathname === "/portal/forgot-password" ||
    pathname === "/portal/reset-password";

  const isPortalPublicApi =
    pathname.startsWith("/api/portal/auth"); // login, logout, set-password, me

  // All other portal pages — require portal auth
  const isPortalPage =
    pathname.startsWith("/portal") && !isPortalPublicPage;

  // All other portal APIs — require portal auth (return JSON 401, NOT redirect)
  const isPortalApi =
    pathname.startsWith("/api/portal") && !isPortalPublicApi;

  if (isPortalPage || isPortalApi) {
    const authenticated = await isPortalAuthenticated(req);

    if (!authenticated) {
      if (isPortalApi) {
        // Per correction #5: APIs return JSON 401, never redirect to HTML login
        return NextResponse.json(
          { error: "missing_token", message: "Authentication required" },
          { status: 401 }
        );
      }
      // Portal pages redirect to login
      return NextResponse.redirect(new URL("/portal/login", req.url));
    }

    // Authenticated portal users on /portal → redirect /portal → /portal/dashboard
    if (pathname === "/portal" || pathname === "/portal/") {
      return NextResponse.redirect(new URL("/portal/dashboard", req.url));
    }

    return NextResponse.next();
  }

  // Redirect authenticated portal users away from login page
  if (isPortalPublicPage && pathname === "/portal/login") {
    const authenticated = await isPortalAuthenticated(req);
    if (authenticated) {
      return NextResponse.redirect(new URL("/portal/dashboard", req.url));
    }
    return NextResponse.next();
  }

  // ── Admin routes ───────────────────────────────────────────────────────────

  const isAdminAuthPage = pathname.startsWith("/auth");

  if (isAdminAuthPage) {
    const isAuth = await isAdminAuthenticated(req);
    if (isAuth) {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }
    return NextResponse.next();
  }

  // Protect admin routes — everything except public routes (and secret-authenticated internal webhooks)
  const isPublicRoute =
    pathname.startsWith("/api/public") ||
    pathname.startsWith("/api/internal/storefront") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/updates") ||
    pathname.startsWith("/api/portal") || // portal APIs handled above or are public
    pathname.startsWith("/portal") ||     // portal pages handled above
    pathname.startsWith("/download") ||
    pathname.startsWith("/demo") ||
    pathname === "/";

  if (!isPublicRoute) {
    const isAuth = await isAdminAuthenticated(req);
    if (!isAuth) {
      let from = pathname;
      if (req.nextUrl.search) {
        from += req.nextUrl.search;
      }
      return NextResponse.redirect(
        new URL(`/auth?from=${encodeURIComponent(from)}`, req.url)
      );
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
