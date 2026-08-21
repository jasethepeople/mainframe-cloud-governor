ALTER TABLE `localAgentEscalationEvents` MODIFY COLUMN `eventType` enum('handoff','manual_test_prepared','manual_test_recorded','sla_breach_dispatch_prepared','sla_breach_dispatch_receipt_confirmed') NOT NULL;--> statement-breakpoint
ALTER TABLE `localAgentReadinessAlerts` ADD `breachReceiptConfirmedAt` timestamp;--> statement-breakpoint
ALTER TABLE `localAgentReadinessAlerts` ADD `breachReceiptJobId` int;--> statement-breakpoint
ALTER TABLE `localAgentReadinessAlerts` ADD CONSTRAINT `fk_breach_receipt_job` FOREIGN KEY (`breachReceiptJobId`) REFERENCES `localAgentJobs`(`id`) ON DELETE no action ON UPDATE no action;
