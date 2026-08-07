ALTER TABLE "messages" ADD COLUMN "expires_at" timestamp with time zone DEFAULT now() + interval '90 days' NOT NULL;--> statement-breakpoint
ALTER TABLE "verification_docs" ADD COLUMN "purged_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "messages_expires_idx" ON "messages" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "verification_docs_purge_idx" ON "verification_docs" USING btree ("purge_after");