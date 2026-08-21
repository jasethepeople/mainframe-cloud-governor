CREATE TABLE `localAgentJobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`agentKeyId` int NOT NULL,
	`jobType` enum('aws_read_only_discovery','generic_https_siem_delivery') NOT NULL,
	`status` enum('queued','completed','failed','expired') NOT NULL DEFAULT 'queued',
	`manifest` text NOT NULL,
	`manifestHash` varchar(128) NOT NULL,
	`receipt` text,
	`receiptSignature` text,
	`completedAt` timestamp,
	`expiresAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `localAgentJobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `localAgentKeys` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`agentId` varchar(100) NOT NULL,
	`publicKeyJwk` text NOT NULL,
	`status` enum('active','revoked') NOT NULL DEFAULT 'active',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`revokedAt` timestamp,
	CONSTRAINT `localAgentKeys_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `localAgentJobs` ADD CONSTRAINT `localAgentJobs_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `localAgentJobs` ADD CONSTRAINT `localAgentJobs_agentKeyId_localAgentKeys_id_fk` FOREIGN KEY (`agentKeyId`) REFERENCES `localAgentKeys`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `localAgentKeys` ADD CONSTRAINT `localAgentKeys_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;