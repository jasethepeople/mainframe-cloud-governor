import { describe, expect, it } from "vitest";
import { breachDispatchTimelineToCsv } from "./breachDispatchExport";

describe("breach dispatch timeline CSV export", () => {
  it("exports route-scoped dispatch evidence with escaped text and formula protection", () => {
    const csv = breachDispatchTimelineToCsv([{ id: 8, alertId: 14, eventType: "sla_breach_dispatch_delivery_failed", createdAt: "2026-08-21T12:00:00.000Z", profileLabel: "On-call, primary", endpointHost: "alerts.example.com", summary: "=retry after 503" }]);
    expect(csv).toContain('"event_id","recorded_at","incident_id"');
    expect(csv).toContain('"On-call, primary"');
    expect(csv).toContain('"\'=retry after 503"');
  });
});
