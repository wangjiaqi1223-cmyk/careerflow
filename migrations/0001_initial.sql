CREATE TABLE `daily_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`linkedin_id` text NOT NULL,
	`title` text NOT NULL,
	`company` text NOT NULL,
	`location` text NOT NULL,
	`url` text NOT NULL,
	`description` text NOT NULL,
	`verification` text NOT NULL,
	`published_at` text,
	`discovered_at` text NOT NULL,
	`day` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`search_revision` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `unique_user_linkedin_job` ON `daily_jobs` (`user_id`,`linkedin_id`);--> statement-breakpoint
CREATE TABLE `search_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`keywords` text NOT NULL,
	`location` text NOT NULL,
	`excluded` text NOT NULL,
	`remote` integer DEFAULT 0 NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `search_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`day` text NOT NULL,
	`checked_at` text NOT NULL,
	`status` text NOT NULL,
	`added` integer NOT NULL,
	`summary` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `unique_user_run_day` ON `search_runs` (`user_id`,`day`);