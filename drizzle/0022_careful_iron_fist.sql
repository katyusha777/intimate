ALTER TYPE "public"."admin_action" ADD VALUE 'create_org';--> statement-breakpoint
ALTER TYPE "public"."admin_action" ADD VALUE 'edit_org';--> statement-breakpoint
ALTER TYPE "public"."admin_action" ADD VALUE 'crawl_org';--> statement-breakpoint
ALTER TABLE "orgs" ALTER COLUMN "kvk" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "org_id" uuid;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "profile_id" uuid;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "slug" text;--> statement-breakpoint
UPDATE "orgs" SET "slug" = trim(both '-' from lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g'))) || '-' || substr(id::text, 1, 4) WHERE "slug" IS NULL;--> statement-breakpoint
ALTER TABLE "orgs" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "logo_key" text;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "site_url" text;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "contact_email" text;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "contact_phone" text;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "crawl_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "crawl_list_url" text;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "last_crawled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "last_crawl_note" text;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_jobs_org_idx" ON "import_jobs" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orgs_slug_idx" ON "orgs" USING btree ("slug");