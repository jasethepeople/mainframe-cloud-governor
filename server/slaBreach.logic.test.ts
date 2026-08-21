import { describe, expect, it } from "vitest";
import { canPrepareSlaBreachDispatch, getConfirmedSlaBreachReceipt, isSlaBreachTimelineEvent } from "./slaBreach.logic";

describe("SLA-breach dispatch eligibility", () => {
  const now = new Date("2026-08-21T12:00:00.000Z");
  const base = { autoEscalateSlaBreaches: true, routeStatus: "manual_tested" as const, alertStatus: "open" as const, escalationState: "handoff_recorded", responseDueAt: new Date("2026-08-21T11:59:00.000Z"), breachEscalatedAt: null };
  it("requires an enabled policy, manually tested route, and an overdue un-escalated incident", () => {
    expect(canPrepareSlaBreachDispatch(base, now)).toBe(true);
    expect(canPrepareSlaBreachDispatch({ ...base, routeStatus: "sealed" }, now)).toBe(false);
    expect(canPrepareSlaBreachDispatch({ ...base, breachEscalatedAt: now }, now)).toBe(false);
    expect(canPrepareSlaBreachDispatch({ ...base, responseDueAt: new Date("2026-08-21T12:30:00.000Z") }, now)).toBe(false);
  });

  it("confirms only a matching sealed-route receipt with a successful HTTP delivery", () => {
    const manifest = JSON.stringify({ jobType: "sealed_route_escalation", incident: { alertId: 14, escalationProfileId: 9 } });
    const receipt = JSON.stringify({ jobType: "sealed_route_escalation", status: "completed", incidentId: 14, delivery: { escalationProfileId: 9, httpStatus: 202 } });
    expect(getConfirmedSlaBreachReceipt(manifest, receipt)).toEqual({ alertId: 14, escalationProfileId: 9, httpStatus: 202 });
    expect(getConfirmedSlaBreachReceipt(manifest, JSON.stringify({ jobType: "sealed_route_escalation", status: "completed", incidentId: 13, delivery: { escalationProfileId: 9, httpStatus: 202 } }))).toBeNull();
    expect(getConfirmedSlaBreachReceipt(manifest, JSON.stringify({ jobType: "sealed_route_escalation", status: "failed", incidentId: 14, delivery: { escalationProfileId: 9, httpStatus: 500 } }))).toBeNull();
  });

  it("filters the breach timeline to preparation and verified-delivery events", () => {
    expect(isSlaBreachTimelineEvent("sla_breach_dispatch_prepared", "prepared")).toBe(true);
    expect(isSlaBreachTimelineEvent("sla_breach_dispatch_receipt_confirmed", "confirmed")).toBe(true);
    expect(isSlaBreachTimelineEvent("handoff", "all")).toBe(false);
  });
});
