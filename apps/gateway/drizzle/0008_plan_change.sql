ALTER TABLE `subscription` ADD `next_plan_id` text REFERENCES plan(id);--> statement-breakpoint
ALTER TABLE `subscription` ADD `plan_change_tried_at` integer;--> statement-breakpoint
ALTER TABLE `subscription` ADD `retiring_provider_subscription_id` text;--> statement-breakpoint
ALTER TABLE `subscription` ADD `retiring_provider_plan_id` integer;--> statement-breakpoint
CREATE INDEX `subscription_next_plan_idx` ON `subscription` (`next_bill_at`) WHERE "subscription"."next_plan_id" is not null;--> statement-breakpoint
CREATE INDEX `subscription_retiring_idx` ON `subscription` (`updated_at`) WHERE "subscription"."retiring_provider_subscription_id" is not null;