CREATE TABLE `billingRecords` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`shredListId` int,
	`savedSpendCents` int NOT NULL,
	`feeRateBps` int NOT NULL,
	`feeCents` int NOT NULL,
	`status` enum('simulated','settled') NOT NULL DEFAULT 'simulated',
	`issuedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `billingRecords_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `cloudConnections` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`provider` enum('aws','azure','gcp') NOT NULL,
	`label` varchar(100) NOT NULL,
	`encryptedCredential` text NOT NULL,
	`cryptoMetadata` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `cloudConnections_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `governanceSettings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`feeRateBps` int NOT NULL DEFAULT 1500,
	`minimumMonthlyCostCents` int NOT NULL DEFAULT 2500,
	`scanCronExpression` varchar(64) NOT NULL DEFAULT '0 0 */6 * * *',
	`scheduleCronTaskUid` varchar(65),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `governanceSettings_id` PRIMARY KEY(`id`),
	CONSTRAINT `governanceSettings_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `mockResources` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`accountAlias` varchar(100) NOT NULL,
	`provider` enum('aws','azure','gcp') NOT NULL,
	`resourceType` enum('idle_container','unattached_volume') NOT NULL,
	`resourceName` varchar(160) NOT NULL,
	`region` varchar(80) NOT NULL,
	`idleHours` int NOT NULL,
	`monthlyCostCents` int NOT NULL,
	`status` enum('active','shredded') NOT NULL DEFAULT 'active',
	`generatedAt` timestamp NOT NULL DEFAULT (now()),
	`shreddedAt` timestamp,
	CONSTRAINT `mockResources_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `shredListItems` (
	`id` int AUTO_INCREMENT NOT NULL,
	`shredListId` int NOT NULL,
	`resourceId` int NOT NULL,
	`decision` enum('pending','approved','rejected','shredded') NOT NULL DEFAULT 'pending',
	`estimatedMonthlySavingsCents` int NOT NULL,
	`decidedAt` timestamp,
	`shreddedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `shredListItems_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `shredLists` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`source` enum('manual','scheduled') NOT NULL,
	`status` enum('active','executed','archived') NOT NULL DEFAULT 'active',
	`totalItems` int NOT NULL DEFAULT 0,
	`estimatedSavingsCents` int NOT NULL DEFAULT 0,
	`analyzedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `shredLists_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `billingRecords` ADD CONSTRAINT `billingRecords_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `billingRecords` ADD CONSTRAINT `billingRecords_shredListId_shredLists_id_fk` FOREIGN KEY (`shredListId`) REFERENCES `shredLists`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `cloudConnections` ADD CONSTRAINT `cloudConnections_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `governanceSettings` ADD CONSTRAINT `governanceSettings_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `mockResources` ADD CONSTRAINT `mockResources_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shredListItems` ADD CONSTRAINT `shredListItems_shredListId_shredLists_id_fk` FOREIGN KEY (`shredListId`) REFERENCES `shredLists`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shredListItems` ADD CONSTRAINT `shredListItems_resourceId_mockResources_id_fk` FOREIGN KEY (`resourceId`) REFERENCES `mockResources`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shredLists` ADD CONSTRAINT `shredLists_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;