export type BreachDispatchTimelineEvent = {
  id: number;
  alertId: number;
  eventType: string;
  summary: string;
  createdAt: Date | string;
  profileLabel: string | null;
  endpointHost: string | null;
};

function csvCell(value: unknown) {
  const text = String(value ?? "");
  const protectedText = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${protectedText.replaceAll('"', '""')}"`;
}

export function breachDispatchTimelineToCsv(events: BreachDispatchTimelineEvent[]) {
  const header = ["event_id", "recorded_at", "incident_id", "dispatch_state", "route_label", "endpoint_host", "summary"];
  const rows = events.map(event => [event.id, event.createdAt, event.alertId, event.eventType, event.profileLabel, event.endpointHost, event.summary]);
  return [header, ...rows].map(row => row.map(csvCell).join(",")).join("\n");
}
