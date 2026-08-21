import { deriveIncidentDeadlineState } from "./incidentSla.logic";

export function canPrepareSlaBreachDispatch(input: { autoEscalateSlaBreaches: boolean; routeStatus: "sealed" | "manual_tested" | "disabled"; alertStatus: "open" | "acknowledged" | "resolved"; escalationState: string; responseDueAt: Date | null; breachEscalatedAt: Date | null }, now = new Date()) {
  if (!input.autoEscalateSlaBreaches || input.routeStatus !== "manual_tested" || input.alertStatus === "resolved" || input.escalationState === "response_complete" || input.breachEscalatedAt) return false;
  return deriveIncidentDeadlineState(input.responseDueAt, input.escalationState, now) === "overdue";
}

type SealedRouteManifest = { jobType?: string; incident?: { alertId?: number; escalationProfileId?: number } };
type SealedRouteReceipt = { jobType?: string; status?: string; incidentId?: number; delivery?: { escalationProfileId?: number; httpStatus?: number } };

export function getConfirmedSlaBreachReceipt(manifestText: string, receiptText: string) {
  let manifest: SealedRouteManifest; let receipt: SealedRouteReceipt;
  try { manifest = JSON.parse(manifestText); receipt = JSON.parse(receiptText); } catch { return null; }
  const alertId = manifest.incident?.alertId;
  const escalationProfileId = manifest.incident?.escalationProfileId;
  const httpStatus = receipt.delivery?.httpStatus;
  if (manifest.jobType !== "sealed_route_escalation" || receipt.jobType !== "sealed_route_escalation" || receipt.status !== "completed" || !alertId || !escalationProfileId || receipt.incidentId !== alertId || receipt.delivery?.escalationProfileId !== escalationProfileId || !httpStatus || httpStatus < 200 || httpStatus >= 300) return null;
  return { alertId, escalationProfileId, httpStatus } as const;
}

export function isSlaBreachTimelineEvent(eventType: string, filter: "all" | "prepared" | "confirmed") {
  if (filter === "prepared") return eventType === "sla_breach_dispatch_prepared";
  if (filter === "confirmed") return eventType === "sla_breach_dispatch_receipt_confirmed";
  return eventType === "sla_breach_dispatch_prepared" || eventType === "sla_breach_dispatch_receipt_confirmed";
}
