CREATE TYPE "public"."call_mode" AS ENUM('voice', 'video');--> statement-breakpoint
CREATE TYPE "public"."call_state" AS ENUM('ringing', 'active', 'ended', 'declined', 'timeout');--> statement-breakpoint
CREATE TABLE "call_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"client_account_id" uuid,
	"client_name" text DEFAULT '' NOT NULL,
	"initiated_by" text DEFAULT 'professional' NOT NULL,
	"mode" "call_mode" NOT NULL,
	"state" "call_state" NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"duration_s" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "call_sessions_initiator" CHECK ("call_sessions"."initiated_by" = 'professional')
);
--> statement-breakpoint
ALTER TABLE "call_sessions" ADD CONSTRAINT "call_sessions_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_sessions" ADD CONSTRAINT "call_sessions_client_account_id_accounts_id_fk" FOREIGN KEY ("client_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "call_sessions_profile_idx" ON "call_sessions" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "call_sessions_started_idx" ON "call_sessions" USING btree ("started_at");