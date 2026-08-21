export type AgentReadinessState = "no_active_key" | "health_check_required" | "receipt_stale" | "ready";

export function buildAgentReadinessAlert(state: AgentReadinessState, operationalOwnerName: string | null) {
  const owner = operationalOwnerName && operationalOwnerName !== "Unassigned" ? operationalOwnerName : "the assigned operator";
  if (state === "ready") return null;
  const message = state === "no_active_key" ? `No active local-agent key is registered. Assign ${owner} to register or rotate an agent identity.` : state === "health_check_required" ? `The local agent has not completed a verified health check. Request ${owner} to run a signed health-check manifest.` : `The latest verified local-agent receipt is older than 24 hours. Request ${owner} to run and verify a fresh health check.`;
  return { alertType: state, summary: message };
}
