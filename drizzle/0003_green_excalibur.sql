CREATE TABLE `governanceApprovers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ownerUserId` int NOT NULL,
	`approverUserId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `governanceApprovers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `governanceAuditEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ownerUserId` int NOT NULL,
	`actorUserId` int,
	`eventType` varchar(80) NOT NULL,
	`entityType` varchar(80) NOT NULL,
	`entityId` int,
	`summary` varchar(500) NOT NULL,
	`payload` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `governanceAuditEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `shredListApprovals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`shredListId` int NOT NULL,
	`approverUserId` int NOT NULL,
	`decision` enum('approved','rejected') NOT NULL,
	`note` varchar(500),
	`reviewedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `shredListApprovals_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `governanceSettings` ADD `requiredApprovalCount` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `governanceApprovers` ADD CONSTRAINT `governanceApprovers_ownerUserId_users_id_fk` FOREIGN KEY (`ownerUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `governanceApprovers` ADD CONSTRAINT `governanceApprovers_approverUserId_users_id_fk` FOREIGN KEY (`approverUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `governanceAuditEvents` ADD CONSTRAINT `governanceAuditEvents_ownerUserId_users_id_fk` FOREIGN KEY (`ownerUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `governanceAuditEvents` ADD CONSTRAINT `governanceAuditEvents_actorUserId_users_id_fk` FOREIGN KEY (`actorUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shredListApprovals` ADD CONSTRAINT `shredListApprovals_shredListId_shredLists_id_fk` FOREIGN KEY (`shredListId`) REFERENCES `shredLists`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shredListApprovals` ADD CONSTRAINT `shredListApprovals_approverUserId_users_id_fk` FOREIGN KEY (`approverUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;