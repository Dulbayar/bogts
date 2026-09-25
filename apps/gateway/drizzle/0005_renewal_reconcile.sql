ALTER TABLE `ledger` ADD `period_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_subject_period_uq` ON `ledger` (`subject_id`,`period_key`);--> statement-breakpoint
ALTER TABLE `subscription` ADD `reconciled_at` integer;