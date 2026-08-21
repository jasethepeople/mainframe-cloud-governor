import { describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  updateLocalAgentOwnership: vi.fn(async () => [{ id: 7, agentId: "governor-local-agent", operationalOwnerName: "Cloud Operations", operationalOwnerEmail: "ops@example.com", status: "active" }]),
}));

vi.mock("./db", () => ({ updateLocalAgentOwnership: mocks.updateLocalAgentOwnership }));

import { appRouter } from "./routers";

describe("governance.updateLocalAgentOwnership", () => {
  it("passes the authenticated owner, key identity, and named operational contact to the ownership workflow", async () => {
    const ctx = { user: { id: 42, openId: "owner-42", name: "Owner", email: "owner@example.com", loginMethod: "manus", role: "admin", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() } } as TrpcContext;
    const caller = appRouter.createCaller(ctx);
    const response = await caller.governance.updateLocalAgentOwnership({ keyId: 7, operationalOwnerName: "Cloud Operations", operationalOwnerEmail: "ops@example.com" });
    expect(mocks.updateLocalAgentOwnership).toHaveBeenCalledWith(42, 7, "Cloud Operations", "ops@example.com");
    expect(response[0]).toMatchObject({ agentId: "governor-local-agent", operationalOwnerEmail: "ops@example.com" });
  });
});
