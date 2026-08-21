export type AuditExportEvent = {
  id: number;
  createdAt: Date | string;
  eventType: string;
  entityType: string;
  entityId: number | null;
  actorName?: string | null;
  actorEmail?: string | null;
  summary: string;
};

const escapeCell = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;

export function auditEventsToCsv(events: AuditExportEvent[]) {
  const header = ["event_id", "recorded_at", "event_type", "entity_type", "entity_id", "actor", "summary"];
  const rows = events.map(event => [event.id, event.createdAt, event.eventType, event.entityType, event.entityId, event.actorEmail ?? event.actorName, event.summary]);
  return [header, ...rows].map(row => row.map(escapeCell).join(",")).join("\n");
}
