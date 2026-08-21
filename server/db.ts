import { and, desc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  billingRecords,
  cloudConnections,
  governanceSettings,
  InsertUser,
  mockResources,
  shredListItems,
  shredLists,
  users,
} from "../drizzle/schema";
import { ENV } from './_core/env';
import { calculateFeeCents, DEFAULT_FEE_RATE_BPS, DEFAULT_MIN_MONTHLY_COST_CENTS, isWastefulResource, MOCK_RESOURCE_BLUEPRINTS, selectApprovedActiveItems } from "./governance.logic";

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

export async function updateGovernanceSettings(userId: number, values: { feeRateBps?: number; minimumMonthlyCostCents?: number; scanCronExpression?: string }) {
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
  return { skipped: false, ...result } as const;
}

export async function createCloudConnection(userId: number, values: {
  provider: "aws" | "azure" | "gcp";
  label: string;
  encryptedCredential: string;
  cryptoMetadata: string;
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
    createdAt: cloudConnections.createdAt,
    updatedAt: cloudConnections.updatedAt,
  }).from(cloudConnections).where(eq(cloudConnections.userId, userId)).orderBy(desc(cloudConnections.createdAt));
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
  return { shredListId, totalItems: candidates.length, estimatedSavingsCents };
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
  const [settings, connections, lists, invoices] = await Promise.all([
    getOrCreateGovernanceSettings(userId),
    listCloudConnections(userId),
    listShredLists(userId),
    listBillingRecords(userId),
  ]);
  const shreddedSavedCents = invoices.reduce((sum, record) => sum + record.savedSpendCents, 0);
  return { settings, connections, lists, invoices, shreddedSavedCents };
}
