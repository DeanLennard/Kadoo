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
    credits: {
        balance: number;
        planMonthlyAllotment: number;
        resetDay: number;
        lastResetAt?: Date;
    };
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

export type CalConnector = {
    _id: string;
    tenantId: string;
    type: 'caldav';
    principalUrl: string;      // e.g. https://cal.example.com/dav/principals/user/
    calendarUrl: string;       // e.g. https://cal.example.com/dav/calendars/user/personal/
    username?: string;         // optional if OAuth-style proxy in future
    passwordEnc?: string;      // envelope-encrypted
    syncToken?: string;        // for REPORT sync-collection
    status: 'active'|'error'|'needs_auth';
    createdAt: Date; updatedAt: Date;
};

export type CalEvent = {
    _id: string;
    tenantId: string;
    connectorId: string;
    uid: string;               // iCalendar UID
    etag: string;
    start: Date; end: Date;
    summary?: string;
    location?: string;
    attendees?: { email: string; name?: string; role?: 'REQ-PARTICIPANT'|'OPT-PARTICIPANT' }[];
    organizer?: string;
    rawIcs: string;
    updatedAt: Date;
};

export type Employee = {
    _id: string;
    tenantId: string;
    name: string;
    email?: string;
    role: "ea" | "agent" | "bot";
    enabled: boolean;

    permissions: {
        canSendEmails: boolean;
        canProposeTimes: boolean;
        canAcceptInvites: boolean;
        canDeclineInvites: boolean;
        canScheduleMeetings: boolean;
    };

    auto: {
        // which actions can run without approval
        sendWithoutApproval: {
            send_reply: boolean;
            send_calendar_reply: boolean;
            schedule_meeting: boolean;
        };
        // model confidence thresholds (0..1) required to auto-execute
        thresholds: {
            send_reply: number;          // e.g. 0.90
            send_calendar_reply: number; // e.g. 0.85
            schedule_meeting: number;    // e.g. 0.92
        };
    };

    limits?: {
        dailySends?: number; // optional quota
    };

    createdAt: Date;
    updatedAt: Date;
};
