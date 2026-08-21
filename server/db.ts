import { and, desc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  billingRecords,
  cloudConnections,
  governanceAlerts,
  governanceApprovers,
  governanceAuditEvents,
  governanceSettings,
  InsertUser,
  mockResources,
  shredListItems,
  shredListApprovals,
  shredLists,
  users,
} from "../drizzle/schema";
import { ENV } from './_core/env';
import { calculateFeeCents, DEFAULT_FEE_RATE_BPS, DEFAULT_MIN_MONTHLY_COST_CENTS, isWastefulResource, MOCK_RESOURCE_BLUEPRINTS, selectApprovedActiveItems, shouldCreateHighValueAlert } from "./governance.logic";
import { getProviderAdapterReadiness } from "./providerAdapters";

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

export async function updateGovernanceSettings(userId: number, values: { feeRateBps?: number; minimumMonthlyCostCents?: number; scanCronExpression?: string; highValueThresholdCents?: number; requireAdminAuthorization?: boolean; alertsEnabled?: boolean; requiredApprovalCount?: number }) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  await getOrCreateGovernanceSettings(userId);
  await db.update(governanceSettings).set(values).where(eq(governanceSettings.userId, userId));
  return getOrCreateGovernanceSettings(userId);
}

export async function setScheduleTaskUid(userId: number, taskUid: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  await db.update(governanceSettings).set({ scheduleCronTaskUid: taskUid }).where(eq(governanceSettings.userId, userId));
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
