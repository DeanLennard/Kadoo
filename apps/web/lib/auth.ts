// apps/web/lib/auth.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authConfig } from "@/app/api/auth/[...nextauth]/route";

// Narrow role type once here so you get autocomplete everywhere
export type Role = "owner" | "admin" | "reviewer" | "viewer";

export type TenantSession = {
    tenantId: string;
    role: Role;
    // include the full session if you need user/email
    session: Awaited<ReturnType<typeof getServerSession>>;
};

/**
 * Strict server-side guard for Server Components / route handlers.
 * Throws with a 302 to /login if not authenticated (nice DX in pages).
 */
export async function requireSession(): Promise<TenantSession> {
    const session = await getServerSession(authConfig);
    if (!session) {
        // In API routes you’ll likely prefer withApiAuth below
        // In Server Components, throwing is fine — or return redirect()
        throw new Error("Unauthenticated");
    }
    const tenantId = (session as any).tenantId as string | undefined;
    const role = (session as any).role as Role | undefined;
    if (!tenantId || !role) throw new Error("Invalid session");

    return { session, tenantId, role };
}

/** Simple RBAC check */
export class HttpError extends Error {
    constructor(message: string, public status: number) {
        super(message);
    }
}

export function assertRole(role: Role, allowed: Role[]) {
    if (!allowed.includes(role)) {
        throw new HttpError("Forbidden", 403);
    }
}