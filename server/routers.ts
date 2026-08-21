import { COOKIE_NAME } from "@shared/const";
import { parse as parseCookie } from "cookie";
import { getSessionCookieOptions } from "./_core/cookies";
import { createHeartbeatJob, updateHeartbeatJob } from "./_core/heartbeat";
import { notifyOwner } from "./_core/notification";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import * as governanceDb from "./db";
import { hasApprovalQuorum, requiresAdministratorAuthorization } from "./governance.logic";
import { isSafeSiemEndpointHost } from "./productionGovernance.logic";

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),
  governance: router({
    dashboard: protectedProcedure.query(({ ctx }) => governanceDb.getGovernanceDashboard(ctx.user.id)),
    settings: protectedProcedure.query(({ ctx }) => governanceDb.getOrCreateGovernanceSettings(ctx.user.id)),
    updateSettings: protectedProcedure.input(z.object({
      feeRateBps: z.number().int().min(0).max(5000).optional(),
      minimumMonthlyCostCents: z.number().int().min(0).max(100_000_000).optional(),
      scanCronExpression: z.string().min(9).max(64).optional(),
      highValueThresholdCents: z.number().int().min(0).max(100_000_000).optional(),
      requireAdminAuthorization: z.boolean().optional(),
      alertsEnabled: z.boolean().optional(),
      requiredApprovalCount: z.number().int().min(1).max(10).optional(),
      auditRetentionDays: z.number().int().min(30).max(3650).optional(),
    })).mutation(async ({ ctx, input }) => {
      const settings = await governanceDb.updateGovernanceSettings(ctx.user.id, input);
      await governanceDb.recordAuditEvent(ctx.user.id, ctx.user.id, "governance_policy_updated", "governance_settings", settings.id, "Updated governance policy controls.", input);
      return settings;
    }),
    scheduleAnalysis: protectedProcedure.input(z.object({ cron: z.string().regex(/^\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+$/, "Use a six-field UTC cron expression") })).mutation(async ({ ctx, input }) => {
      const sessionToken = parseCookie(ctx.req.headers.cookie ?? "")[COOKIE_NAME] ?? "";
      const settings = await governanceDb.updateGovernanceSettings(ctx.user.id, { scanCronExpression: input.cron });
      if (!settings.releasePublishedAt) throw new Error("Confirm the published release in Production Gate before enabling periodic analysis");
      const jobDefinition = {
        cron: input.cron,
        path: "/api/scheduled/shred-analysis",
        payload: {},
        description: "Run deterministic mock cloud analysis and generate a shred list.",
      };
      if (settings.scheduleCronTaskUid) {
        const updated = await updateHeartbeatJob(settings.scheduleCronTaskUid, jobDefinition, sessionToken);
        return { taskUid: settings.scheduleCronTaskUid, nextExecutionAt: updated.nextExecutionAt };
      }
      const created = await createHeartbeatJob({ name: `shred-analysis-${ctx.user.id}`, ...jobDefinition }, sessionToken);
      await governanceDb.setScheduleTaskUid(ctx.user.id, created.taskUid);
      return created;
    }),
    scheduleLocalAgentMonitoring: protectedProcedure.input(z.object({ cron: z.string().regex(/^\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+$/, "Use a six-field UTC cron expression") })).mutation(async ({ ctx, input }) => {
      const sessionToken = parseCookie(ctx.req.headers.cookie ?? "")[COOKIE_NAME] ?? "";
      const settings = await governanceDb.getOrCreateGovernanceSettings(ctx.user.id);
      if (!settings.releasePublishedAt) throw new Error("Publish and confirm the current release in Production Gate before enabling local-agent monitoring");
      const jobDefinition = { cron: input.cron, path: "/api/scheduled/local-agent-readiness", payload: {}, description: "Evaluate local-agent receipt freshness and record readiness alerts." };
      if (settings.agentMonitoringCronTaskUid) {
        const updated = await updateHeartbeatJob(settings.agentMonitoringCronTaskUid, jobDefinition, sessionToken);
        return { taskUid: settings.agentMonitoringCronTaskUid, nextExecutionAt: updated.nextExecutionAt };
      }
      const created = await createHeartbeatJob({ name: `local-agent-readiness-${ctx.user.id}`, ...jobDefinition }, sessionToken);
      await governanceDb.setAgentMonitoringTaskUid(ctx.user.id, created.taskUid);
      return created;
    }),
    confirmPublishedRelease: protectedProcedure.mutation(({ ctx }) => governanceDb.confirmPublishedRelease(ctx.user.id)),
    connections: protectedProcedure.query(({ ctx }) => governanceDb.listCloudConnections(ctx.user.id)),
    providerReadiness: protectedProcedure.query(({ ctx }) => governanceDb.getProviderReadiness(ctx.user.id)),
    providerOnboarding: protectedProcedure.query(({ ctx }) => governanceDb.listProviderOnboarding(ctx.user.id)),
    prepareProviderOnboarding: protectedProcedure.input(z.object({ provider: z.enum(["aws", "azure", "gcp"]), readOnlyProfile: z.string().trim().min(2).max(160) })).mutation(({ ctx, input }) => governanceDb.enrollProviderOnboarding(ctx.user.id, input.provider, input.readOnlyProfile)),
    addConnection: protectedProcedure.input(z.object({
      provider: z.enum(["aws", "azure", "gcp"]),
      label: z.string().trim().min(2).max(100),
      encryptedCredential: z.string().min(20),
      cryptoMetadata: z.string().min(20),
      accessProfile: z.literal("inventory_read_only"),
      resourceScope: z.string().trim().min(2).max(160),
    })).mutation(async ({ ctx, input }) => {
      const connection = await governanceDb.createCloudConnection(ctx.user.id, input);
      await governanceDb.recordAuditEvent(ctx.user.id, ctx.user.id, "connection_sealed", "cloud_connection", connection.id, `Enrolled a ${input.provider.toUpperCase()} read-only connection profile.`, { label: input.label, accessProfile: input.accessProfile, resourceScope: input.resourceScope });
      return connection;
    }),
    seedMockInfrastructure: protectedProcedure.mutation(({ ctx }) => governanceDb.ensureMockInfrastructure(ctx.user.id)),
    analyze: protectedProcedure.input(z.object({ source: z.enum(["manual", "scheduled"]).default("manual") })).mutation(async ({ ctx, input }) => {
      const result = await governanceDb.analyzeMockInfrastructure(ctx.user.id, input.source);
      await governanceDb.recordAuditEvent(ctx.user.id, ctx.user.id, "shred_list_generated", "shred_list", result.shredListId, `Generated a ${input.source} shred list with ${result.totalItems} resource candidates.`, result);
      if (result.alert) {
        const delivered = await notifyOwner({ title: "High-value shred list detected", content: `Shred list #${result.shredListId} identifies ${result.totalItems} resources with ${result.estimatedSavingsCents} cents in estimated monthly savings.` });
        await governanceDb.markAlertDelivery(result.alert.id, delivered);
        await governanceDb.recordAuditEvent(ctx.user.id, ctx.user.id, "high_value_alert_recorded", "governance_alert", result.alert.id, `Recorded a high-value alert for shred list #${result.shredListId}.`, result.alert);
        await governanceDb.recordAuditEvent(ctx.user.id, ctx.user.id, delivered ? "high_value_alert_delivered" : "high_value_alert_delivery_failed", "governance_alert", result.alert.id, delivered ? "Delivered the high-value alert notification." : "Recorded a failed high-value alert notification delivery.");
      }
      return result;
    }),
    shredLists: protectedProcedure.query(({ ctx }) => governanceDb.listShredLists(ctx.user.id)),
    shredList: protectedProcedure.input(z.object({ shredListId: z.number().int().positive() })).query(({ ctx, input }) => governanceDb.getShredList(ctx.user.id, input.shredListId)),
    setDecision: protectedProcedure.input(z.object({ itemId: z.number().int().positive(), decision: z.enum(["approved", "rejected"]) })).mutation(async ({ ctx, input }) => {
      const result = await governanceDb.setShredDecision(ctx.user.id, input.itemId, input.decision);
      await governanceDb.recordAuditEvent(ctx.user.id, ctx.user.id, `resource_${input.decision}`, "shred_list_item", input.itemId, `Operator marked shred-list item ${input.itemId} as ${input.decision}.`);
      return result;
    }),
    approvers: protectedProcedure.query(({ ctx }) => governanceDb.listApprovers(ctx.user.id)),
    addApprover: protectedProcedure.input(z.object({ email: z.string().email().max(320) })).mutation(({ ctx, input }) => governanceDb.addApproverByEmail(ctx.user.id, input.email)),
    approvalQueue: protectedProcedure.query(({ ctx }) => governanceDb.listAssignedApprovalQueues(ctx.user.id)),
    reviewShredList: protectedProcedure.input(z.object({ shredListId: z.number().int().positive(), decision: z.enum(["approved", "rejected"]), note: z.string().trim().max(500).optional() })).mutation(({ ctx, input }) => governanceDb.reviewAssignedShredList(ctx.user.id, input.shredListId, input.decision, input.note)),
    approvalProgress: protectedProcedure.input(z.object({ shredListId: z.number().int().positive() })).query(({ ctx, input }) => governanceDb.getApprovalProgress(ctx.user.id, input.shredListId)),
    auditEvents: protectedProcedure.query(({ ctx }) => governanceDb.listAuditEvents(ctx.user.id)),
    siemProfiles: protectedProcedure.query(({ ctx }) => governanceDb.listSiemForwardingProfiles(ctx.user.id)),
    addSiemProfile: protectedProcedure.input(z.object({
      provider: z.enum(["splunk_hec", "datadog_logs", "generic_https"]),
      label: z.string().trim().min(2).max(100),
      endpointHost: z.string().trim().min(3).max(255).refine(isSafeSiemEndpointHost, "Use a public hostname without a protocol or path"),
      encryptedConfiguration: z.string().min(20),
      cryptoMetadata: z.string().min(20),
    })).mutation(({ ctx, input }) => governanceDb.createSiemForwardingProfile(ctx.user.id, input)),
    localAgentKeys: protectedProcedure.query(({ ctx }) => governanceDb.listLocalAgentKeys(ctx.user.id)),
    localAgentReadiness: protectedProcedure.query(({ ctx }) => governanceDb.getLocalAgentReadiness(ctx.user.id)),
    evaluateLocalAgentReadiness: protectedProcedure.mutation(({ ctx }) => governanceDb.evaluateLocalAgentReadiness(ctx.user.id)),
    localAgentReadinessAlerts: protectedProcedure.query(({ ctx }) => governanceDb.listLocalAgentReadinessAlerts(ctx.user.id)),
    acknowledgeLocalAgentReadinessAlert: protectedProcedure.input(z.object({ alertId: z.number().int().positive() })).mutation(({ ctx, input }) => governanceDb.acknowledgeLocalAgentReadinessAlert(ctx.user.id, input.alertId)),
    escalationProfiles: protectedProcedure.query(({ ctx }) => governanceDb.listIncidentEscalationProfiles(ctx.user.id)),
    addEscalationProfile: protectedProcedure.input(z.object({ provider: z.enum(["generic_https", "slack_webhook", "pagerduty_events"]), label: z.string().trim().min(2).max(100), endpointHost: z.string().trim().min(3).max(255).refine(isSafeSiemEndpointHost, "Use a public hostname without a protocol or path"), encryptedConfiguration: z.string().min(20), cryptoMetadata: z.string().min(20) })).mutation(({ ctx, input }) => governanceDb.createIncidentEscalationProfile(ctx.user.id, input)),
    handoffLocalAgentReadinessAlert: protectedProcedure.input(z.object({ alertId: z.number().int().positive(), assigneeName: z.string().trim().min(2).max(120), assigneeEmail: z.string().trim().email().max(320), escalationProfileId: z.number().int().positive().optional() })).mutation(({ ctx, input }) => governanceDb.handoffLocalAgentReadinessAlert(ctx.user.id, input.alertId, input.assigneeName, input.assigneeEmail, input.escalationProfileId)),
    completeLocalAgentEscalation: protectedProcedure.input(z.object({ alertId: z.number().int().positive() })).mutation(({ ctx, input }) => governanceDb.completeLocalAgentEscalation(ctx.user.id, input.alertId)),
    prepareEscalationManualTest: protectedProcedure.input(z.object({ profileId: z.number().int().positive() })).mutation(({ ctx, input }) => governanceDb.prepareEscalationManualTest(ctx.user.id, input.profileId)),
    recordEscalationManualTest: protectedProcedure.input(z.object({ profileId: z.number().int().positive() })).mutation(({ ctx, input }) => governanceDb.recordEscalationManualTest(ctx.user.id, input.profileId)),
    registerLocalAgentKey: protectedProcedure.input(z.object({ agentId: z.string().trim().min(3).max(100), publicKeyJwk: z.string().min(20).max(20_000) })).mutation(({ ctx, input }) => governanceDb.registerLocalAgentKey(ctx.user.id, input.agentId, input.publicKeyJwk)),
    revokeLocalAgentKey: protectedProcedure.input(z.object({ keyId: z.number().int().positive() })).mutation(({ ctx, input }) => governanceDb.revokeLocalAgentKey(ctx.user.id, input.keyId)),
    updateLocalAgentOwnership: protectedProcedure.input(z.object({ keyId: z.number().int().positive(), operationalOwnerName: z.string().trim().min(2).max(120), operationalOwnerEmail: z.string().trim().email().max(320) })).mutation(({ ctx, input }) => governanceDb.updateLocalAgentOwnership(ctx.user.id, input.keyId, input.operationalOwnerName, input.operationalOwnerEmail)),
    rotateLocalAgentKey: protectedProcedure.input(z.object({ retiringKeyId: z.number().int().positive(), agentId: z.string().trim().min(3).max(100), publicKeyJwk: z.string().min(20).max(20_000) })).mutation(({ ctx, input }) => governanceDb.rotateLocalAgentKey(ctx.user.id, input.retiringKeyId, input.agentId, input.publicKeyJwk)),
    localAgentJobs: protectedProcedure.query(({ ctx }) => governanceDb.listLocalAgentJobs(ctx.user.id)),
    queueLocalAgentJob: protectedProcedure.input(z.object({ agentKeyId: z.number().int().positive(), jobType: z.enum(["aws_read_only_discovery", "generic_https_siem_delivery", "health_check"]) })).mutation(({ ctx, input }) => governanceDb.queueLocalAgentJob(ctx.user.id, input.agentKeyId, input.jobType)),
    submitLocalAgentReceipt: protectedProcedure.input(z.object({ jobId: z.number().int().positive(), receipt: z.string().min(2).max(100_000), receiptSignature: z.string().min(20).max(20_000) })).mutation(({ ctx, input }) => governanceDb.submitLocalAgentReceipt(ctx.user.id, input.jobId, input.receipt, input.receiptSignature)),
    executeTeardowns: protectedProcedure.input(z.object({ shredListId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const settings = await governanceDb.getOrCreateGovernanceSettings(ctx.user.id);
      if (requiresAdministratorAuthorization(settings.requireAdminAuthorization, ctx.user.role)) throw new Error("Administrator authorization is required by the active teardown policy");
      if (settings.requiredApprovalCount > 1) {
        const progress = await governanceDb.getApprovalProgress(ctx.user.id, input.shredListId);
        if (!hasApprovalQuorum(progress.approvedCount, settings.requiredApprovalCount)) throw new Error(`Teardown policy requires ${settings.requiredApprovalCount} named approvals before confirmation`);
      }
      const outcome = await governanceDb.executeApprovedTeardowns(ctx.user.id, input.shredListId);
      await governanceDb.recordAuditEvent(ctx.user.id, ctx.user.id, "simulated_shredding_confirmed", "shred_list", input.shredListId, `Recorded ${outcome.shreddedCount} resources as shredded.`, outcome);
      return outcome;
    }),
    billingHistory: protectedProcedure.query(({ ctx }) => governanceDb.listBillingRecords(ctx.user.id)),
    alerts: protectedProcedure.query(({ ctx }) => governanceDb.listGovernanceAlerts(ctx.user.id)),
  }),
});

export type AppRouter = typeof appRouter;
