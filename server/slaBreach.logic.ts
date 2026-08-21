import { deriveIncidentDeadlineState } from "./incidentSla.logic";

export function canPrepareSlaBreachDispatch(input: { autoEscalateSlaBreaches: boolean; routeStatus: "sealed" | "manual_tested" | "disabled"; alertStatus: "open" | "acknowledged" | "resolved"; escalationState: string; responseDueAt: Date | null; breachEscalatedAt: Date | null }, now = new Date()) {
  if (!input.autoEscalateSlaBreaches || input.routeStatus !== "manual_tested" || input.alertStatus === "resolved" || input.escalationState === "response_complete" || input.breachEscalatedAt) return false;
  return deriveIncidentDeadlineState(input.responseDueAt, input.escalationState, now) === "overdue";
}
