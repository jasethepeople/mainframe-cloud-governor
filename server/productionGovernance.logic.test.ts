import { describe, expect, it } from "vitest";
import { canExtendAuditRetention, isSafeSiemEndpointHost, serializeSiemAuditPayload } from "./productionGovernance.logic";

describe("production governance controls", () => {
  it("allows audit retention to remain unchanged or extend, never contract", () => {
    expect(canExtendAuditRetention(365, 365)).toBe(true);
    expect(canExtendAuditRetention(365, 730)).toBe(true);
    expect(canExtendAuditRetention(365, 364)).toBe(false);
  });

  it("serializes a stable, minimal SIEM audit envelope", () => {
    const payload = JSON.parse(serializeSiemAuditPayload({ eventId: 9, occurredAt: "2026-08-21T00:00:00.000Z", eventType: "simulated_shredding_confirmed", entityType: "shred_list", entityId: 3, ownerUserId: 11, summary: "Recorded 2 resources as shredded." }));
    expect(payload).toMatchObject({ schema: "mainframe-cloud-governor.audit.v1", source: "mainframe-cloud-governor", event_id: 9, entity: { type: "shred_list", id: 3 }, owner_user_id: 11 });
  });

  it("permits public SIEM hosts and blocks local or private-network targets", () => {
    expect(isSafeSiemEndpointHost("logs.security.example")).toBe(true);
    expect(isSafeSiemEndpointHost("localhost")).toBe(false);
    expect(isSafeSiemEndpointHost("10.0.0.12")).toBe(false);
    expect(isSafeSiemEndpointHost("https://logs.example.com")).toBe(false);
  });
});
