// apps/web/lib/models.ts
import type { ObjectId } from "mongodb";

export type Role = "owner" | "admin" | "reviewer" | "viewer";

export interface DecisionLog {
    _id: ObjectId;
    tenantId: string;
    employeeId?: string;
    createdAt: Date;
    status: "pending" | "approved" | "denied" | "executed" | "failed";
    requiresApproval: boolean;
    confidence: number;
    action: { type: string; payload: any };
    result?: any;
    error?: string;
    approvedAt?: Date;
    deniedAt?: Date;
    executedAt?: Date;
}

export interface Tenant {
    _id: string;                 // string UUID
    name: string;
    region: "UK" | "EU";
    createdAt: Date;
}

export interface User {
    _id: string;                 // OAuth subject (string)
    tenantId: string;            // string UUID
    email: string;
    role: Role;
    createdAt: Date;
    providers?: Record<string, true>;
}

export type MailboxType = "imap" | "pop" | "google" | "microsoft";

export interface MailboxConnector {
    _id: string;             // uuid
    tenantId: string;
    type: MailboxType;       // "imap" | "pop"
    imap?: {
        host: string; port: number; secure: boolean;
        user: string; pass: string;
    };
    smtp?: {
        host: string; port: number; secure: boolean; // 587->secure=false STARTTLS; 465->secure=true
        user: string; pass: string;
    };
    watches?: { kind: "idle"; id: string; startedAt: Date }[];
    status: "active" | "error" | "needs_auth";
    createdAt: Date; updatedAt: Date;
}

export interface MailThread {
    _id: string; tenantId: string; connectorId: string;
    subject: string; participants: string[]; lastTs: Date;
    unread: number;
    status: "awaiting_us"|"awaiting_them"|"closed";
    summary?: string; facts?: string[];
    lastMessageIds: string[];
    labels: string[];
    priority?: 0|1|2|3;
    nextAction?: "reply"|"wait"|"none";
    lastClassifiedAt?: Date;
}

export interface MailMessage {
    _id: string; tenantId: string; threadId: string;
    msgId: string; uid?: number; uidValidity?: number;
    from: string; to: string[]; cc: string[];
    date: Date; flags?: string[];
    text: string;
    hasLargeAttachments: boolean;
    attachments?: { name:string; size:number; hash?:string }[];
    labels?: string[];
    pamScore?: number;
    classifications?: { type: string; score?: number }[];
    priority?: 0|1|2|3;
    autoDraftId?: string;
}
