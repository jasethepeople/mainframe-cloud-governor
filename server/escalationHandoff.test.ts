import { describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({ handoff: vi.fn(async () => []) }));
vi.mock("./db", () => ({ handoffLocalAgentReadinessAlert: mocks.handoff }));
import { appRouter } from "./routers";

describe("governance.handoffLocalAgentReadinessAlert", () => {
  it("forwards the owner, assignee, and optional route linkage to the protected handoff workflow", async () => {
    const ctx = { user: { id: 51, openId: "owner-51", name: "Owner", email: "owner@example.com", loginMethod: "manus", role: "admin", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() } } as TrpcContext;
    const caller = appRouter.createCaller(ctx);
    await caller.governance.handoffLocalAgentReadinessAlert({ alertId: 12, assigneeName: "On-call", assigneeEmail: "oncall@example.com", escalationProfileId: 3 });
    expect(mocks.handoff).toHaveBeenCalledWith(51, 12, "On-call", "oncall@example.com", 3);
  });
});
