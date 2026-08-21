CREATE TABLE `localAgentReadinessAlerts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`agentKeyId` int,
	`alertType` enum('no_active_key','health_check_required','receipt_stale') NOT NULL,
	`status` enum('open','acknowledged','resolved') NOT NULL DEFAULT 'open',
	`summary` varchar(500) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`acknowledgedAt` timestamp,
	`resolvedAt` timestamp,
	CONSTRAINT `localAgentReadinessAlerts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `governanceSettings` ADD `agentMonitoringCronTaskUid` varchar(65);--> statement-breakpoint
ALTER TABLE `localAgentKeys` ADD `operationalOwnerName` varchar(120) DEFAULT 'Unassigned' NOT NULL;--> statement-breakpoint
ALTER TABLE `localAgentKeys` ADD `operationalOwnerEmail` varchar(320) DEFAULT 'unassigned@example.invalid' NOT NULL;--> statement-breakpoint
ALTER TABLE `localAgentReadinessAlerts` ADD CONSTRAINT `localAgentReadinessAlerts_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `localAgentReadinessAlerts` ADD CONSTRAINT `localAgentReadinessAlerts_agentKeyId_localAgentKeys_id_fk` FOREIGN KEY (`agentKeyId`) REFERENCES `localAgentKeys`(`id`) ON DELETE no action ON UPDATE no action;