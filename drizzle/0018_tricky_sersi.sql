ALTER TYPE "public"."admin_action" ADD VALUE 'set_pushover_key';--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "pushover_key" text;