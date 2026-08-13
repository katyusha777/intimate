ALTER TYPE "public"."service" ADD VALUE 'couples_massage' BEFORE 'kissing';--> statement-breakpoint
ALTER TYPE "public"."service" ADD VALUE 'soft_sm_massage' BEFORE 'kissing';--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "locations" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "crawl_notes" text;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "crawl_interval_hours" integer DEFAULT 24 NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "availability_dates" jsonb DEFAULT '{}'::jsonb NOT NULL;