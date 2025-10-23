// apps/web/middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function middleware(req: NextRequest) {
    const { pathname } = req.nextUrl;

    // 1) Allow NextAuth internal routes
    if (pathname.startsWith("/api/auth")) return NextResponse.next();

    // 2) (Optional) allow other public routes/APIs here
    // if (pathname.startsWith("/api/healthz")) return NextResponse.next();

    // 3) Protect app pages & your own APIs
    const protectedPaths = [
        "/dashboard",
        "/approvals",
        "/settings",
        "/api/approvals",
        // add any other app APIs you want protected
    ];
    const isProtected = protectedPaths.some((p) => pathname.startsWith(p));
    if (!isProtected) return NextResponse.next();

    // Lightweight check for a session cookie. Full check happens in route handlers.
    const hasSessionCookie =
        req.cookies.get("next-auth.session-token") ||
        req.cookies.get("__Secure-next-auth.session-token");

    if (!hasSessionCookie) {
        const loginUrl = new URL("/login", req.url);
        loginUrl.searchParams.set("callbackUrl", req.nextUrl.pathname); // <- a page, not /api/auth/signin
        return NextResponse.redirect(loginUrl);
    }

    return NextResponse.next();
}

export const config = {
    matcher: [
        // apply to these prefixes only
        "/dashboard/:path*",
        "/approvals/:path*",
        "/settings/:path*",
        "/api/:path*",
    ],
};
