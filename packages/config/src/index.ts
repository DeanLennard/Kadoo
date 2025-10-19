import { z } from "zod";

const Env = z.object({
    NODE_ENV: z.enum(["development","test","production"]).default("development"),
    MONGODB_URI: z.string().min(1),
    MONGODB_DB: z.string().default("kadoo_dev"),
    REDIS_URL: z.string().min(1),
    OPENAI_API_KEY: z.string().min(1),
    // Web-only
    NEXTAUTH_SECRET: z.string().optional(),
    NEXTAUTH_URL: z.string().url().optional(),
    // Region/branding
    KADOO_REGION: z.enum(["UK","EU"]).default("UK"),
});

export type Env = z.infer<typeof Env>;
export const loadEnv = (): Env => {
    const parsed = Env.safeParse(process.env);
    if (!parsed.success) {
        console.error(parsed.error.flatten().fieldErrors);
        throw new Error("Invalid environment variables");
    }
    return parsed.data;
};
