import { and, desc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  billingRecords,
  cloudConnections,
  governanceAlerts,
  governanceApprovers,
  governanceAuditEvents,
  governanceSettings,
  incidentEscalationProfiles,
  InsertUser,
  localAgentJobs,
  localAgentKeys,
  localAgentReadinessAlerts,
  localAgentEscalationEvents,
  mockResources,
  providerOnboarding,
  shredListItems,
  shredListApprovals,
  shredLists,
  siemForwardingProfiles,
  users,
} from "../drizzle/schema";
import { ENV } from './_core/env';
import { calculateFeeCents, DEFAULT_FEE_RATE_BPS, DEFAULT_MIN_MONTHLY_COST_CENTS, isWastefulResource, MOCK_RESOURCE_BLUEPRINTS, selectApprovedActiveItems, shouldCreateHighValueAlert } from "./governance.logic";
import { getProviderAdapterReadiness } from "./providerAdapters";
import { canExtendAuditRetention } from "./productionGovernance.logic";
import { buildLocalAgentManifest, canAcceptLocalAgentReceipt, canIssueLocalAgentJob, deriveLocalAgentReadiness, hashManifest, planLocalAgentKeyRotation, type LocalAgentJobType, verifyLocalAgentReceipt } from "./localAgent.logic";
import { buildAgentReadinessAlert } from "./organizationAgent.logic";
import { notifyOwner } from "./_core/notification";
import { buildIncidentHandoffPersistencePlan, buildManualEscalationTestPayload, type EscalationProvider } from "./escalation.logic";
import { persistIncidentHandoff } from "./escalationHandoff.persistence";

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function getUserByEmail(email: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const result = await db.select().from(users).where(eq(users.email, email.trim().toLowerCase())).limit(1);
  return result[0];
}

export async function getOrCreateGovernanceSettings(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const existing = await db.select().from(governanceSettings).where(eq(governanceSettings.userId, userId)).limit(1);
  if (existing[0]) return existing[0];
  await db.insert(governanceSettings).values({
    userId,
    feeRateBps: DEFAULT_FEE_RATE_BPS,
    minimumMonthlyCostCents: DEFAULT_MIN_MONTHLY_COST_CENTS,
  });
  const created = await db.select().from(governanceSettings).where(eq(governanceSettings.userId, userId)).limit(1);
  if (!created[0]) throw new Error("Could not initialize governance settings");
  return created[0];
}

export async function updateGovernanceSettings(userId: number, values: { feeRateBps?: number; minimumMonthlyCostCents?: number; scanCronExpression?: string; highValueThresholdCents?: number; requireAdminAuthorization?: boolean; alertsEnabled?: boolean; requiredApprovalCount?: number; auditRetentionDays?: number }) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const existing = await getOrCreateGovernanceSettings(userId);
  if (values.auditRetentionDays !== undefined && !canExtendAuditRetention(existing.auditRetentionDays, values.auditRetentionDays)) throw new Error("Audit retention is append-only and may only be extended");
  await db.update(governanceSettings).set(values).where(eq(governanceSettings.userId, userId));
  return getOrCreateGovernanceSettings(userId);
}

export async function setScheduleTaskUid(userId: number, taskUid: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  await db.update(governanceSettings).set({ scheduleCronTaskUid: taskUid }).where(eq(governanceSettings.userId, userId));
  return getOrCreateGovernanceSettings(userId);
}

export async function confirmPublishedRelease(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  await getOrCreateGovernanceSettings(userId);
  await db.update(governanceSettings).set({ releasePublishedAt: new Date() }).where(eq(governanceSettings.userId, userId));
  await recordAuditEvent(userId, userId, "release_publication_confirmed", "governance_settings", null, "Operator confirmed that the current checkpoint was published before scheduling periodic analysis.");
  return getOrCreateGovernanceSettings(userId);
}

export async function setAgentMonitoringTaskUid(userId: number, taskUid: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  await db.update(governanceSettings).set({ agentMonitoringCronTaskUid: taskUid }).where(eq(governanceSettings.userId, userId));
  return getOrCreateGovernanceSettings(userId);
}

export async function runScheduledAnalysisByTaskUid(taskUid: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const settings = await db.select().from(governanceSettings).where(eq(governanceSettings.scheduleCronTaskUid, taskUid)).limit(1);
  if (!settings[0]) return { skipped: "orphan" } as const;
  const result = await analyzeMockInfrastructure(settings[0].userId, "scheduled");
  return { skipped: false, ownerUserId: settings[0].userId, ...result } as const;
}

export async function createCloudConnection(userId: number, values: {
  provider: "aws" | "azure" | "gcp";
  label: string;
  encryptedCredential: string;
  cryptoMetadata: string;
  accessProfile: "inventory_read_only";
  resourceScope: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const result = await db.insert(cloudConnections).values({ userId, ...values });
  return { id: Number(result[0].insertId) };
}

export async function listCloudConnections(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  return db.select({
    id: cloudConnections.id,
    provider: cloudConnections.provider,
    label: cloudConnections.label,
    accessProfile: cloudConnections.accessProfile,
    resourceScope: cloudConnections.resourceScope,
    createdAt: cloudConnections.createdAt,
    updatedAt: cloudConnections.updatedAt,
  }).from(cloudConnections).where(eq(cloudConnections.userId, userId)).orderBy(desc(cloudConnections.createdAt));
}

export async function getProviderReadiness(userId: number) {
  const connections = await listCloudConnections(userId);
  return (["aws", "azure", "gcp"] as const).map(provider => getProviderAdapterReadiness(provider, connections.some(connection => connection.provider === provider)));
}

export async function enrollProviderOnboarding(userId: number, provider: "aws" | "azure" | "gcp", readOnlyProfile: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const existing = await db.select({ id: providerOnboarding.id }).from(providerOnboarding).where(and(eq(providerOnboarding.userId, userId), eq(providerOnboarding.provider, provider))).limit(1);
  if (existing[0]) await db.update(providerOnboarding).set({ readOnlyProfile, status: "connector_required", connectorUid: null, validatedAt: null }).where(eq(providerOnboarding.id, existing[0].id));
  else await db.insert(providerOnboarding).values({ userId, provider, readOnlyProfile, status: "connector_required" });
  await recordAuditEvent(userId, userId, "provider_onboarding_prepared", "provider_onboarding", existing[0]?.id ?? null, `Prepared ${provider.toUpperCase()} read-only provider onboarding; a verified connector is required before live discovery.`);
  return listProviderOnboarding(userId);
}

export async function listProviderOnboarding(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  return db.select().from(providerOnboarding).where(eq(providerOnboarding.userId, userId)).orderBy(desc(providerOnboarding.updatedAt));
}

export async function createSiemForwardingProfile(userId: number, values: { provider: "splunk_hec" | "datadog_logs" | "generic_https"; label: string; endpointHost: string; encryptedConfiguration: string; cryptoMetadata: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const result = await db.insert(siemForwardingProfiles).values({ userId, ...values, status: "connector_required", enabled: false });
  const id = Number(result[0].insertId);
  await recordAuditEvent(userId, userId, "siem_profile_sealed", "siem_forwarding_profile", id, `Sealed a ${values.provider} SIEM forwarding profile; connector validation is required before forwarding.`, { label: values.label, endpointHost: values.endpointHost });
  return { id };
}

export async function listSiemForwardingProfiles(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  return db.select({ id: siemForwardingProfiles.id, provider: siemForwardingProfiles.provider, label: siemForwardingProfiles.label, endpointHost: siemForwardingProfiles.endpointHost, connectorUid: siemForwardingProfiles.connectorUid, status: siemForwardingProfiles.status, enabled: siemForwardingProfiles.enabled, validatedAt: siemForwardingProfiles.validatedAt, createdAt: siemForwardingProfiles.createdAt, updatedAt: siemForwardingProfiles.updatedAt }).from(siemForwardingProfiles).where(eq(siemForwardingProfiles.userId, userId)).orderBy(desc(siemForwardingProfiles.createdAt));
}

export async function registerLocalAgentKey(userId: number, agentId: string, publicKeyJwk: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  try { JSON.parse(publicKeyJwk); } catch { throw new Error("Agent public key must be valid JWK JSON"); }
  const existing = await db.select({ id: localAgentKeys.id }).from(localAgentKeys).where(and(eq(localAgentKeys.userId, userId), eq(localAgentKeys.agentId, agentId))).limit(1);
  if (existing[0]) await db.update(localAgentKeys).set({ publicKeyJwk, status: "active", revokedAt: null }).where(eq(localAgentKeys.id, existing[0].id));
  else await db.insert(localAgentKeys).values({ userId, agentId, publicKeyJwk, status: "active" });
  await recordAuditEvent(userId, userId, "local_agent_registered", "local_agent_key", existing[0]?.id ?? null, `Registered or rotated the local agent identity ${agentId}.`);
  return listLocalAgentKeys(userId);
}

export async function listLocalAgentKeys(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  return db.select({ id: localAgentKeys.id, agentId: localAgentKeys.agentId, operationalOwnerName: localAgentKeys.operationalOwnerName, operationalOwnerEmail: localAgentKeys.operationalOwnerEmail, status: localAgentKeys.status, createdAt: localAgentKeys.createdAt, revokedAt: localAgentKeys.revokedAt }).from(localAgentKeys).where(eq(localAgentKeys.userId, userId)).orderBy(desc(localAgentKeys.createdAt));
}

export async function updateLocalAgentOwnership(userId: number, keyId: number, operationalOwnerName: string, operationalOwnerEmail: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const key = await db.select({ id: localAgentKeys.id, agentId: localAgentKeys.agentId }).from(localAgentKeys).where(and(eq(localAgentKeys.id, keyId), eq(localAgentKeys.userId, userId))).limit(1);
  if (!key[0]) throw new Error("Local-agent key was not found");
  await db.update(localAgentKeys).set({ operationalOwnerName, operationalOwnerEmail }).where(eq(localAgentKeys.id, keyId));
  await recordAuditEvent(userId, userId, "local_agent_owner_assigned", "local_agent_key", keyId, `Assigned ${operationalOwnerName} as operational owner for local agent ${key[0].agentId}.`, { operationalOwnerEmail });
  return listLocalAgentKeys(userId);
}

export async function revokeLocalAgentKey(userId: number, keyId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const key = await db.select({ id: localAgentKeys.id, agentId: localAgentKeys.agentId, status: localAgentKeys.status }).from(localAgentKeys).where(and(eq(localAgentKeys.id, keyId), eq(localAgentKeys.userId, userId))).limit(1);
  if (!key[0]) throw new Error("Local-agent key was not found");
  if (key[0].status === "active") {
    await db.update(localAgentKeys).set({ status: "revoked", revokedAt: new Date() }).where(eq(localAgentKeys.id, keyId));
    await recordAuditEvent(userId, userId, "local_agent_key_revoked", "local_agent_key", keyId, `Revoked local-agent key ${key[0].agentId}.`);
  }
  return listLocalAgentKeys(userId);
}

export async function rotateLocalAgentKey(userId: number, retiringKeyId: number, agentId: string, publicKeyJwk: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  try { JSON.parse(publicKeyJwk); } catch { throw new Error("Replacement agent public key must be valid JWK JSON"); }
  const retiring = await db.select({ id: localAgentKeys.id, status: localAgentKeys.status }).from(localAgentKeys).where(and(eq(localAgentKeys.id, retiringKeyId), eq(localAgentKeys.userId, userId))).limit(1);
  if (!retiring[0]) throw new Error("Retiring local-agent key was not found");
  const rotation = planLocalAgentKeyRotation(retiring[0].status);
  if (!rotation.allowed) throw new Error("Only an active local-agent key may be rotated");
  await db.update(localAgentKeys).set({ status: rotation.retiringStatus, revokedAt: new Date() }).where(eq(localAgentKeys.id, retiringKeyId));
  const result = await db.insert(localAgentKeys).values({ userId, agentId, publicKeyJwk, status: rotation.replacementStatus });
  await recordAuditEvent(userId, userId, "local_agent_key_rotated", "local_agent_key", Number(result[0].insertId), `Rotated local-agent key ${retiringKeyId} to a new active identity ${agentId}.`, { retiredKeyId: retiringKeyId });
  return listLocalAgentKeys(userId);
}

export async function queueLocalAgentJob(userId: number, agentKeyId: number, jobType: LocalAgentJobType) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const key = await db.select({ id: localAgentKeys.id, status: localAgentKeys.status }).from(localAgentKeys).where(and(eq(localAgentKeys.id, agentKeyId), eq(localAgentKeys.userId, userId))).limit(1);
  if (!key[0] || !canIssueLocalAgentJob(key[0].status)) throw new Error("An active local-agent identity is required before issuing a job");
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  const provisional = await db.insert(localAgentJobs).values({ userId, agentKeyId, jobType, manifest: "pending", manifestHash: "pending", expiresAt });
  const jobId = Number(provisional[0].insertId);
  const manifest = buildLocalAgentManifest(jobId, jobType, expiresAt);
  const manifestJson = JSON.stringify(manifest);
  await db.update(localAgentJobs).set({ manifest: manifestJson, manifestHash: hashManifest(manifest) }).where(eq(localAgentJobs.id, jobId));
  await recordAuditEvent(userId, userId, "local_agent_job_queued", "local_agent_job", jobId, `Queued ${jobType.replaceAll("_", " ")} for a user-controlled local agent.`, manifest);
  return { jobId, manifest, expiresAt };
}

export async function submitLocalAgentReceipt(userId: number, jobId: number, receipt: string, receiptSignature: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const job = await db.select({ id: localAgentJobs.id, status: localAgentJobs.status, expiresAt: localAgentJobs.expiresAt, agentKeyId: localAgentJobs.agentKeyId, publicKeyJwk: localAgentKeys.publicKeyJwk }).from(localAgentJobs).innerJoin(localAgentKeys, eq(localAgentJobs.agentKeyId, localAgentKeys.id)).where(and(eq(localAgentJobs.id, jobId), eq(localAgentJobs.userId, userId), eq(localAgentKeys.status, "active"))).limit(1);
  if (!job[0]) throw new Error("Active local-agent job was not found");
  if (!canAcceptLocalAgentReceipt(job[0].status, job[0].expiresAt)) {
    if (job[0].status === "queued") await db.update(localAgentJobs).set({ status: "expired" }).where(eq(localAgentJobs.id, jobId));
    throw new Error(job[0].status === "queued" ? "Local-agent job has expired" : "Local-agent receipts are append-only and may only be submitted once");
  }
  const verified = verifyLocalAgentReceipt(JSON.parse(job[0].publicKeyJwk), receipt, receiptSignature);
  if (!verified) throw new Error("Local-agent receipt signature could not be verified");
  await db.update(localAgentJobs).set({ status: "completed", receipt, receiptSignature, completedAt: new Date() }).where(eq(localAgentJobs.id, jobId));
  await recordAuditEvent(userId, null, "local_agent_receipt_verified", "local_agent_job", jobId, "Verified and recorded a signed local-agent job receipt.");
  return { success: true } as const;
}

export async function listLocalAgentJobs(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  return db.select({ id: localAgentJobs.id, jobType: localAgentJobs.jobType, status: localAgentJobs.status, manifest: localAgentJobs.manifest, manifestHash: localAgentJobs.manifestHash, completedAt: localAgentJobs.completedAt, expiresAt: localAgentJobs.expiresAt, createdAt: localAgentJobs.createdAt, agentId: localAgentKeys.agentId }).from(localAgentJobs).innerJoin(localAgentKeys, eq(localAgentJobs.agentKeyId, localAgentKeys.id)).where(eq(localAgentJobs.userId, userId)).orderBy(desc(localAgentJobs.createdAt));
}

export async function getLocalAgentReadiness(userId: number) {
  const [keys, jobs] = await Promise.all([listLocalAgentKeys(userId), listLocalAgentJobs(userId)]);
  const activeAgentCount = keys.filter(key => key.status === "active").length;
  const lastVerifiedReceipt = jobs.find(job => job.status === "completed")?.completedAt ?? null;
  const lastHealthCheck = jobs.find(job => job.jobType === "health_check" && job.status === "completed")?.completedAt ?? null;
  const state = deriveLocalAgentReadiness({ activeAgentCount, lastVerifiedReceipt, lastHealthCheck });
  return { state, activeAgentCount, lastVerifiedReceipt, lastHealthCheck } as const;
}

export async function evaluateLocalAgentReadiness(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const [readiness, keys] = await Promise.all([getLocalAgentReadiness(userId), listLocalAgentKeys(userId)]);
  const activeKey = keys.find(key => key.status === "active") ?? null;
  const alert = buildAgentReadinessAlert(readiness.state, activeKey?.operationalOwnerName ?? null);
  if (!alert) {
    await db.update(localAgentReadinessAlerts).set({ status: "resolved", resolvedAt: new Date() }).where(and(eq(localAgentReadinessAlerts.userId, userId), eq(localAgentReadinessAlerts.status, "open")));
    return { readiness, alert: null } as const;
  }
  const existing = await db.select({ id: localAgentReadinessAlerts.id }).from(localAgentReadinessAlerts).where(and(eq(localAgentReadinessAlerts.userId, userId), eq(localAgentReadinessAlerts.alertType, alert.alertType), eq(localAgentReadinessAlerts.status, "open"))).limit(1);
  if (existing[0]) return { readiness, alert: { id: existing[0].id, ...alert, created: false } } as const;
  const result = await db.insert(localAgentReadinessAlerts).values({ userId, agentKeyId: activeKey?.id ?? null, alertType: alert.alertType, summary: alert.summary });
  const id = Number(result[0].insertId);
  await recordAuditEvent(userId, null, "local_agent_readiness_alert_created", "local_agent_readiness_alert", id, alert.summary);
  try { await notifyOwner({ title: `Local-agent readiness: ${alert.alertType.replaceAll("_", " ")}`, content: alert.summary }); } catch (error) { console.warn("[Local agent readiness] Owner notification could not be delivered", error); }
  return { readiness, alert: { id, ...alert, created: true } } as const;
}

export async function evaluateLocalAgentReadinessByTaskUid(taskUid: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const settings = await db.select({ userId: governanceSettings.userId }).from(governanceSettings).where(eq(governanceSettings.agentMonitoringCronTaskUid, taskUid)).limit(1);
  if (!settings[0]) return { skipped: "orphan" } as const;
  const result = await evaluateLocalAgentReadiness(settings[0].userId);
  return { skipped: false, ownerUserId: settings[0].userId, ...result } as const;
}

export async function listLocalAgentReadinessAlerts(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  return db.select({ id: localAgentReadinessAlerts.id, alertType: localAgentReadinessAlerts.alertType, status: localAgentReadinessAlerts.status, escalationState: localAgentReadinessAlerts.escalationState, summary: localAgentReadinessAlerts.summary, assigneeName: localAgentReadinessAlerts.assigneeName, assigneeEmail: localAgentReadinessAlerts.assigneeEmail, createdAt: localAgentReadinessAlerts.createdAt, acknowledgedAt: localAgentReadinessAlerts.acknowledgedAt, resolvedAt: localAgentReadinessAlerts.resolvedAt, agentId: localAgentKeys.agentId, operationalOwnerName: localAgentKeys.operationalOwnerName }).from(localAgentReadinessAlerts).leftJoin(localAgentKeys, eq(localAgentReadinessAlerts.agentKeyId, localAgentKeys.id)).where(eq(localAgentReadinessAlerts.userId, userId)).orderBy(desc(localAgentReadinessAlerts.createdAt));
}

export async function createIncidentEscalationProfile(userId: number, values: { provider: EscalationProvider; label: string; endpointHost: string; encryptedConfiguration: string; cryptoMetadata: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const result = await db.insert(incidentEscalationProfiles).values({ userId, ...values });
  const id = Number(result[0].insertId);
  await recordAuditEvent(userId, userId, "escalation_route_sealed", "incident_escalation_profile", id, `Sealed ${values.provider.replaceAll("_", " ")} escalation route ${values.label}.`, { endpointHost: values.endpointHost });
  return { id };
}

export async function listIncidentEscalationProfiles(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  return db.select({ id: incidentEscalationProfiles.id, provider: incidentEscalationProfiles.provider, label: incidentEscalationProfiles.label, endpointHost: incidentEscalationProfiles.endpointHost, status: incidentEscalationProfiles.status, createdAt: incidentEscalationProfiles.createdAt, updatedAt: incidentEscalationProfiles.updatedAt }).from(incidentEscalationProfiles).where(eq(incidentEscalationProfiles.userId, userId)).orderBy(desc(incidentEscalationProfiles.createdAt));
}

export async function handoffLocalAgentReadinessAlert(userId: number, alertId: number, assigneeName: string, assigneeEmail: string, escalationProfileId?: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const alert = await db.select({ id: localAgentReadinessAlerts.id, summary: localAgentReadinessAlerts.summary }).from(localAgentReadinessAlerts).where(and(eq(localAgentReadinessAlerts.id, alertId), eq(localAgentReadinessAlerts.userId, userId))).limit(1);
  if (!alert[0]) throw new Error("Readiness alert was not found");
  if (escalationProfileId) {
    const profile = await db.select({ id: incidentEscalationProfiles.id }).from(incidentEscalationProfiles).where(and(eq(incidentEscalationProfiles.id, escalationProfileId), eq(incidentEscalationProfiles.userId, userId))).limit(1);
    if (!profile[0]) throw new Error("Escalation profile was not found");
  }
  await persistIncidentHandoff({
    updateAlert: async update => { await db.update(localAgentReadinessAlerts).set(update).where(eq(localAgentReadinessAlerts.id, alertId)); },
    appendEscalationEvent: async event => { await db.insert(localAgentEscalationEvents).values({ userId, alertId, escalationProfileId: event.escalationProfileId, eventType: event.eventType, summary: event.summary }); },
    appendAuditEvent: async event => { await recordAuditEvent(userId, userId, "local_agent_incident_handed_off", "local_agent_readiness_alert", alertId, event.summary, { escalationProfileId: event.escalationProfileId }); },
  }, assigneeName, assigneeEmail, escalationProfileId);
  return listLocalAgentReadinessAlerts(userId);
}

export async function completeLocalAgentEscalation(userId: number, alertId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const alert = await db.select({ id: localAgentReadinessAlerts.id, escalationState: localAgentReadinessAlerts.escalationState, summary: localAgentReadinessAlerts.summary }).from(localAgentReadinessAlerts).where(and(eq(localAgentReadinessAlerts.id, alertId), eq(localAgentReadinessAlerts.userId, userId))).limit(1);
  if (!alert[0]) throw new Error("Readiness alert was not found");
  if (alert[0].escalationState !== "handoff_recorded") throw new Error("Record an incident handoff before completing escalation response");
  await db.update(localAgentReadinessAlerts).set({ escalationState: "response_complete" }).where(eq(localAgentReadinessAlerts.id, alertId));
  await recordAuditEvent(userId, userId, "local_agent_escalation_response_completed", "local_agent_readiness_alert", alertId, `Completed escalation response for readiness incident: ${alert[0].summary}`);
  return listLocalAgentReadinessAlerts(userId);
}

export async function prepareEscalationManualTest(userId: number, profileId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const profile = await db.select({ id: incidentEscalationProfiles.id, provider: incidentEscalationProfiles.provider, endpointHost: incidentEscalationProfiles.endpointHost }).from(incidentEscalationProfiles).where(and(eq(incidentEscalationProfiles.id, profileId), eq(incidentEscalationProfiles.userId, userId))).limit(1);
  if (!profile[0]) throw new Error("Escalation profile was not found");
  const payload = buildManualEscalationTestPayload(profile[0].provider, profile[0].endpointHost);
  await recordAuditEvent(userId, userId, "escalation_manual_test_prepared", "incident_escalation_profile", profileId, `Prepared a credential-free manual delivery test for ${profile[0].endpointHost}.`, payload);
  return payload;
}

export async function recordEscalationManualTest(userId: number, profileId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const profile = await db.select({ id: incidentEscalationProfiles.id, label: incidentEscalationProfiles.label }).from(incidentEscalationProfiles).where(and(eq(incidentEscalationProfiles.id, profileId), eq(incidentEscalationProfiles.userId, userId))).limit(1);
  if (!profile[0]) throw new Error("Escalation profile was not found");
  await db.update(incidentEscalationProfiles).set({ status: "manual_tested" }).where(eq(incidentEscalationProfiles.id, profileId));
  await recordAuditEvent(userId, userId, "escalation_manual_test_recorded", "incident_escalation_profile", profileId, `Recorded a local delivery test for escalation route ${profile[0].label}.`);
  return listIncidentEscalationProfiles(userId);
}

export async function acknowledgeLocalAgentReadinessAlert(userId: number, alertId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const alert = await db.select({ id: localAgentReadinessAlerts.id, summary: localAgentReadinessAlerts.summary, status: localAgentReadinessAlerts.status }).from(localAgentReadinessAlerts).where(and(eq(localAgentReadinessAlerts.id, alertId), eq(localAgentReadinessAlerts.userId, userId))).limit(1);
  if (!alert[0]) throw new Error("Readiness alert was not found");
  if (alert[0].status === "open") {
    await db.update(localAgentReadinessAlerts).set({ status: "acknowledged", acknowledgedAt: new Date() }).where(eq(localAgentReadinessAlerts.id, alertId));
    await recordAuditEvent(userId, userId, "local_agent_readiness_alert_acknowledged", "local_agent_readiness_alert", alertId, `Acknowledged local-agent readiness alert: ${alert[0].summary}`);
  }
  return listLocalAgentReadinessAlerts(userId);
}

export async function recordAuditEvent(ownerUserId: number, actorUserId: number | null, eventType: string, entityType: string, entityId: number | null, summary: string, payload?: unknown) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const result = await db.insert(governanceAuditEvents).values({ ownerUserId, actorUserId, eventType, entityType, entityId, summary, payload: payload ? JSON.stringify(payload) : null });
  return Number(result[0].insertId);
}

export async function listAuditEvents(ownerUserId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  return db.select({ id: governanceAuditEvents.id, eventType: governanceAuditEvents.eventType, entityType: governanceAuditEvents.entityType, entityId: governanceAuditEvents.entityId, summary: governanceAuditEvents.summary, payload: governanceAuditEvents.payload, createdAt: governanceAuditEvents.createdAt, actorName: users.name, actorEmail: users.email }).from(governanceAuditEvents).leftJoin(users, eq(governanceAuditEvents.actorUserId, users.id)).where(eq(governanceAuditEvents.ownerUserId, ownerUserId)).orderBy(desc(governanceAuditEvents.createdAt));
}

export async function ensureSelfApprover(ownerUserId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const existing = await db.select({ id: governanceApprovers.id }).from(governanceApprovers).where(and(eq(governanceApprovers.ownerUserId, ownerUserId), eq(governanceApprovers.approverUserId, ownerUserId))).limit(1);
  if (!existing[0]) await db.insert(governanceApprovers).values({ ownerUserId, approverUserId: ownerUserId });
}

export async function listApprovers(ownerUserId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  await ensureSelfApprover(ownerUserId);
  return db.select({ id: governanceApprovers.id, approverUserId: governanceApprovers.approverUserId, name: users.name, email: users.email, createdAt: governanceApprovers.createdAt }).from(governanceApprovers).innerJoin(users, eq(governanceApprovers.approverUserId, users.id)).where(eq(governanceApprovers.ownerUserId, ownerUserId));
}

export async function addApproverByEmail(ownerUserId: number, email: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const user = await getUserByEmail(email);
  if (!user) throw new Error("The approver must sign in to Mainframe Cloud Governor before enrollment");
  const existing = await db.select({ id: governanceApprovers.id }).from(governanceApprovers).where(and(eq(governanceApprovers.ownerUserId, ownerUserId), eq(governanceApprovers.approverUserId, user.id))).limit(1);
  if (!existing[0]) {
    await db.insert(governanceApprovers).values({ ownerUserId, approverUserId: user.id });
    await recordAuditEvent(ownerUserId, ownerUserId, "approver_enrolled", "approver", user.id, `Enrolled ${user.email ?? user.name ?? "a team member"} as a named shred-list approver.`);
  }
  return listApprovers(ownerUserId);
}

export async function ensureMockInfrastructure(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const existing = await db.select({ id: mockResources.id }).from(mockResources).where(eq(mockResources.userId, userId)).limit(1);
  if (existing.length > 0) return { created: false, count: 0 };
  await db.insert(mockResources).values(MOCK_RESOURCE_BLUEPRINTS.map(resource => ({ userId, ...resource })));
  return { created: true, count: MOCK_RESOURCE_BLUEPRINTS.length };
}

export async function analyzeMockInfrastructure(userId: number, source: "manual" | "scheduled") {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  await ensureMockInfrastructure(userId);
  const settings = await getOrCreateGovernanceSettings(userId);
  const resources = await db.select().from(mockResources).where(and(eq(mockResources.userId, userId), eq(mockResources.status, "active")));
  const candidates = resources.filter(resource => isWastefulResource(resource, settings.minimumMonthlyCostCents));
  const estimatedSavingsCents = candidates.reduce((sum, resource) => sum + resource.monthlyCostCents, 0);
  const listInsert = await db.insert(shredLists).values({
    userId,
    source,
    totalItems: candidates.length,
    estimatedSavingsCents,
  });
  const shredListId = Number(listInsert[0].insertId);
  if (candidates.length > 0) {
    await db.insert(shredListItems).values(candidates.map(resource => ({
      shredListId,
      resourceId: resource.id,
      estimatedMonthlySavingsCents: resource.monthlyCostCents,
    })));
  }
  let alert: { id: number; estimatedSavingsCents: number } | null = null;
  if (shouldCreateHighValueAlert(estimatedSavingsCents, settings.highValueThresholdCents, settings.alertsEnabled)) {
    const alertInsert = await db.insert(governanceAlerts).values({ userId, shredListId, estimatedSavingsCents });
    alert = { id: Number(alertInsert[0].insertId), estimatedSavingsCents };
  }
  return { shredListId, totalItems: candidates.length, estimatedSavingsCents, alert };
}

export async function markAlertDelivery(alertId: number, delivered: boolean) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  await db.update(governanceAlerts).set({ status: delivered ? "delivered" : "delivery_failed", notifiedAt: new Date() }).where(eq(governanceAlerts.id, alertId));
}

export async function listGovernanceAlerts(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  return db.select().from(governanceAlerts).where(eq(governanceAlerts.userId, userId)).orderBy(desc(governanceAlerts.createdAt));
}

export async function reviewShredList(ownerUserId: number, approverUserId: number, shredListId: number, decision: "approved" | "rejected", note?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const list = await db.select({ id: shredLists.id }).from(shredLists).where(and(eq(shredLists.id, shredListId), eq(shredLists.userId, ownerUserId), eq(shredLists.status, "active"))).limit(1);
  if (!list[0]) throw new Error("Active shred list was not found");
  await ensureSelfApprover(ownerUserId);
  const membership = await db.select({ id: governanceApprovers.id }).from(governanceApprovers).where(and(eq(governanceApprovers.ownerUserId, ownerUserId), eq(governanceApprovers.approverUserId, approverUserId))).limit(1);
  if (!membership[0]) throw new Error("You are not registered as an approver for this governance workspace");
  const existing = await db.select({ id: shredListApprovals.id }).from(shredListApprovals).where(and(eq(shredListApprovals.shredListId, shredListId), eq(shredListApprovals.approverUserId, approverUserId))).limit(1);
  if (existing[0]) await db.update(shredListApprovals).set({ decision, note: note || null, reviewedAt: new Date() }).where(eq(shredListApprovals.id, existing[0].id));
  else await db.insert(shredListApprovals).values({ shredListId, approverUserId, decision, note: note || null });
  await recordAuditEvent(ownerUserId, approverUserId, `shred_list_${decision}`, "shred_list", shredListId, `Named approver recorded ${decision} for shred list #${shredListId}.`, { note: note || null });
  return getApprovalProgress(ownerUserId, shredListId);
}

export async function getApprovalProgress(ownerUserId: number, shredListId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const list = await db.select({ id: shredLists.id }).from(shredLists).where(and(eq(shredLists.id, shredListId), eq(shredLists.userId, ownerUserId))).limit(1);
  if (!list[0]) throw new Error("Shred list was not found");
  const settings = await getOrCreateGovernanceSettings(ownerUserId);
  const approvals = await db.select({ id: shredListApprovals.id, approverUserId: shredListApprovals.approverUserId, decision: shredListApprovals.decision, note: shredListApprovals.note, reviewedAt: shredListApprovals.reviewedAt, approverName: users.name, approverEmail: users.email }).from(shredListApprovals).innerJoin(users, eq(shredListApprovals.approverUserId, users.id)).where(eq(shredListApprovals.shredListId, shredListId));
  return { approvals, approvedCount: new Set(approvals.filter(approval => approval.decision === "approved").map(approval => approval.approverUserId)).size, requiredApprovalCount: settings.requiredApprovalCount };
}

export async function listApprovalQueue(ownerUserId: number) {
  const lists = await listShredLists(ownerUserId);
  return Promise.all(lists.filter(list => list.status === "active").map(async list => ({ list, progress: await getApprovalProgress(ownerUserId, list.id) })));
}

export async function listAssignedApprovalQueues(approverUserId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  await ensureSelfApprover(approverUserId);
  const memberships = await db.select({ ownerUserId: governanceApprovers.ownerUserId }).from(governanceApprovers).where(eq(governanceApprovers.approverUserId, approverUserId));
  const queues = await Promise.all(memberships.map(async membership => ({ ownerUserId: membership.ownerUserId, queue: await listApprovalQueue(membership.ownerUserId) })));
  return queues.flatMap(workspace => workspace.queue.map(entry => ({ ownerUserId: workspace.ownerUserId, ...entry })));
}

export async function reviewAssignedShredList(approverUserId: number, shredListId: number, decision: "approved" | "rejected", note?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const list = await db.select({ ownerUserId: shredLists.userId }).from(shredLists).where(eq(shredLists.id, shredListId)).limit(1);
  if (!list[0]) throw new Error("Shred list was not found");
  return reviewShredList(list[0].ownerUserId, approverUserId, shredListId, decision, note);
}

export async function listShredLists(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  return db.select().from(shredLists).where(eq(shredLists.userId, userId)).orderBy(desc(shredLists.analyzedAt));
}

export async function getShredList(userId: number, shredListId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const list = await db.select().from(shredLists).where(and(eq(shredLists.id, shredListId), eq(shredLists.userId, userId))).limit(1);
  if (!list[0]) return null;
  const items = await db.select({
    id: shredListItems.id,
    decision: shredListItems.decision,
    estimatedMonthlySavingsCents: shredListItems.estimatedMonthlySavingsCents,
    decidedAt: shredListItems.decidedAt,
    shreddedAt: shredListItems.shreddedAt,
    resourceId: mockResources.id,
    accountAlias: mockResources.accountAlias,
    provider: mockResources.provider,
    resourceType: mockResources.resourceType,
    resourceName: mockResources.resourceName,
    region: mockResources.region,
    idleHours: mockResources.idleHours,
    monthlyCostCents: mockResources.monthlyCostCents,
    resourceStatus: mockResources.status,
  }).from(shredListItems).innerJoin(mockResources, eq(shredListItems.resourceId, mockResources.id)).where(eq(shredListItems.shredListId, shredListId));
  return { ...list[0], items };
}

export async function setShredDecision(userId: number, itemId: number, decision: "approved" | "rejected") {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const item = await db.select({ id: shredListItems.id }).from(shredListItems)
    .innerJoin(shredLists, eq(shredListItems.shredListId, shredLists.id))
    .where(and(eq(shredListItems.id, itemId), eq(shredLists.userId, userId), eq(shredLists.status, "active"))).limit(1);
  if (!item[0]) throw new Error("Shred-list item was not found or is no longer editable");
  await db.update(shredListItems).set({ decision, decidedAt: new Date() }).where(eq(shredListItems.id, itemId));
  return { success: true } as const;
}

export async function executeApprovedTeardowns(userId: number, shredListId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const list = await getShredList(userId, shredListId);
  if (!list || list.status !== "active") throw new Error("Active shred list was not found");
  const approved = selectApprovedActiveItems(list.items);
  if (approved.length === 0) throw new Error("Approve at least one active resource before confirming teardown");
  const now = new Date();
  const resourceIds = approved.map(item => item.resourceId);
  const itemIds = approved.map(item => item.id);
  await db.update(mockResources).set({ status: "shredded", shreddedAt: now }).where(inArray(mockResources.id, resourceIds));
  await db.update(shredListItems).set({ decision: "shredded", shreddedAt: now }).where(inArray(shredListItems.id, itemIds));
  await db.update(shredLists).set({ status: "executed" }).where(eq(shredLists.id, shredListId));
  const savedSpendCents = approved.reduce((sum, item) => sum + item.estimatedMonthlySavingsCents, 0);
  const settings = await getOrCreateGovernanceSettings(userId);
  const feeCents = calculateFeeCents(savedSpendCents, settings.feeRateBps);
  const invoice = await db.insert(billingRecords).values({
    userId,
    shredListId,
    savedSpendCents,
    feeRateBps: settings.feeRateBps,
    feeCents,
  });
  return { shreddedCount: approved.length, savedSpendCents, feeCents, invoiceId: Number(invoice[0].insertId) };
}

export async function listBillingRecords(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  return db.select().from(billingRecords).where(eq(billingRecords.userId, userId)).orderBy(desc(billingRecords.issuedAt));
}

export async function getGovernanceDashboard(userId: number) {
  const [settings, connections, lists, invoices, alerts, auditEvents] = await Promise.all([
    getOrCreateGovernanceSettings(userId),
    listCloudConnections(userId),
    listShredLists(userId),
    listBillingRecords(userId),
    listGovernanceAlerts(userId),
    listAuditEvents(userId),
  ]);
  const shreddedSavedCents = invoices.reduce((sum, record) => sum + record.savedSpendCents, 0);
  return { settings, connections, lists, invoices, alerts, auditEvents, shreddedSavedCents };
}
