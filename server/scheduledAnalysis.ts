import type { Request, Response } from "express";
import { markAlertDelivery, recordAuditEvent, runScheduledAnalysisByTaskUid } from "./db";
import { sdk } from "./_core/sdk";
import { notifyOwner } from "./_core/notification";

/** Platform-authenticated, idempotent callback for a user's recurring shred-list analysis. */
export async function scheduledShredAnalysisHandler(req: Request, res: Response) {
  try {
    const user = await sdk.authenticateRequest(req);
    if (!user.isCron || !user.taskUid) return res.status(403).json({ error: "cron-only" });
    const result = await runScheduledAnalysisByTaskUid(user.taskUid);
    if (result.skipped === false) await recordAuditEvent(result.ownerUserId, null, "scheduled_shred_list_generated", "shred_list", result.shredListId, `Scheduled analysis generated a shred list with ${result.totalItems} resource candidates.`, result);
    if (result.skipped === false && result.alert) {
      const delivered = await notifyOwner({ title: "Scheduled high-value shred list detected", content: `Shred list #${result.shredListId} identified ${result.totalItems} resources with ${result.estimatedSavingsCents} cents in estimated monthly savings.` });
      await markAlertDelivery(result.alert.id, delivered);
      await recordAuditEvent(result.ownerUserId, null, "high_value_alert_recorded", "governance_alert", result.alert.id, `Recorded a scheduled high-value alert for shred list #${result.shredListId}.`, result.alert);
      await recordAuditEvent(result.ownerUserId, null, delivered ? "high_value_alert_delivered" : "high_value_alert_delivery_failed", "governance_alert", result.alert.id, delivered ? "Delivered the scheduled high-value alert notification." : "Recorded a failed scheduled high-value alert notification delivery.");
    }
    return res.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Scheduled shred analysis]", error);
    return res.status(500).json({ error: message, context: { path: req.path }, timestamp: new Date().toISOString() });
  }
}
