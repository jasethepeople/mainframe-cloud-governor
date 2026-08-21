import { describe, expect, it, vi } from "vitest";
import { persistIncidentHandoff } from "./escalationHandoff.persistence";

describe("incident handoff persistence adapter", () => {
  it("persists assignee data, optional route linkage, and a new append-only event in order", async () => {
    const calls: string[] = [];
    const adapter = {
      updateAlert: vi.fn(async () => { calls.push("alert"); }),
      appendEscalationEvent: vi.fn(async () => { calls.push("event"); }),
      appendAuditEvent: vi.fn(async () => { calls.push("audit"); }),
    };
    await persistIncidentHandoff(adapter, "On-call", "oncall@example.com", 9);
    expect(adapter.updateAlert).toHaveBeenCalledWith({ assigneeName: "On-call", assigneeEmail: "oncall@example.com", escalationState: "handoff_recorded" });
    expect(adapter.appendEscalationEvent).toHaveBeenCalledWith({ eventType: "handoff", escalationProfileId: 9, summary: "Handed local-agent readiness incident to On-call (oncall@example.com)." });
    expect(adapter.appendAuditEvent).toHaveBeenCalledWith({ escalationProfileId: 9, summary: "Handed local-agent readiness incident to On-call (oncall@example.com)." });
    expect(calls).toEqual(["alert", "event", "audit"]);
  });
});
