import type { Request, Response } from "express";
import { runScheduledAnalysisByTaskUid } from "./db";
import { sdk } from "./_core/sdk";

/** Platform-authenticated, idempotent callback for a user's recurring shred-list analysis. */
export async function scheduledShredAnalysisHandler(req: Request, res: Response) {
  try {
    const user = await sdk.authenticateRequest(req);
    if (!user.isCron || !user.taskUid) return res.status(403).json({ error: "cron-only" });
    const result = await runScheduledAnalysisByTaskUid(user.taskUid);
    return res.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Scheduled shred analysis]", error);
    return res.status(500).json({ error: message, context: { path: req.path }, timestamp: new Date().toISOString() });
  }
}
