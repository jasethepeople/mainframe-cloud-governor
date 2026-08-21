export type EscalationProvider = "generic_https" | "slack_webhook" | "pagerduty_events";

export function buildManualEscalationTestPayload(provider: EscalationProvider, endpointHost: string) {
  return { schema: "mainframe-cloud-governor.escalation-test.v1", provider, endpointHost, eventType: "local_agent_readiness_test", title: "Mainframe Cloud Governor escalation route test", occurredAt: new Date().toISOString(), credentials: "local-agent-only" as const };
}

export function buildIncidentHandoffEvidence(assigneeName: string, assigneeEmail: string, escalationProfileId?: number) {
  return { escalationProfileId: escalationProfileId ?? null, summary: `Handed local-agent readiness incident to ${assigneeName} (${assigneeEmail}).` };
}

export function buildIncidentHandoffPersistencePlan(assigneeName: string, assigneeEmail: string, escalationProfileId?: number) {
  const evidence = buildIncidentHandoffEvidence(assigneeName, assigneeEmail, escalationProfileId);
  return { alertUpdate: { assigneeName, assigneeEmail, escalationState: "handoff_recorded" as const }, escalationEvent: { eventType: "handoff" as const, escalationProfileId: evidence.escalationProfileId, summary: evidence.summary } };
}
