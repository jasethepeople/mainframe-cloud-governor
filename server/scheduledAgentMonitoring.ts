import type { Request, Response } from "express";
import { evaluateLocalAgentReadinessByTaskUid, recordAuditEvent } from "./db";
import { sdk } from "./_core/sdk";

/** Heartbeat callback that evaluates and records local-agent readiness without inspecting credentials. */
export async function scheduledAgentMonitoringHandler(req: Request, res: Response) {
  try {
    const user = await sdk.authenticateRequest(req);
    if (!user.isCron || !user.taskUid) return res.status(403).json({ error: "cron-only" });
    const result = await evaluateLocalAgentReadinessByTaskUid(user.taskUid);
    if (result.skipped === false && result.alert?.created) await recordAuditEvent(result.ownerUserId, null, "scheduled_local_agent_readiness_evaluated", "local_agent_readiness_alert", result.alert.id, `Scheduled monitor recorded ${result.alert.alertType.replaceAll("_", " ")} readiness state.`);
    return res.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Scheduled local-agent monitoring]", error);
    return res.status(500).json({ error: message, context: { path: req.path }, timestamp: new Date().toISOString() });
  }
}
