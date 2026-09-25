CREATE TABLE `brand_logo` (
	`hash` text PRIMARY KEY NOT NULL,
	`content_type` text NOT NULL,
	`data` text NOT NULL,
	`size` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `branding` (
	`id` text PRIMARY KEY NOT NULL,
	`company_name` text,
	`logo_hash` text,
	`accent_color` text,
	`support_email` text,
	`support_url` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `project` ADD `display_name` text;--> statement-breakpoint
ALTER TABLE `project` ADD `logo_hash` text;