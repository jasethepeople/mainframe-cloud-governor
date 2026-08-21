ALTER TABLE `localAgentEscalationEvents` MODIFY COLUMN `eventType` enum('handoff','manual_test_prepared','manual_test_recorded','sla_breach_dispatch_prepared') NOT NULL;--> statement-breakpoint
ALTER TABLE `localAgentJobs` MODIFY COLUMN `jobType` enum('aws_read_only_discovery','generic_https_siem_delivery','health_check','sealed_route_escalation') NOT NULL;--> statement-breakpoint
ALTER TABLE `governanceSettings` ADD `autoEscalateSlaBreaches` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `governanceSettings` ADD `autoEscalationProfileId` int;--> statement-breakpoint
ALTER TABLE `localAgentReadinessAlerts` ADD `breachEscalatedAt` timestamp;--> statement-breakpoint
ALTER TABLE `localAgentReadinessAlerts` ADD `breachEscalationProfileId` int;--> statement-breakpoint
ALTER TABLE `governanceSettings` ADD CONSTRAINT `gs_auto_esc_profile_fk` FOREIGN KEY (`autoEscalationProfileId`) REFERENCES `incidentEscalationProfiles`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `localAgentReadinessAlerts` ADD CONSTRAINT `lara_breach_profile_fk` FOREIGN KEY (`breachEscalationProfileId`) REFERENCES `incidentEscalationProfiles`(`id`) ON DELETE no action ON UPDATE no action;
