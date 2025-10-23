// apps/web/app/api/auth/[...nextauth]/route.ts
import NextAuth, { type AuthOptions } from "next-auth";
import Google from "next-auth/providers/google";
import AzureAD from "next-auth/providers/azure-ad";
import EmailProvider from "next-auth/providers/email";
import { MongoDBAdapter } from "@auth/mongodb-adapter";

import { clientPromise, databaseName } from "@/lib/mongo";
import { col } from "@/lib/db";
import type { User as ModelUser, Tenant as ModelTenant } from "@/lib/models";
import type { JWT } from "next-auth/jwt";

type MutableJWT = JWT & {
    tenantId?: string;
    role?: "owner" | "admin" | "reviewer" | "viewer";
    providers?: Record<string, true>;
};

export const authConfig: AuthOptions = {
    adapter: MongoDBAdapter(clientPromise, { databaseName }),

    providers: [
        Google({
            clientId: process.env.GOOGLE_CLIENT_ID!,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        }),
        AzureAD({
            clientId: process.env.AZURE_AD_CLIENT_ID!,
            clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
            tenantId: process.env.AZURE_AD_TENANT_ID!, // "common" if you want both work & personal Microsoft accounts
        }),
        EmailProvider({
            server: {
                host: process.env.EMAIL_SERVER_HOST!,   // mta.extendcp.co.uk
                port: Number(process.env.EMAIL_SERVER_PORT || 587),
                secure: false,                          // STARTTLS on 587
                requireTLS: true,
                name: "kadoo.io",                       // EHLO name
                authMethod: "LOGIN",
                auth: {
                    user: process.env.EMAIL_SERVER_USER!, // hello@kadoo.io
                    pass: process.env.EMAIL_SERVER_PASS!,
                },
                tls: {
                    // DEV ONLY — accept untrusted/self-signed while you sort the CA
                    rejectUnauthorized: process.env.NODE_ENV !== "development" ? true : false,
                    // SNI: some setups present a cert for mail.extendcp.co.uk
                    servername: "mail.extendcp.co.uk",
                },
                logger: true,
                debug: true,
            } as any,
            from: process.env.EMAIL_FROM!,
            maxAge: 10 * 60,
        }),
    ],
    session: { strategy: "jwt" },

    callbacks: {
        async signIn() {
            // Gate by domain later if you like
            return true;
        },

        async jwt({ token, account, user, profile }) {
            const t = token as MutableJWT;

            // Record which providers this user has connected (only present during sign-in/link)
            if (account && account.provider) {
                t.providers ??= {};
                t.providers[account.provider] = true;
            }

            // On first login, user will be defined; subsequent JWT refreshes won't have it.
            // We upsert the User + Tenant once, then always attach tenantId/role onto the JWT.
            if (!t.tenantId && token.sub) {
                const users = await col<ModelUser>("User");
                let dbUser = await users.findOne({ _id: token.sub });

                if (!dbUser) {
                    const tenants = await col<ModelTenant>("Tenant"); // <-- important
                    const tenantId = crypto.randomUUID();

                    await tenants.insertOne({
                        _id: tenantId, // string is OK now
                        name: (profile as any)?.name || user?.name || "My Company",
                        region: "UK",
                        createdAt: new Date(),
                    });

                    dbUser = {
                        _id: token.sub!,
                        tenantId,
                        email: (user?.email as string) ?? "",
                        role: "owner",
                        createdAt: new Date(),
                        providers: account?.provider ? ({ [account.provider]: true } as Record<string, true>) : undefined,
                    } as unknown as ModelUser;

                    await (await col<ModelUser>("User")).insertOne(dbUser);
                }

                t.tenantId = dbUser.tenantId as string;
                t.role = dbUser.role as MutableJWT["role"];
            }

            return t;
        },

        async session({ session, token }) {
            const t = token as MutableJWT;
            (session as any).tenantId = t.tenantId;
            (session as any).role = t.role;
            return session;
        },
    },
};

const handler = NextAuth(authConfig);
export { handler as GET, handler as POST };
