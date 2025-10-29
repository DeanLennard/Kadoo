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
    return Employees.findOne({ tenantId, role: "ea", enabled: true });
}

export function canAcceptInvites(emp: EmployeeSettings | null) {
    return !!(emp && emp.enabled && emp.permissions?.canAcceptInvites);
}
