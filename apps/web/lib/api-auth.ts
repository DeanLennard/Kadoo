// apps/web/lib/api-auth.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authConfig } from "@/app/api/auth/[...nextauth]/route";
import type { Role } from "./auth";

type AuthedHandler = (
    req: NextRequest,
    ctx: { tenantId: string; role: Role; session: any }
) => Promise<Response>;

export function withApiAuth(handler: AuthedHandler, allowed?: Role[]) {
    return async (req: NextRequest) => {
        try {
            const session = await getServerSession(authConfig);
            if (!session) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });

            const tenantId = (session as any).tenantId as string | undefined;
            const role = (session as any).role as Role | undefined;
            if (!tenantId || !role) return NextResponse.json({ error: "Invalid session" }, { status: 401 });

            if (allowed && !allowed.includes(role))
                return NextResponse.json({ error: "Forbidden" }, { status: 403 });

            return await handler(req, { tenantId, role, session });
        } catch (e: any) {
            const status = e?.status ?? 500;
            return NextResponse.json({ error: e?.message ?? "Server error" }, { status });
        }
    };
}
