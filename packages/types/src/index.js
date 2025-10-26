// packages/types/src/index.ts
import { z } from "zod";
// Core models (shortened; expand as needed)
export const Tenant = z.object({
    _id: z.string(),
    name: z.string(),
    plan: z.enum(["base"]).default("base"),
    timezone: z.string(),
    region: z.enum(["UK", "EU"]).default("UK"),
    createdAt: z.date(),
    settings: z.object({
        policyVersion: z.literal("v1")
    })
});
export const Decision = z.object({
    policyVersion: z.literal("v1"),
    confidence: z.number(),
    requiresApproval: z.boolean().optional(),
    actions: z.array(z.union([
        z.object({ type: z.literal("label_email"), emailId: z.string(), labels: z.array(z.string()) }),
        z.object({ type: z.literal("create_draft_reply"), threadId: z.string(), to: z.array(z.string()), body_md: z.string(), subject: z.string().optional() })
    ]))
});
