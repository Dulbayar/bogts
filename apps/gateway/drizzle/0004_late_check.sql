ALTER TABLE `invoice` ADD `late_checked_at` integer;--> statement-breakpoint
CREATE INDEX `invoice_late_check_idx` ON `invoice` (`status`,`expires_at`) WHERE "invoice"."late_checked_at" is null;