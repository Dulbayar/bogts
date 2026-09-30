ALTER TABLE `invoice` ADD `method` text DEFAULT 'checkout' NOT NULL;--> statement-breakpoint
UPDATE `invoice` SET `method` = 'qr' WHERE `provider` = 'qpay';
