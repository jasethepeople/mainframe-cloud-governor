export type SiemAuditPayload = {
  eventId: number;
  occurredAt: Date | string;
  eventType: string;
  entityType: string;
  entityId: number | null;
  ownerUserId: number;
  summary: string;
};

export function canExtendAuditRetention(currentDays: number, requestedDays: number) {
  return Number.isInteger(requestedDays) && requestedDays >= currentDays;
}

export function serializeSiemAuditPayload(event: SiemAuditPayload) {
  return JSON.stringify({
    schema: "mainframe-cloud-governor.audit.v1",
    source: "mainframe-cloud-governor",
    event_id: event.eventId,
    occurred_at: new Date(event.occurredAt).toISOString(),
    event_type: event.eventType,
    entity: { type: event.entityType, id: event.entityId },
    owner_user_id: event.ownerUserId,
    summary: event.summary,
  });
}

export function isSafeSiemEndpointHost(host: string) {
  const normalized = host.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(normalized)) return false;
  if (normalized === "localhost" || normalized.endsWith(".localhost")) return false;
  if (/^(127\.|10\.|192\.168\.|0\.)/.test(normalized)) return false;
  const private172 = /^172\.(1[6-9]|2\d|3[0-1])\./.test(normalized);
  return !private172;
}
