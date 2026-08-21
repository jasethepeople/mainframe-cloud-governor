import { describe, expect, it } from "vitest";
import { buildIncidentHandoffEvidence, buildIncidentHandoffPersistencePlan, buildManualEscalationTestPayload } from "./escalation.logic";

describe("escalation routing", () => {
  it("creates a credential-free manual test payload for a sealed route", () => {
    const payload = buildManualEscalationTestPayload("generic_https", "alerts.example.com");
    expect(payload).toMatchObject({ provider: "generic_https", endpointHost: "alerts.example.com", credentials: "local-agent-only" });
    expect(JSON.stringify(payload)).not.toContain("token");
  });

  it("builds append-only handoff evidence with an optional route linkage", () => {
    expect(buildIncidentHandoffEvidence("On-call", "oncall@example.com", 9)).toEqual({ escalationProfileId: 9, summary: "Handed local-agent readiness incident to On-call (oncall@example.com)." });
    expect(buildIncidentHandoffEvidence("On-call", "oncall@example.com").escalationProfileId).toBeNull();
  });

  it("produces a persistence plan that updates the assignee and appends a linked handoff event", () => {
    expect(buildIncidentHandoffPersistencePlan("On-call", "oncall@example.com", 9)).toEqual({
      alertUpdate: { assigneeName: "On-call", assigneeEmail: "oncall@example.com", escalationState: "handoff_recorded" },
      escalationEvent: { eventType: "handoff", escalationProfileId: 9, summary: "Handed local-agent readiness incident to On-call (oncall@example.com)." },
    });
  });
});
