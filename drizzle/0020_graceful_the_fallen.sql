ALTER TYPE "public"."admin_action" ADD VALUE 'set_account_type';--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "imported_from_url" text;