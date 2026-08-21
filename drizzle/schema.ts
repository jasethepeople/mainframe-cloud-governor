import { boolean, int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const cloudConnections = mysqlTable("cloudConnections", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id),
  provider: mysqlEnum("provider", ["aws", "azure", "gcp"]).notNull(),
  label: varchar("label", { length: 100 }).notNull(),
  encryptedCredential: text("encryptedCredential").notNull(),
  cryptoMetadata: text("cryptoMetadata").notNull(),
  accessProfile: mysqlEnum("accessProfile", ["inventory_read_only"]).notNull().default("inventory_read_only"),
  resourceScope: varchar("resourceScope", { length: 160 }).notNull().default("Scoped provider inventory"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const governanceSettings = mysqlTable("governanceSettings", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique().references(() => users.id),
  feeRateBps: int("feeRateBps").notNull().default(1500),
  minimumMonthlyCostCents: int("minimumMonthlyCostCents").notNull().default(2500),
  scanCronExpression: varchar("scanCronExpression", { length: 64 }).notNull().default("0 0 */6 * * *"),
  scheduleCronTaskUid: varchar("scheduleCronTaskUid", { length: 65 }),
  highValueThresholdCents: int("highValueThresholdCents").notNull().default(50000),
  requireAdminAuthorization: boolean("requireAdminAuthorization").notNull().default(false),
  alertsEnabled: boolean("alertsEnabled").notNull().default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const mockResources = mysqlTable("mockResources", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id),
  accountAlias: varchar("accountAlias", { length: 100 }).notNull(),
  provider: mysqlEnum("provider", ["aws", "azure", "gcp"]).notNull(),
  resourceType: mysqlEnum("resourceType", ["idle_container", "unattached_volume"]).notNull(),
  resourceName: varchar("resourceName", { length: 160 }).notNull(),
  region: varchar("region", { length: 80 }).notNull(),
  idleHours: int("idleHours").notNull(),
  monthlyCostCents: int("monthlyCostCents").notNull(),
  status: mysqlEnum("status", ["active", "shredded"]).notNull().default("active"),
  generatedAt: timestamp("generatedAt").defaultNow().notNull(),
  shreddedAt: timestamp("shreddedAt"),
});

export const shredLists = mysqlTable("shredLists", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id),
  source: mysqlEnum("source", ["manual", "scheduled"]).notNull(),
  status: mysqlEnum("status", ["active", "executed", "archived"]).notNull().default("active"),
  totalItems: int("totalItems").notNull().default(0),
  estimatedSavingsCents: int("estimatedSavingsCents").notNull().default(0),
  analyzedAt: timestamp("analyzedAt").defaultNow().notNull(),
});

export const shredListItems = mysqlTable("shredListItems", {
  id: int("id").autoincrement().primaryKey(),
  shredListId: int("shredListId").notNull().references(() => shredLists.id),
  resourceId: int("resourceId").notNull().references(() => mockResources.id),
  decision: mysqlEnum("decision", ["pending", "approved", "rejected", "shredded"]).notNull().default("pending"),
  estimatedMonthlySavingsCents: int("estimatedMonthlySavingsCents").notNull(),
  decidedAt: timestamp("decidedAt"),
  shreddedAt: timestamp("shreddedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const billingRecords = mysqlTable("billingRecords", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id),
  shredListId: int("shredListId").references(() => shredLists.id),
  savedSpendCents: int("savedSpendCents").notNull(),
  feeRateBps: int("feeRateBps").notNull(),
  feeCents: int("feeCents").notNull(),
  status: mysqlEnum("status", ["simulated", "settled"]).notNull().default("simulated"),
  issuedAt: timestamp("issuedAt").defaultNow().notNull(),
});

export const governanceAlerts = mysqlTable("governanceAlerts", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id),
  shredListId: int("shredListId").notNull().references(() => shredLists.id),
  estimatedSavingsCents: int("estimatedSavingsCents").notNull(),
  status: mysqlEnum("status", ["recorded", "delivered", "delivery_failed"]).notNull().default("recorded"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  notifiedAt: timestamp("notifiedAt"),
});

export type CloudConnection = typeof cloudConnections.$inferSelect;
export type GovernanceSettings = typeof governanceSettings.$inferSelect;
export type MockResource = typeof mockResources.$inferSelect;
export type ShredList = typeof shredLists.$inferSelect;
export type ShredListItem = typeof shredListItems.$inferSelect;
export type BillingRecord = typeof billingRecords.$inferSelect;
export type GovernanceAlert = typeof governanceAlerts.$inferSelect;
