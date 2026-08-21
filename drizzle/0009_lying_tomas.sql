CREATE TABLE `incidentEscalationProfiles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`provider` enum('generic_https','slack_webhook','pagerduty_events') NOT NULL,
	`label` varchar(100) NOT NULL,
	`endpointHost` varchar(255) NOT NULL,
	`encryptedConfiguration` text NOT NULL,
	`cryptoMetadata` text NOT NULL,
	`status` enum('sealed','manual_tested','disabled') NOT NULL DEFAULT 'sealed',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `incidentEscalationProfiles_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `localAgentEscalationEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`alertId` int NOT NULL,
	`escalationProfileId` int,
	`eventType` enum('handoff','manual_test_prepared','manual_test_recorded') NOT NULL,
	`summary` varchar(500) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `localAgentEscalationEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `localAgentReadinessAlerts` ADD `assigneeName` varchar(120);--> statement-breakpoint
ALTER TABLE `localAgentReadinessAlerts` ADD `assigneeEmail` varchar(320);--> statement-breakpoint
ALTER TABLE `incidentEscalationProfiles` ADD CONSTRAINT `incidentEscalationProfiles_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `localAgentEscalationEvents` ADD CONSTRAINT `localAgentEscalationEvents_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `localAgentEscalationEvents` ADD CONSTRAINT `lae_alert_fk` FOREIGN KEY (`alertId`) REFERENCES `localAgentReadinessAlerts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `localAgentEscalationEvents` ADD CONSTRAINT `lae_profile_fk` FOREIGN KEY (`escalationProfileId`) REFERENCES `incidentEscalationProfiles`(`id`) ON DELETE no action ON UPDATE no action;
