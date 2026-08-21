import { describe, expect, it } from "vitest";
import { canPrepareSlaBreachDispatch } from "./slaBreach.logic";

describe("SLA-breach dispatch eligibility", () => {
  const now = new Date("2026-08-21T12:00:00.000Z");
  const base = { autoEscalateSlaBreaches: true, routeStatus: "manual_tested" as const, alertStatus: "open" as const, escalationState: "handoff_recorded", responseDueAt: new Date("2026-08-21T11:59:00.000Z"), breachEscalatedAt: null };
  it("requires an enabled policy, manually tested route, and an overdue un-escalated incident", () => {
    expect(canPrepareSlaBreachDispatch(base, now)).toBe(true);
    expect(canPrepareSlaBreachDispatch({ ...base, routeStatus: "sealed" }, now)).toBe(false);
    expect(canPrepareSlaBreachDispatch({ ...base, breachEscalatedAt: now }, now)).toBe(false);
    expect(canPrepareSlaBreachDispatch({ ...base, responseDueAt: new Date("2026-08-21T12:30:00.000Z") }, now)).toBe(false);
  });
});
