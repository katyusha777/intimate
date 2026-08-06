ALTER TYPE "public"."call_state" ADD VALUE 'failed';--> statement-breakpoint
ALTER TYPE "public"."message_kind" ADD VALUE 'call';--> statement-breakpoint
CREATE TABLE "contact_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"token" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"claimed_by" uuid,
	"claimed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "call_sessions" ALTER COLUMN "state" SET DEFAULT 'ringing';--> statement-breakpoint
ALTER TABLE "call_sessions" ADD COLUMN "thread_id" uuid;--> statement-breakpoint
ALTER TABLE "call_sessions" ADD COLUMN "answered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "call_sessions" ADD COLUMN "ended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "call_sessions" ADD COLUMN "last_beat_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "call_sessions" ADD COLUMN "end_reason" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "call_id" uuid;--> statement-breakpoint
ALTER TABLE "contact_invites" ADD CONSTRAINT "contact_invites_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_invites" ADD CONSTRAINT "contact_invites_claimed_by_accounts_id_fk" FOREIGN KEY ("claimed_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contact_invites_token_idx" ON "contact_invites" USING btree ("token");--> statement-breakpoint
CREATE INDEX "contact_invites_profile_idx" ON "contact_invites" USING btree ("profile_id");--> statement-breakpoint
ALTER TABLE "call_sessions" ADD CONSTRAINT "call_sessions_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_call_id_call_sessions_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."call_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "call_sessions_thread_idx" ON "call_sessions" USING btree ("thread_id","started_at");