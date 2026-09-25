CREATE TABLE `delivery_attempt` (
	`id` text PRIMARY KEY NOT NULL,
	`delivery_id` text NOT NULL,
	`event_id` text NOT NULL,
	`project_id` text NOT NULL,
	`number` integer NOT NULL,
	`trigger` text NOT NULL,
	`url` text NOT NULL,
	`succeeded` integer NOT NULL,
	`http_status` integer,
	`error` text,
	`signature` text,
	`response_body` text,
	`duration_ms` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`delivery_id`) REFERENCES `delivery`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `delivery_attempt_delivery_idx` ON `delivery_attempt` (`delivery_id`,`number`);--> statement-breakpoint
CREATE INDEX `delivery_attempt_event_idx` ON `delivery_attempt` (`event_id`);--> statement-breakpoint
CREATE INDEX `delivery_attempt_project_created_idx` ON `delivery_attempt` (`project_id`,`created_at`);--> statement-breakpoint
DROP INDEX `invoice_provider_transaction_id_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_provider_transaction_uq` ON `invoice` (`provider`,`provider_transaction_id`);