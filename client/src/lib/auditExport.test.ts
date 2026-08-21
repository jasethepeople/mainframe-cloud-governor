import { describe, expect, it } from "vitest";
import { auditEventsToCsv } from "./auditExport";

describe("auditEventsToCsv", () => {
  it("produces a header and safely quotes audit values", () => {
    const csv = auditEventsToCsv([{ id: 7, createdAt: "2026-08-21T00:00:00.000Z", eventType: "policy_updated", entityType: "settings", entityId: 3, actorEmail: "ops@example.com", summary: "Updated \"high-value\" policy" }]);
    expect(csv).toContain('"event_id","recorded_at"');
    expect(csv).toContain('"Updated ""high-value"" policy"');
  });
});
