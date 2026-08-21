import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildLocalAgentManifest, canAcceptLocalAgentReceipt, canIssueLocalAgentJob, deriveLocalAgentReadiness, hashManifest, planLocalAgentKeyRotation, verifyLocalAgentReceipt } from "./localAgent.logic";

describe("local agent bridge", () => {
  it("creates a read-only AWS manifest without mutating actions", () => {
    const manifest = buildLocalAgentManifest(4, "aws_read_only_discovery", new Date("2026-08-22T00:00:00.000Z"));
    expect(manifest).toMatchObject({ jobType: "aws_read_only_discovery", mutatingActionsProhibited: true });
    expect(manifest.allowedActions).toContain("ec2:DescribeInstances");
    expect(manifest.allowedActions.some(action => action.includes("Delete"))).toBe(false);
    expect(hashManifest(manifest)).toHaveLength(64);
  });

  it("creates a credential-free health-check manifest with signing checks only", () => {
    const manifest = buildLocalAgentManifest(7, "health_check", new Date("2026-08-22T00:00:00.000Z"));
    expect(manifest).toMatchObject({ jobType: "health_check", mutatingActionsProhibited: true, requiredProfile: "No cloud or SIEM credential required" });
    expect(manifest.checks).toContain("receipt_signing");
  });

  it("creates a credential-free sealed-route escalation manifest", () => {
    const manifest = buildLocalAgentManifest(8, "sealed_route_escalation", new Date("2026-08-22T00:00:00.000Z"), { alertId: 5, escalationProfileId: 3, endpointHost: "alerts.example.com" });
    expect(manifest).toMatchObject({ jobType: "sealed_route_escalation", incident: { alertId: 5, escalationProfileId: 3, endpointHost: "alerts.example.com" }, delivery: { credentials: "agent-local-only" } });
  });

  it("accepts a correctly signed agent receipt and rejects a modified one", () => {
    const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const receipt = JSON.stringify({ status: "completed", resourceCount: 3 });
    const signature = sign("sha256", Buffer.from(receipt), keys.privateKey).toString("base64");
    expect(verifyLocalAgentReceipt(keys.publicKey.export({ format: "jwk" }), receipt, signature)).toBe(true);
    expect(verifyLocalAgentReceipt(keys.publicKey.export({ format: "jwk" }), `${receipt}x`, signature)).toBe(false);
  });

  it("accepts only one non-expired receipt for a queued job", () => {
    const now = new Date("2026-08-21T00:00:00.000Z");
    expect(canAcceptLocalAgentReceipt("queued", new Date("2026-08-21T00:15:00.000Z"), now)).toBe(true);
    expect(canAcceptLocalAgentReceipt("completed", new Date("2026-08-21T00:15:00.000Z"), now)).toBe(false);
    expect(canAcceptLocalAgentReceipt("queued", new Date("2026-08-20T23:59:00.000Z"), now)).toBe(false);
  });

  it("rejects job issuance from a revoked local-agent key", () => {
    expect(canIssueLocalAgentJob("active")).toBe(true);
    expect(canIssueLocalAgentJob("revoked")).toBe(false);
  });

  it("rotates only an active key and always retires it before creating an active replacement", () => {
    expect(planLocalAgentKeyRotation("active")).toEqual({ allowed: true, retiringStatus: "revoked", replacementStatus: "active" });
    expect(planLocalAgentKeyRotation("revoked")).toEqual({ allowed: false, retiringStatus: "revoked", replacementStatus: null });
  });

  it("reports readiness across no-key, health-check, stale-receipt, and ready states", () => {
    const now = new Date("2026-08-21T12:00:00.000Z");
    expect(deriveLocalAgentReadiness({ activeAgentCount: 0, lastVerifiedReceipt: null, lastHealthCheck: null }, now)).toBe("no_active_key");
    expect(deriveLocalAgentReadiness({ activeAgentCount: 1, lastVerifiedReceipt: null, lastHealthCheck: null }, now)).toBe("health_check_required");
    expect(deriveLocalAgentReadiness({ activeAgentCount: 1, lastVerifiedReceipt: new Date("2026-08-20T10:00:00.000Z"), lastHealthCheck: new Date("2026-08-21T11:00:00.000Z") }, now)).toBe("receipt_stale");
    expect(deriveLocalAgentReadiness({ activeAgentCount: 1, lastVerifiedReceipt: new Date("2026-08-21T11:00:00.000Z"), lastHealthCheck: new Date("2026-08-21T11:00:00.000Z") }, now)).toBe("ready");
  });
});
