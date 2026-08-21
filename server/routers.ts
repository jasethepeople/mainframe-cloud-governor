import { COOKIE_NAME } from "@shared/const";
import { parse as parseCookie } from "cookie";
import { getSessionCookieOptions } from "./_core/cookies";
import { createHeartbeatJob, updateHeartbeatJob } from "./_core/heartbeat";
import { notifyOwner } from "./_core/notification";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import * as governanceDb from "./db";
import { requiresAdministratorAuthorization } from "./governance.logic";

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
    })).mutation(({ ctx, input }) => governanceDb.updateGovernanceSettings(ctx.user.id, input)),
    scheduleAnalysis: protectedProcedure.input(z.object({ cron: z.string().regex(/^\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+$/, "Use a six-field UTC cron expression") })).mutation(async ({ ctx, input }) => {
      const sessionToken = parseCookie(ctx.req.headers.cookie ?? "")[COOKIE_NAME] ?? "";
      const settings = await governanceDb.updateGovernanceSettings(ctx.user.id, { scanCronExpression: input.cron });
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
    connections: protectedProcedure.query(({ ctx }) => governanceDb.listCloudConnections(ctx.user.id)),
    addConnection: protectedProcedure.input(z.object({
      provider: z.enum(["aws", "azure", "gcp"]),
      label: z.string().trim().min(2).max(100),
      encryptedCredential: z.string().min(20),
      cryptoMetadata: z.string().min(20),
      accessProfile: z.literal("inventory_read_only"),
      resourceScope: z.string().trim().min(2).max(160),
    })).mutation(({ ctx, input }) => governanceDb.createCloudConnection(ctx.user.id, input)),
    seedMockInfrastructure: protectedProcedure.mutation(({ ctx }) => governanceDb.ensureMockInfrastructure(ctx.user.id)),
    analyze: protectedProcedure.input(z.object({ source: z.enum(["manual", "scheduled"]).default("manual") })).mutation(async ({ ctx, input }) => {
      const result = await governanceDb.analyzeMockInfrastructure(ctx.user.id, input.source);
      if (result.alert) {
        const delivered = await notifyOwner({ title: "High-value shred list detected", content: `Shred list #${result.shredListId} identifies ${result.totalItems} resources with ${result.estimatedSavingsCents} cents in estimated monthly savings.` });
        await governanceDb.markAlertDelivery(result.alert.id, delivered);
      }
      return result;
    }),
    shredLists: protectedProcedure.query(({ ctx }) => governanceDb.listShredLists(ctx.user.id)),
    shredList: protectedProcedure.input(z.object({ shredListId: z.number().int().positive() })).query(({ ctx, input }) => governanceDb.getShredList(ctx.user.id, input.shredListId)),
    setDecision: protectedProcedure.input(z.object({ itemId: z.number().int().positive(), decision: z.enum(["approved", "rejected"]) })).mutation(({ ctx, input }) => governanceDb.setShredDecision(ctx.user.id, input.itemId, input.decision)),
    executeTeardowns: protectedProcedure.input(z.object({ shredListId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const settings = await governanceDb.getOrCreateGovernanceSettings(ctx.user.id);
      if (requiresAdministratorAuthorization(settings.requireAdminAuthorization, ctx.user.role)) throw new Error("Administrator authorization is required by the active teardown policy");
      return governanceDb.executeApprovedTeardowns(ctx.user.id, input.shredListId);
    }),
    billingHistory: protectedProcedure.query(({ ctx }) => governanceDb.listBillingRecords(ctx.user.id)),
    alerts: protectedProcedure.query(({ ctx }) => governanceDb.listGovernanceAlerts(ctx.user.id)),
  }),
});

export type AppRouter = typeof appRouter;
