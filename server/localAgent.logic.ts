import { createHash, createPublicKey, verify, type JsonWebKey } from "node:crypto";

export type LocalAgentJobType = "aws_read_only_discovery" | "generic_https_siem_delivery" | "health_check" | "sealed_route_escalation";

export function buildLocalAgentManifest(jobId: number, jobType: LocalAgentJobType, expiresAt: Date, context?: { alertId: number; escalationProfileId: number; endpointHost: string }) {
  const base = { version: "mcg-local-agent.v1", jobId, expiresAt: expiresAt.toISOString(), credentialHandling: "agent-local-only" as const };
  if (jobType === "health_check") return { ...base, jobType, requiredProfile: "No cloud or SIEM credential required", checks: ["agent_identity", "manifest_expiry", "receipt_signing"], mutatingActionsProhibited: true };
  if (jobType === "aws_read_only_discovery") return { ...base, jobType, requiredProfile: "Scoped IAM inventory role", allowedActions: ["ec2:DescribeInstances", "ec2:DescribeVolumes", "ecs:ListClusters", "ecs:ListServices", "ecs:DescribeServices"], mutatingActionsProhibited: true };
  if (jobType === "sealed_route_escalation") return { ...base, jobType, requiredProfile: "Manually tested sealed escalation route", incident: context ?? null, delivery: { method: "POST", contentType: "application/json", schema: "mainframe-cloud-governor.sla-breach.v1", credentials: "agent-local-only" as const }, mutatingActionsProhibited: true };
  return { ...base, jobType, requiredProfile: "Generic HTTPS SIEM delivery", delivery: { method: "POST", contentType: "application/json", auditSchema: "mainframe-cloud-governor.audit.v1" }, mutatingActionsProhibited: true };
}

export function hashManifest(manifest: unknown) {
  return createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
}

export function verifyLocalAgentReceipt(publicKeyJwk: JsonWebKey, receipt: string, signatureBase64: string) {
  try {
    const publicKey = createPublicKey({ key: publicKeyJwk, format: "jwk" });
    return verify("sha256", Buffer.from(receipt), publicKey, Buffer.from(signatureBase64, "base64"));
  } catch {
    return false;
  }
}

export function canAcceptLocalAgentReceipt(status: "queued" | "completed" | "failed" | "expired", expiresAt: Date, now = new Date()) {
  return status === "queued" && expiresAt.getTime() >= now.getTime();
}

export function canIssueLocalAgentJob(agentStatus: "active" | "revoked") {
  return agentStatus === "active";
}

export function planLocalAgentKeyRotation(agentStatus: "active" | "revoked") {
  if (!canIssueLocalAgentJob(agentStatus)) return { allowed: false as const, retiringStatus: "revoked" as const, replacementStatus: null };
  return { allowed: true as const, retiringStatus: "revoked" as const, replacementStatus: "active" as const };
}

export const LOCAL_AGENT_RECEIPT_FRESHNESS_MS = 24 * 60 * 60 * 1000;

export function deriveLocalAgentReadiness(input: { activeAgentCount: number; lastVerifiedReceipt: Date | null; lastHealthCheck: Date | null }, now = new Date()) {
  if (input.activeAgentCount === 0) return "no_active_key" as const;
  if (!input.lastHealthCheck) return "health_check_required" as const;
  if (!input.lastVerifiedReceipt || now.getTime() - input.lastVerifiedReceipt.getTime() > LOCAL_AGENT_RECEIPT_FRESHNESS_MS) return "receipt_stale" as const;
  return "ready" as const;
}
