ALTER TABLE "accounts" ADD COLUMN "deletion_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "data_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "hidden_by" "party";