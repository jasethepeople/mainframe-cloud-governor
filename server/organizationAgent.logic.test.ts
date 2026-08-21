import { describe, expect, it } from "vitest";
import { buildAgentReadinessAlert } from "./organizationAgent.logic";

describe("organization agent alerting", () => {
  it("creates explicit ownership-oriented messages for each non-ready agent state", () => {
    expect(buildAgentReadinessAlert("ready", "Mira")).toBeNull();
    expect(buildAgentReadinessAlert("no_active_key", "Mira")).toMatchObject({ alertType: "no_active_key" });
    expect(buildAgentReadinessAlert("health_check_required", "Mira")?.summary).toContain("Mira");
    expect(buildAgentReadinessAlert("receipt_stale", "Mira")?.summary).toContain("older than 24 hours");
  });
});
