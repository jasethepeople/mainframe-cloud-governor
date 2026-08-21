export type IncidentDeadlineState = "untracked" | "within_sla" | "due_soon" | "overdue" | "response_complete";

export function calculateIncidentResponseDueAt(createdAt: Date, slaMinutes: number) {
  return new Date(createdAt.getTime() + Math.max(1, slaMinutes) * 60_000);
}

export function deriveIncidentDeadlineState(responseDueAt: Date | null, escalationState: string, now = new Date()): IncidentDeadlineState {
  if (escalationState === "response_complete") return "response_complete";
  if (!responseDueAt) return "untracked";
  const remaining = responseDueAt.getTime() - now.getTime();
  if (remaining < 0) return "overdue";
  if (remaining <= 15 * 60_000) return "due_soon";
  return "within_sla";
}

export function buildIncidentPolicySnapshot(policy: { incidentSlaMinutes: number; primaryIncidentOwnerName: string; primaryIncidentOwnerEmail: string; backupIncidentOwnerName: string; backupIncidentOwnerEmail: string }, createdAt: Date) {
  return { assigneeName: policy.primaryIncidentOwnerName, assigneeEmail: policy.primaryIncidentOwnerEmail, backupOwnerName: policy.backupIncidentOwnerName, backupOwnerEmail: policy.backupIncidentOwnerEmail, responseDueAt: calculateIncidentResponseDueAt(createdAt, policy.incidentSlaMinutes) };
}
