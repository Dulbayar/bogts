DROP INDEX `activity_created_idx`;--> statement-breakpoint
CREATE INDEX `activity_kind_created_idx` ON `activity` (`kind`,`created_at`);--> statement-breakpoint
DROP INDEX `audit_log_created_idx`;--> statement-breakpoint
CREATE INDEX `audit_log_subject_idx` ON `audit_log` (`subject`,`created_at`);--> statement-breakpoint
DROP INDEX `charge_project_created_idx`;--> statement-breakpoint
DROP INDEX `charge_project_reference_idx`;--> statement-breakpoint
CREATE INDEX `charge_project_id_idx` ON `charge` (`project_id`,`id`);--> statement-breakpoint
CREATE INDEX `charge_reference_idx` ON `charge` (`reference`,`project_id`);--> statement-breakpoint
CREATE INDEX `charge_status_created_idx` ON `charge` (`status`,`created_at`);--> statement-breakpoint
DROP INDEX `delivery_event_idx`;--> statement-breakpoint
DROP INDEX `delivery_project_created_idx`;--> statement-breakpoint
CREATE INDEX `delivery_status_created_idx` ON `delivery` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `delivery_event_id_idx` ON `delivery` (`event_id`,`id`);--> statement-breakpoint
CREATE INDEX `delivery_project_id_idx` ON `delivery` (`project_id`,`id`);--> statement-breakpoint
DROP INDEX `delivery_attempt_delivery_idx`;--> statement-breakpoint
DROP INDEX `delivery_attempt_project_created_idx`;--> statement-breakpoint
DROP INDEX `delivery_attempt_event_idx`;--> statement-breakpoint
CREATE INDEX `delivery_attempt_event_idx` ON `delivery_attempt` (`event_id`,`number`);--> statement-breakpoint
DROP INDEX `invoice_project_created_idx`;--> statement-breakpoint
DROP INDEX `invoice_project_reference_idx`;--> statement-breakpoint
CREATE INDEX `invoice_project_id_idx` ON `invoice` (`project_id`,`id`);--> statement-breakpoint
CREATE INDEX `invoice_reference_idx` ON `invoice` (`reference`,`project_id`,`id`);--> statement-breakpoint
CREATE INDEX `invoice_created_idx` ON `invoice` (`created_at`);--> statement-breakpoint
CREATE INDEX `invoice_sweep_claimed_idx` ON `invoice` (`status`,`swept_at`) WHERE "invoice"."swept_at" is not null;--> statement-breakpoint
DROP INDEX `ledger_project_created_idx`;--> statement-breakpoint
CREATE INDEX `ledger_created_idx` ON `ledger` (`created_at`,`project_id`);--> statement-breakpoint
DROP INDEX `subscription_project_customer_idx`;--> statement-breakpoint
DROP INDEX `subscription_project_created_idx`;--> statement-breakpoint
CREATE INDEX `subscription_customer_idx` ON `subscription` (`customer_ref`,`project_id`,`plan_id`);--> statement-breakpoint
CREATE INDEX `subscription_project_id_idx` ON `subscription` (`project_id`,`id`);--> statement-breakpoint
CREATE INDEX `subscription_status_bill_idx` ON `subscription` (`status`,`next_bill_at`);--> statement-breakpoint
CREATE INDEX `subscription_plan_idx` ON `subscription` (`plan_id`);--> statement-breakpoint
CREATE INDEX `event_created_idx` ON `event` (`created_at`,`project_id`);