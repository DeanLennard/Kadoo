// apps/web/lib/require-session-server.ts
import { getServerSession } from "next-auth";
import { authConfig } from "@/app/api/auth/[...nextauth]/route";
import { redirect } from "next/navigation";
import type { Role } from "./auth";

export async function requireSessionOrRedirect(callbackUrl = "/dashboard") {
    const session = await getServerSession(authConfig);
    if (!session) redirect(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
    const tenantId = (session as any).tenantId as string | undefined;
    const role = (session as any).role as Role | undefined;
    if (!tenantId || !role) redirect(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
    return { session, tenantId, role };
}
