// apps/worker/src/util/employee.ts
import { col } from "../db";

export type EmployeeSettings = {
    _id: string;
    tenantId: string;
    role: "ea" | "agent" | "bot";
    enabled: boolean;
    permissions?: {
        canSendEmails?: boolean;
        canProposeTimes?: boolean;
        canAcceptInvites?: boolean;
        canDeclineInvites?: boolean;
        canScheduleMeetings?: boolean;
    };
    auto?: {
        sendWithoutApproval?: {
            send_reply?: boolean;
            send_calendar_reply?: boolean;
            schedule_meeting?: boolean;
        };
        thresholds?: {
            send_reply?: number;
            send_calendar_reply?: number;
            schedule_meeting?: number;
        };
    };
};

export async function getActiveEA(tenantId: string): Promise<EmployeeSettings | null> {
    const Employees = await col<EmployeeSettings>("Employee");
    return Employees.findOne({ tenantId, role: "ea" });
}

export function hasPermission(emp: EmployeeSettings | null, action: "send_reply" | "send_calendar_reply" | "schedule_meeting" | "create_draft_reply") {
    if (!emp?.enabled) return false;
    switch (action) {
        case "send_reply":         return !!emp.permissions?.canSendEmails;
        case "create_draft_reply": return !!emp.permissions?.canSendEmails;
        case "send_calendar_reply":return !!emp.permissions?.canAcceptInvites;
        case "schedule_meeting":   return !!emp.permissions?.canScheduleMeetings;
    }
}

export function allowAuto(emp: EmployeeSettings | null, action: "send_reply" | "send_calendar_reply" | "schedule_meeting") {
    return !!emp?.enabled && !!emp?.auto?.sendWithoutApproval?.[action];
}

export function minThreshold(emp: EmployeeSettings | null, action: "send_reply" | "send_calendar_reply" | "schedule_meeting", fallback: number) {
    const t = emp?.auto?.thresholds?.[action];
    return typeof t === "number" ? t : fallback;
}
