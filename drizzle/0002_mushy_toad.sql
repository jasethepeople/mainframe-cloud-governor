CREATE TABLE `governanceAlerts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`shredListId` int NOT NULL,
	`estimatedSavingsCents` int NOT NULL,
	`status` enum('recorded','delivered','delivery_failed') NOT NULL DEFAULT 'recorded',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`notifiedAt` timestamp,
	CONSTRAINT `governanceAlerts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `cloudConnections` ADD `accessProfile` enum('inventory_read_only') DEFAULT 'inventory_read_only' NOT NULL;--> statement-breakpoint
ALTER TABLE `cloudConnections` ADD `resourceScope` varchar(160) DEFAULT 'Scoped provider inventory' NOT NULL;--> statement-breakpoint
ALTER TABLE `governanceSettings` ADD `highValueThresholdCents` int DEFAULT 50000 NOT NULL;--> statement-breakpoint
ALTER TABLE `governanceSettings` ADD `requireAdminAuthorization` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `governanceSettings` ADD `alertsEnabled` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `governanceAlerts` ADD CONSTRAINT `governanceAlerts_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `governanceAlerts` ADD CONSTRAINT `governanceAlerts_shredListId_shredLists_id_fk` FOREIGN KEY (`shredListId`) REFERENCES `shredLists`(`id`) ON DELETE no action ON UPDATE no action;