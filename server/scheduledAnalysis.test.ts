import { beforeEach, describe, expect, it, vi } from "vitest";

const { authenticateRequest, runScheduledAnalysisByTaskUid } = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  runScheduledAnalysisByTaskUid: vi.fn(),
}));

vi.mock("./_core/sdk", () => ({ sdk: { authenticateRequest } }));
vi.mock("./db", () => ({ runScheduledAnalysisByTaskUid }));

import { scheduledShredAnalysisHandler } from "./scheduledAnalysis";

function responseStub() {
  const response = {
    status: vi.fn(),
    json: vi.fn(),
  };
  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);
  return response;
}

describe("scheduledShredAnalysisHandler", () => {
  beforeEach(() => vi.resetAllMocks());

  it("rejects calls that are not platform cron identities", async () => {
    authenticateRequest.mockResolvedValue({ isCron: false });
    const response = responseStub();
    await scheduledShredAnalysisHandler({ path: "/api/scheduled/shred-analysis" } as any, response as any);
    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.json).toHaveBeenCalledWith({ error: "cron-only" });
  });

  it("uses the platform task identity and treats orphan schedules as successful skips", async () => {
    authenticateRequest.mockResolvedValue({ isCron: true, taskUid: "task-71" });
    runScheduledAnalysisByTaskUid.mockResolvedValue({ skipped: "orphan" });
    const response = responseStub();
    await scheduledShredAnalysisHandler({ path: "/api/scheduled/shred-analysis" } as any, response as any);
    expect(runScheduledAnalysisByTaskUid).toHaveBeenCalledWith("task-71");
    expect(response.json).toHaveBeenCalledWith({ ok: true, skipped: "orphan" });
  });
});
