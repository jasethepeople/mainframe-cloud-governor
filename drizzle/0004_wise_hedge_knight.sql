CREATE TABLE `providerOnboarding` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`provider` enum('aws','azure','gcp') NOT NULL,
	`status` enum('profile_ready','connector_required','validated') NOT NULL DEFAULT 'profile_ready',
	`readOnlyProfile` varchar(160) NOT NULL,
	`connectorUid` varchar(80),
	`validatedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `providerOnboarding_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `siemForwardingProfiles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`provider` enum('splunk_hec','datadog_logs','generic_https') NOT NULL,
	`label` varchar(100) NOT NULL,
	`endpointHost` varchar(255) NOT NULL,
	`encryptedConfiguration` text NOT NULL,
	`cryptoMetadata` text NOT NULL,
	`connectorUid` varchar(80),
	`status` enum('connector_required','verified','disabled') NOT NULL DEFAULT 'connector_required',
	`enabled` boolean NOT NULL DEFAULT false,
	`validatedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `siemForwardingProfiles_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `governanceSettings` ADD `auditRetentionDays` int DEFAULT 365 NOT NULL;--> statement-breakpoint
ALTER TABLE `providerOnboarding` ADD CONSTRAINT `providerOnboarding_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `siemForwardingProfiles` ADD CONSTRAINT `siemForwardingProfiles_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;