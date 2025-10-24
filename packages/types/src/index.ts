// packages/types/src/index.ts
import { z } from "zod";

// Core models (shortened; expand as needed)
export const Tenant = z.object({
    _id: z.string(),
    name: z.string(),
    plan: z.enum(["base"]).default("base"),
    timezone: z.string(),
    region: z.enum(["UK","EU"]).default("UK"),
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
export type Decision = z.infer<typeof Decision>;

export type MailboxType = "imap" | "pop" | "google" | "microsoft";

export interface MailboxConnector {
    _id: string;
    tenantId: string;
    type: MailboxType;
    imap?: {
        host: string; port: number; secure: boolean;
        user: string; pass: string;
        tlsServername?: string;  // SNI host to validate against, e.g. "imap.extendcp.co.uk"
        allowSelfSigned?: boolean; // DEV/allowlisted only
    };
    smtp?: {
        host: string; port: number; secure: boolean;
        user: string; pass: string;
        tlsServername?: string;  // SNI host to validate against, e.g. "imap.extendcp.co.uk"
        allowSelfSigned?: boolean; // DEV/allowlisted only
    };
    watches?: { kind: "idle"; id: string; startedAt: Date }[];
    status: "active" | "error" | "needs_auth";
    createdAt: Date;
    updatedAt: Date;
}

export interface MailThread {
    _id: string;
    tenantId: string;
    connectorId: string;
    subject: string;
    participants: string[];
    lastTs: Date;
    unread: number;
    status: "awaiting_us" | "awaiting_them" | "closed";
    summary?: string;
    facts?: string[];
    lastMessageIds: string[];
    labels?: string[];
    priority?: 0|1|2|3;
    nextAction?: "reply"|"wait"|"none";
    lastClassifiedAt?: Date;
}

export interface MailMessage {
    _id: string;
    tenantId: string;
    threadId: string;
    msgId: string;
    uid?: number;
    uidValidity?: number;
    from: string;
    to: string[];
    cc: string[];
    date: Date;
    flags?: string[];
    text: string;
    html: string;
    hasLargeAttachments: boolean;
    attachments?: MailAttachmentMeta[];
    folder?: string;
    labels?: string[];
    spamScore?: number;
    classifications?: { type: string; score?: number }[]; // e.g., [{type:"newsletter", score:0.93}]
    priority?: 0|1|2|3;
    autoDraftId?: string;
}

type MailAttachmentMeta = {
    filename: string;
    contentType: string;
    size: number;
    // optional: index or part marker if you later optimize partial downloads
};

export type Draft = {
    _id: string;
    tenantId: string;
    threadId: string;
    uidRef: number;
    subject?: string;
    html?: string;
    text?: string;
    confidence: number;     // 0..1
    needsApproval: boolean; // always true initially
    createdAt: Date;
    status: "ready" | "sent" | "discarded";
    inReplyToUid?: number;
};

export type TenantSettings = {
    tenantId: string;
    autoDraft: boolean;
    autoSend: boolean; // keep false until you’re ready
    moveSpam: boolean;
    workingHours?: { tz: string; start: string; end: string; days: number[] }; // e.g. [1..5]
    allowedDomains?: string[];
    blockedDomains?: string[];
    maxDailyDrafts?: number;
    senderName?: string;
    companyName?: string;
    signatureHtml?: string;
};
