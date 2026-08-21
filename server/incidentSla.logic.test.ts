import { describe, expect, it } from "vitest";
import { buildIncidentPolicySnapshot, calculateIncidentResponseDueAt, deriveIncidentDeadlineState } from "./incidentSla.logic";

describe("incident SLA deadlines", () => {
  it("calculates policy deadlines and reports within-SLA, due-soon, overdue, and completed states", () => {
    const now = new Date("2026-08-21T12:00:00.000Z");
    expect(calculateIncidentResponseDueAt(now, 60).toISOString()).toBe("2026-08-21T13:00:00.000Z");
    expect(deriveIncidentDeadlineState(new Date("2026-08-21T13:00:00.000Z"), "unrouted", now)).toBe("within_sla");
    expect(deriveIncidentDeadlineState(new Date("2026-08-21T12:10:00.000Z"), "handoff_recorded", now)).toBe("due_soon");
    expect(deriveIncidentDeadlineState(new Date("2026-08-21T11:59:00.000Z"), "handoff_recorded", now)).toBe("overdue");
    expect(deriveIncidentDeadlineState(new Date("2026-08-21T11:59:00.000Z"), "response_complete", now)).toBe("response_complete");
  });

  it("snapshots both primary and backup owners with the configured response deadline", () => {
    const snapshot = buildIncidentPolicySnapshot({ incidentSlaMinutes: 30, primaryIncidentOwnerName: "Primary On-call", primaryIncidentOwnerEmail: "primary@example.com", backupIncidentOwnerName: "Backup On-call", backupIncidentOwnerEmail: "backup@example.com" }, new Date("2026-08-21T12:00:00.000Z"));
    expect(snapshot).toMatchObject({ assigneeName: "Primary On-call", assigneeEmail: "primary@example.com", backupOwnerName: "Backup On-call", backupOwnerEmail: "backup@example.com" });
    expect(snapshot.responseDueAt.toISOString()).toBe("2026-08-21T12:30:00.000Z");
  });
});
