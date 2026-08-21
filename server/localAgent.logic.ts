import { createHash, createPublicKey, verify, type JsonWebKey } from "node:crypto";

export type LocalAgentJobType = "aws_read_only_discovery" | "generic_https_siem_delivery";

export function buildLocalAgentManifest(jobId: number, jobType: LocalAgentJobType, expiresAt: Date) {
  const base = { version: "mcg-local-agent.v1", jobId, expiresAt: expiresAt.toISOString(), credentialHandling: "agent-local-only" as const };
  if (jobType === "aws_read_only_discovery") return { ...base, jobType, requiredProfile: "Scoped IAM inventory role", allowedActions: ["ec2:DescribeInstances", "ec2:DescribeVolumes", "ecs:ListClusters", "ecs:ListServices", "ecs:DescribeServices"], mutatingActionsProhibited: true };
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
