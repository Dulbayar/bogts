CREATE TABLE `activity` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`subject_type` text NOT NULL,
	`subject_id` text,
	`source` text NOT NULL,
	`kind` text NOT NULL,
	`summary` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `activity_subject_idx` ON `activity` (`subject_type`,`subject_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `activity_created_idx` ON `activity` (`created_at`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`subject` text,
	`detail` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_log_created_idx` ON `audit_log` (`created_at`);--> statement-breakpoint
CREATE TABLE `card` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`customer_ref` text NOT NULL,
	`provider` text DEFAULT 'bonum' NOT NULL,
	`token_enc` text,
	`mask` text NOT NULL,
	`expiry` text,
	`bank_name` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`removed_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `card_project_customer_idx` ON `card` (`project_id`,`customer_ref`);--> statement-breakpoint
CREATE TABLE `charge` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`card_id` text NOT NULL,
	`subscription_id` text,
	`amount` integer NOT NULL,
	`reference` text NOT NULL,
	`provider_transaction_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`failure_code` text,
	`reversed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`card_id`) REFERENCES `card`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`subscription_id`) REFERENCES `subscription`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `charge_provider_transaction_id_unique` ON `charge` (`provider_transaction_id`);--> statement-breakpoint
CREATE INDEX `charge_project_created_idx` ON `charge` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `charge_project_reference_idx` ON `charge` (`project_id`,`reference`);--> statement-breakpoint
CREATE INDEX `charge_card_idx` ON `charge` (`card_id`);--> statement-breakpoint
CREATE INDEX `charge_subscription_idx` ON `charge` (`subscription_id`);--> statement-breakpoint
CREATE TABLE `cron_heartbeat` (
	`name` text PRIMARY KEY NOT NULL,
	`last_run_at` integer NOT NULL,
	`last_duration_ms` integer NOT NULL,
	`last_error` text
);
--> statement-breakpoint
CREATE TABLE `delivery` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`project_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer,
	`last_status` integer,
	`last_error` text,
	`last_response_body` text,
	`last_duration_ms` integer,
	`delivered_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `delivery_due_idx` ON `delivery` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `delivery_event_idx` ON `delivery` (`event_id`);--> statement-breakpoint
CREATE INDEX `delivery_project_created_idx` ON `delivery` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `event` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`type` text NOT NULL,
	`subject_id` text NOT NULL,
	`data` text NOT NULL,
	`dedupe_key` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_dedupe_key_unique` ON `event` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `event_project_id_idx` ON `event` (`project_id`,`id`);--> statement-breakpoint
CREATE INDEX `event_subject_idx` ON `event` (`subject_id`);--> statement-breakpoint
CREATE TABLE `idempotency` (
	`project_id` text NOT NULL,
	`key` text NOT NULL,
	`request_hash` text NOT NULL,
	`status` integer,
	`response` text,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`project_id`, `key`),
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idempotency_created_idx` ON `idempotency` (`created_at`);--> statement-breakpoint
CREATE TABLE `invoice` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`provider` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text DEFAULT 'MNT' NOT NULL,
	`reference` text NOT NULL,
	`description` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`provider_invoice_id` text,
	`provider_transaction_id` text,
	`redirect_url` text,
	`qr_text` text,
	`qr_image` text,
	`deeplinks` text,
	`return_url` text,
	`expires_at` integer NOT NULL,
	`swept_at` integer,
	`paid_at` integer,
	`metadata` text,
	`ebarimt_status` text,
	`ebarimt_receipt_id` text,
	`ebarimt_lottery` text,
	`ebarimt_issued_at` integer,
	`ebarimt_data` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_provider_transaction_id_unique` ON `invoice` (`provider_transaction_id`);--> statement-breakpoint
CREATE INDEX `invoice_project_created_idx` ON `invoice` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `invoice_project_reference_idx` ON `invoice` (`project_id`,`reference`);--> statement-breakpoint
CREATE INDEX `invoice_sweep_idx` ON `invoice` (`status`,`expires_at`) WHERE "invoice"."swept_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_provider_invoice_uq` ON `invoice` (`provider`,`provider_invoice_id`);--> statement-breakpoint
CREATE TABLE `ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_ref` text NOT NULL,
	`kind` text NOT NULL,
	`subject_id` text NOT NULL,
	`amount` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_provider_ref_uq` ON `ledger` (`provider`,`provider_ref`);--> statement-breakpoint
CREATE INDEX `ledger_project_created_idx` ON `ledger` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ledger_subject_idx` ON `ledger` (`subject_id`);--> statement-breakpoint
CREATE TABLE `plan` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`provider` text DEFAULT 'bonum' NOT NULL,
	`provider_plan_id` integer NOT NULL,
	`amount` integer NOT NULL,
	`interval` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plan_project_key_uq` ON `plan` (`project_id`,`key`);--> statement-breakpoint
CREATE TABLE `project` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`api_key_hash` text NOT NULL,
	`api_key_prefix` text NOT NULL,
	`previous_api_key_hash` text,
	`previous_api_key_expires_at` integer,
	`webhook_url` text,
	`webhook_secret_enc` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`archived_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_slug_unique` ON `project` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_api_key_hash_unique` ON `project` (`api_key_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_previous_api_key_hash_unique` ON `project` (`previous_api_key_hash`);--> statement-breakpoint
CREATE TABLE `provider_token` (
	`key` text PRIMARY KEY NOT NULL,
	`access_token_enc` text NOT NULL,
	`refresh_token_enc` text,
	`expires_at` integer NOT NULL,
	`refresh_expires_at` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rate_limit` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`window_start` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `subscription` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`customer_ref` text NOT NULL,
	`email` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`provider_subscription_id` text,
	`tokenize_transaction_id` text NOT NULL,
	`pending_transaction_id` text,
	`follow_up_link` text,
	`card_id` text,
	`current_period_start` integer,
	`current_period_end` integer,
	`next_bill_at` integer,
	`cancelled_at` integer,
	`return_url` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`plan_id`) REFERENCES `plan`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`card_id`) REFERENCES `card`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subscription_provider_subscription_id_unique` ON `subscription` (`provider_subscription_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `subscription_tokenize_transaction_id_unique` ON `subscription` (`tokenize_transaction_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `subscription_pending_transaction_id_unique` ON `subscription` (`pending_transaction_id`);--> statement-breakpoint
CREATE INDEX `subscription_project_customer_idx` ON `subscription` (`project_id`,`customer_ref`);--> statement-breakpoint
CREATE INDEX `subscription_project_created_idx` ON `subscription` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `subscription_card_idx` ON `subscription` (`card_id`);