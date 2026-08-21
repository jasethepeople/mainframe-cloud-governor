ALTER TABLE `governanceSettings` ADD `incidentSlaMinutes` int DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE `governanceSettings` ADD `primaryIncidentOwnerName` varchar(120) DEFAULT 'Unassigned' NOT NULL;--> statement-breakpoint
ALTER TABLE `governanceSettings` ADD `primaryIncidentOwnerEmail` varchar(320) DEFAULT 'unassigned@example.invalid' NOT NULL;--> statement-breakpoint
ALTER TABLE `governanceSettings` ADD `backupIncidentOwnerName` varchar(120) DEFAULT 'Unassigned' NOT NULL;--> statement-breakpoint
ALTER TABLE `governanceSettings` ADD `backupIncidentOwnerEmail` varchar(320) DEFAULT 'unassigned@example.invalid' NOT NULL;--> statement-breakpoint
ALTER TABLE `localAgentReadinessAlerts` ADD `backupOwnerName` varchar(120);--> statement-breakpoint
ALTER TABLE `localAgentReadinessAlerts` ADD `backupOwnerEmail` varchar(320);--> statement-breakpoint
ALTER TABLE `localAgentReadinessAlerts` ADD `responseDueAt` timestamp;