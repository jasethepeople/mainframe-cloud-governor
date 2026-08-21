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
  requiredApprovalCount: int("requiredApprovalCount").notNull().default(1),
  auditRetentionDays: int("auditRetentionDays").notNull().default(365),
  releasePublishedAt: timestamp("releasePublishedAt"),
  agentMonitoringCronTaskUid: varchar("agentMonitoringCronTaskUid", { length: 65 }),
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

export const governanceApprovers = mysqlTable("governanceApprovers", {
  id: int("id").autoincrement().primaryKey(),
  ownerUserId: int("ownerUserId").notNull().references(() => users.id),
  approverUserId: int("approverUserId").notNull().references(() => users.id),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const shredListApprovals = mysqlTable("shredListApprovals", {
  id: int("id").autoincrement().primaryKey(),
  shredListId: int("shredListId").notNull().references(() => shredLists.id),
  approverUserId: int("approverUserId").notNull().references(() => users.id),
  decision: mysqlEnum("decision", ["approved", "rejected"]).notNull(),
  note: varchar("note", { length: 500 }),
  reviewedAt: timestamp("reviewedAt").defaultNow().notNull(),
});

export const governanceAuditEvents = mysqlTable("governanceAuditEvents", {
  id: int("id").autoincrement().primaryKey(),
  ownerUserId: int("ownerUserId").notNull().references(() => users.id),
  actorUserId: int("actorUserId").references(() => users.id),
  eventType: varchar("eventType", { length: 80 }).notNull(),
  entityType: varchar("entityType", { length: 80 }).notNull(),
  entityId: int("entityId"),
  summary: varchar("summary", { length: 500 }).notNull(),
  payload: text("payload"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const providerOnboarding = mysqlTable("providerOnboarding", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id),
  provider: mysqlEnum("provider", ["aws", "azure", "gcp"]).notNull(),
  status: mysqlEnum("status", ["profile_ready", "connector_required", "validated"]).notNull().default("profile_ready"),
  readOnlyProfile: varchar("readOnlyProfile", { length: 160 }).notNull(),
  connectorUid: varchar("connectorUid", { length: 80 }),
  validatedAt: timestamp("validatedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const siemForwardingProfiles = mysqlTable("siemForwardingProfiles", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id),
  provider: mysqlEnum("provider", ["splunk_hec", "datadog_logs", "generic_https"]).notNull(),
  label: varchar("label", { length: 100 }).notNull(),
  endpointHost: varchar("endpointHost", { length: 255 }).notNull(),
  encryptedConfiguration: text("encryptedConfiguration").notNull(),
  cryptoMetadata: text("cryptoMetadata").notNull(),
  connectorUid: varchar("connectorUid", { length: 80 }),
  status: mysqlEnum("status", ["connector_required", "verified", "disabled"]).notNull().default("connector_required"),
  enabled: boolean("enabled").notNull().default(false),
  validatedAt: timestamp("validatedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const localAgentKeys = mysqlTable("localAgentKeys", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id),
  agentId: varchar("agentId", { length: 100 }).notNull(),
  operationalOwnerName: varchar("operationalOwnerName", { length: 120 }).notNull().default("Unassigned"),
  operationalOwnerEmail: varchar("operationalOwnerEmail", { length: 320 }).notNull().default("unassigned@example.invalid"),
  publicKeyJwk: text("publicKeyJwk").notNull(),
  status: mysqlEnum("status", ["active", "revoked"]).notNull().default("active"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  revokedAt: timestamp("revokedAt"),
});

export const localAgentJobs = mysqlTable("localAgentJobs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id),
  agentKeyId: int("agentKeyId").notNull().references(() => localAgentKeys.id),
  jobType: mysqlEnum("jobType", ["aws_read_only_discovery", "generic_https_siem_delivery", "health_check"]).notNull(),
  status: mysqlEnum("status", ["queued", "completed", "failed", "expired"]).notNull().default("queued"),
  manifest: text("manifest").notNull(),
  manifestHash: varchar("manifestHash", { length: 128 }).notNull(),
  receipt: text("receipt"),
  receiptSignature: text("receiptSignature"),
  completedAt: timestamp("completedAt"),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const localAgentReadinessAlerts = mysqlTable("localAgentReadinessAlerts", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id),
  agentKeyId: int("agentKeyId").references(() => localAgentKeys.id),
  alertType: mysqlEnum("alertType", ["no_active_key", "health_check_required", "receipt_stale"]).notNull(),
  status: mysqlEnum("status", ["open", "acknowledged", "resolved"]).notNull().default("open"),
  summary: varchar("summary", { length: 500 }).notNull(),
  assigneeName: varchar("assigneeName", { length: 120 }),
  assigneeEmail: varchar("assigneeEmail", { length: 320 }),
  escalationState: mysqlEnum("escalationState", ["unrouted", "handoff_recorded", "response_complete"]).notNull().default("unrouted"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  acknowledgedAt: timestamp("acknowledgedAt"),
  resolvedAt: timestamp("resolvedAt"),
});

export const incidentEscalationProfiles = mysqlTable("incidentEscalationProfiles", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id),
  provider: mysqlEnum("provider", ["generic_https", "slack_webhook", "pagerduty_events"]).notNull(),
  label: varchar("label", { length: 100 }).notNull(),
  endpointHost: varchar("endpointHost", { length: 255 }).notNull(),
  encryptedConfiguration: text("encryptedConfiguration").notNull(),
  cryptoMetadata: text("cryptoMetadata").notNull(),
  status: mysqlEnum("status", ["sealed", "manual_tested", "disabled"]).notNull().default("sealed"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const localAgentEscalationEvents = mysqlTable("localAgentEscalationEvents", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id),
  alertId: int("alertId").notNull().references(() => localAgentReadinessAlerts.id),
  escalationProfileId: int("escalationProfileId").references(() => incidentEscalationProfiles.id),
  eventType: mysqlEnum("eventType", ["handoff", "manual_test_prepared", "manual_test_recorded"]).notNull(),
  summary: varchar("summary", { length: 500 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type CloudConnection = typeof cloudConnections.$inferSelect;
export type GovernanceSettings = typeof governanceSettings.$inferSelect;
export type MockResource = typeof mockResources.$inferSelect;
export type ShredList = typeof shredLists.$inferSelect;
export type ShredListItem = typeof shredListItems.$inferSelect;
export type BillingRecord = typeof billingRecords.$inferSelect;
export type GovernanceAlert = typeof governanceAlerts.$inferSelect;
export type GovernanceApprover = typeof governanceApprovers.$inferSelect;
export type ShredListApproval = typeof shredListApprovals.$inferSelect;
export type GovernanceAuditEvent = typeof governanceAuditEvents.$inferSelect;
export type ProviderOnboarding = typeof providerOnboarding.$inferSelect;
export type SiemForwardingProfile = typeof siemForwardingProfiles.$inferSelect;
export type LocalAgentKey = typeof localAgentKeys.$inferSelect;
export type LocalAgentJob = typeof localAgentJobs.$inferSelect;
export type LocalAgentReadinessAlert = typeof localAgentReadinessAlerts.$inferSelect;
export type IncidentEscalationProfile = typeof incidentEscalationProfiles.$inferSelect;
export type LocalAgentEscalationEvent = typeof localAgentEscalationEvents.$inferSelect;
