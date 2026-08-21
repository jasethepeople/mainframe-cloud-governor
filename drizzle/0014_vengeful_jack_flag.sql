ALTER TABLE `localAgentEscalationEvents` MODIFY COLUMN `eventType` enum('handoff','manual_test_prepared','manual_test_recorded','sla_breach_dispatch_prepared','sla_breach_dispatch_receipt_confirmed','sla_breach_dispatch_delivery_failed') NOT NULL;--> statement-breakpoint
ALTER TABLE `localAgentReadinessAlerts` ADD `breachFailureAt` timestamp;--> statement-breakpoint
ALTER TABLE `localAgentReadinessAlerts` ADD `breachFailureJobId` int;--> statement-breakpoint
ALTER TABLE `localAgentReadinessAlerts` ADD `breachRetryCount` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `localAgentReadinessAlerts` ADD `acknowledgementDueAt` timestamp;--> statement-breakpoint
ALTER TABLE `localAgentReadinessAlerts` ADD CONSTRAINT `fk_breach_failure_job` FOREIGN KEY (`breachFailureJobId`) REFERENCES `localAgentJobs`(`id`) ON DELETE no action ON UPDATE no action;
