import { buildIncidentHandoffPersistencePlan } from "./escalation.logic";

export type HandoffPersistenceAdapter = {
  updateAlert: (update: { assigneeName: string; assigneeEmail: string; escalationState: "handoff_recorded" }) => Promise<void>;
  appendEscalationEvent: (event: { eventType: "handoff"; escalationProfileId: number | null; summary: string }) => Promise<void>;
  appendAuditEvent: (event: { summary: string; escalationProfileId: number | null }) => Promise<void>;
};

export async function persistIncidentHandoff(adapter: HandoffPersistenceAdapter, assigneeName: string, assigneeEmail: string, escalationProfileId?: number) {
  const plan = buildIncidentHandoffPersistencePlan(assigneeName, assigneeEmail, escalationProfileId);
  await adapter.updateAlert(plan.alertUpdate);
  await adapter.appendEscalationEvent(plan.escalationEvent);
  await adapter.appendAuditEvent({ summary: plan.escalationEvent.summary, escalationProfileId: plan.escalationEvent.escalationProfileId });
  return plan;
}
