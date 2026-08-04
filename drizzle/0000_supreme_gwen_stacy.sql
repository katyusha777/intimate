CREATE TYPE "public"."account_type" AS ENUM('advertiser', 'agency', 'client', 'admin');--> statement-breakpoint
CREATE TYPE "public"."admin_action" AS ENUM('approve_profile', 'reject_profile', 'block_profile', 'unblock_profile', 'delete_profile', 'approve_media', 'reject_media', 'approve_verification', 'reject_verification', 'resolve_report', 'dismiss_report', 'block_account', 'delete_account', 'edit_profile_admin', 'add_note', 'claim_item', 'unclaim_item', 'escalate', 'verification_doc_viewed', 'thread_viewed_by_admin', 'send_platform_message');--> statement-breakpoint
CREATE TYPE "public"."admin_role" AS ENUM('moderator', 'support', 'super');--> statement-breakpoint
CREATE TYPE "public"."amenity" AS ENUM('parking_available', 'discreet_entrance', 'shower_available', 'drinks_available', 'air_conditioning', 'wheelchair_accessible');--> statement-breakpoint
CREATE TYPE "public"."appearance" AS ENUM('west_european', 'east_european', 'scandinavian', 'mediterranean', 'latina', 'asian', 'african', 'caribbean', 'middle_eastern', 'mixed');--> statement-breakpoint
CREATE TYPE "public"."available_for" AS ENUM('men', 'women', 'couples');--> statement-breakpoint
CREATE TYPE "public"."body_type" AS ENUM('slim', 'athletic', 'average', 'curvy', 'bbw', 'muscular');--> statement-breakpoint
CREATE TYPE "public"."breast_type" AS ENUM('natural', 'enhanced');--> statement-breakpoint
CREATE TYPE "public"."city" AS ENUM('amsterdam', 'rotterdam', 'den-haag', 'utrecht', 'eindhoven', 'groningen', 'tilburg', 'almere', 'breda', 'nijmegen', 'apeldoorn', 'haarlem', 'arnhem', 'enschede', 'amersfoort', 'zaanstad', 'den-bosch', 'zwolle', 'leiden', 'maastricht', 'dordrecht', 'ede', 'alphen-aan-den-rijn', 'alkmaar', 'emmen', 'delft', 'venlo', 'deventer', 'leeuwarden', 'heerlen');--> statement-breakpoint
CREATE TYPE "public"."contact_kind" AS ENUM('thread', 'manual');--> statement-breakpoint
CREATE TYPE "public"."conversation_mode" AS ENUM('off', 'everyone', 'verified_only');--> statement-breakpoint
CREATE TYPE "public"."cup_size" AS ENUM('a', 'b', 'c', 'd', 'e', 'f_plus');--> statement-breakpoint
CREATE TYPE "public"."drinking" AS ENUM('no', 'socially', 'yes');--> statement-breakpoint
CREATE TYPE "public"."eye_color" AS ENUM('blue', 'green', 'brown', 'hazel', 'grey');--> statement-breakpoint
CREATE TYPE "public"."gender" AS ENUM('female', 'male', 'trans_woman', 'trans_man');--> statement-breakpoint
CREATE TYPE "public"."hair_color" AS ENUM('blonde', 'brunette', 'black', 'red', 'grey', 'colored');--> statement-breakpoint
CREATE TYPE "public"."hair_length" AS ENUM('short', 'medium', 'long');--> statement-breakpoint
CREATE TYPE "public"."import_job_state" AS ENUM('queued', 'scraping', 'extracting', 'processing_images', 'ready_for_review', 'confirmed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."incall_location" AS ENUM('private_apartment', 'private_house', 'hotel', 'club');--> statement-breakpoint
CREATE TYPE "public"."language" AS ENUM('nl', 'en', 'de', 'fr', 'es', 'it', 'pt', 'ro', 'pl', 'ru', 'uk', 'bg', 'hu', 'cs', 'sk', 'sr', 'el', 'tr', 'ar', 'he', 'zh', 'ja', 'ko', 'th', 'vi', 'id', 'tl', 'hi');--> statement-breakpoint
CREATE TYPE "public"."media_state" AS ENUM('pending_review', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."media_type" AS ENUM('photo');--> statement-breakpoint
CREATE TYPE "public"."meeting_type" AS ENUM('incall', 'outcall');--> statement-breakpoint
CREATE TYPE "public"."message_kind" AS ENUM('text', 'photo', 'system', 'request');--> statement-breakpoint
CREATE TYPE "public"."party" AS ENUM('professional', 'client');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('cash', 'pin', 'bank_transfer', 'crypto');--> statement-breakpoint
CREATE TYPE "public"."piercings" AS ENUM('none', 'few', 'many');--> statement-breakpoint
CREATE TYPE "public"."profile_state" AS ENUM('draft', 'pending_review', 'live', 'paused', 'blocked', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."pubic_hair" AS ENUM('shaved', 'trimmed', 'natural');--> statement-breakpoint
CREATE TYPE "public"."report_reason" AS ENUM('fake_profile', 'stolen_photos', 'wrong_information', 'no_show_scam', 'underage_suspicion', 'coercion_suspicion', 'other');--> statement-breakpoint
CREATE TYPE "public"."report_resolution" AS ENUM('content_removed', 'profile_blocked', 'no_action');--> statement-breakpoint
CREATE TYPE "public"."report_state" AS ENUM('open', 'resolved', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."report_target" AS ENUM('profile', 'message');--> statement-breakpoint
CREATE TYPE "public"."sender" AS ENUM('professional', 'client', 'system');--> statement-breakpoint
CREATE TYPE "public"."service" AS ENUM('girlfriend_experience', 'pornstar_experience', 'dinner_date', 'travel_companion', 'party_companion', 'overnight_stay', 'striptease', 'erotic_dance', 'relaxing_massage', 'erotic_massage', 'body_to_body_massage', 'nuru_massage', 'tantra_massage', 'four_hands_massage', 'prostate_massage', 'kissing', 'french_kissing', 'position_69', 'multiple_positions', 'sex_toys', 'dirty_talk', 'shower_together', 'anal_sex', 'anal_play', 'rimming', 'cum_on_body', 'cum_in_mouth', 'oral_with_condom', 'oral_without_condom', 'deep_throat', 'oral_for_her', 'light_bdsm', 'domination', 'submission', 'role_play', 'spanking', 'bondage', 'strap_on', 'foot_fetish', 'golden_shower', 'latex_leather', 'humiliation', 'couples', 'duo_with_colleague', 'threesome', 'video_call', 'sexting', 'custom_content');--> statement-breakpoint
CREATE TYPE "public"."smoking" AS ENUM('no', 'socially', 'yes');--> statement-breakpoint
CREATE TYPE "public"."tattoos" AS ENUM('none', 'few', 'many');--> statement-breakpoint
CREATE TYPE "public"."thread_state" AS ENUM('pending', 'open', 'frozen', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."verification_state" AS ENUM('unverified', 'pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_type" "account_type" NOT NULL,
	"admin_role" "admin_role",
	"email" text,
	"display_name" text,
	"phone" text,
	"phone_verified_at" timestamp with time zone,
	"id_verification" "verification_state" DEFAULT 'unverified' NOT NULL,
	"verification_submitted_at" timestamp with time zone,
	"verification_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"excerpt" text NOT NULL,
	"minutes" integer NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"admin_account_id" uuid NOT NULL,
	"admin_email" text NOT NULL,
	"admin_role" "admin_role" NOT NULL,
	"action" "admin_action" NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"reason" text,
	"meta" jsonb
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"kind" "contact_kind" NOT NULL,
	"thread_id" uuid,
	"client_account_id" uuid,
	"name" text DEFAULT '' NOT NULL,
	"handle" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"client_media_allowed" boolean DEFAULT false NOT NULL,
	"private_set_unlocked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_settings" (
	"profile_id" uuid PRIMARY KEY NOT NULL,
	"mode" "conversation_mode" DEFAULT 'off' NOT NULL,
	"allow_call_requests" boolean DEFAULT true NOT NULL,
	"screening_question" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "favorites" (
	"client_account_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "favorites_client_account_id_profile_id_pk" PRIMARY KEY("client_account_id","profile_id")
);
--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_url" text NOT NULL,
	"state" "import_job_state" DEFAULT 'queued' NOT NULL,
	"profile_name" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"kind" "media_type" DEFAULT 'photo' NOT NULL,
	"state" "media_state" DEFAULT 'pending_review' NOT NULL,
	"image_key" text NOT NULL,
	"is_private" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"nsfw_score" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"sender" "sender" NOT NULL,
	"kind" "message_kind" DEFAULT 'text' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"image_key" text,
	"request" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "orgs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kvk" text NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"city" "city" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"org_id" uuid,
	"slug" text NOT NULL,
	"state" "profile_state" DEFAULT 'draft' NOT NULL,
	"state_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"birth_date" date NOT NULL,
	"gender" "gender" NOT NULL,
	"city" "city" NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"id_verified_at" timestamp with time zone,
	"photo_verified_at" timestamp with time zone,
	"featured" boolean DEFAULT false NOT NULL,
	"last_active_at" timestamp with time zone,
	"price_from" integer,
	"rates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"phone" text,
	"deposit_policy" text,
	"extras_note" text,
	"services" "service"[] DEFAULT '{}' NOT NULL,
	"meeting_types" "meeting_type"[] DEFAULT '{}' NOT NULL,
	"languages" "language"[] DEFAULT '{}' NOT NULL,
	"incall_locations" "incall_location"[] DEFAULT '{}' NOT NULL,
	"amenities" "amenity"[] DEFAULT '{}' NOT NULL,
	"payment_methods" "payment_method"[] DEFAULT '{}' NOT NULL,
	"available_for" "available_for"[] DEFAULT '{}' NOT NULL,
	"body_type" "body_type",
	"hair_color" "hair_color",
	"hair_length" "hair_length",
	"eye_color" "eye_color",
	"cup_size" "cup_size",
	"breast_type" "breast_type",
	"pubic_hair" "pubic_hair",
	"appearance" "appearance",
	"nationality" char(2),
	"height_cm" integer,
	"weight_kg" integer,
	"shoe_size_eu" integer,
	"smoking" "smoking",
	"drinking" "drinking",
	"tattoos" "tattoos",
	"piercings" "piercings",
	"opening_hours" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"description_translations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_min_age" CHECK (date_part('year', age("profiles"."birth_date")) >= 21),
	CONSTRAINT "profiles_price_from_nonneg" CHECK ("profiles"."price_from" is null or "profiles"."price_from" >= 0)
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_account_id" uuid,
	"target_kind" "report_target" NOT NULL,
	"target_id" text NOT NULL,
	"target_label" text DEFAULT '' NOT NULL,
	"profile_slug" text,
	"thread_id" uuid,
	"reason" "report_reason" NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"state" "report_state" DEFAULT 'open' NOT NULL,
	"escalated" boolean DEFAULT false NOT NULL,
	"resolution" "report_resolution",
	"resolution_note" text DEFAULT '' NOT NULL,
	"handled_by" uuid,
	"handled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"client_account_id" uuid NOT NULL,
	"state" "thread_state" DEFAULT 'open' NOT NULL,
	"blocked_by" "party",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_docs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"r2_key" text NOT NULL,
	"doc_hash" text NOT NULL,
	"state" "verification_state" DEFAULT 'pending' NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"purge_after" date
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_client_account_id_accounts_id_fk" FOREIGN KEY ("client_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_settings" ADD CONSTRAINT "conversation_settings_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_client_account_id_accounts_id_fk" FOREIGN KEY ("client_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orgs" ADD CONSTRAINT "orgs_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_account_id_accounts_id_fk" FOREIGN KEY ("reporter_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_client_account_id_accounts_id_fk" FOREIGN KEY ("client_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_docs" ADD CONSTRAINT "verification_docs_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_email_idx" ON "accounts" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "articles_slug_idx" ON "articles" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "audit_log_at_idx" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "contacts_profile_idx" ON "contacts" USING btree ("profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_thread_idx" ON "contacts" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "favorites_profile_idx" ON "favorites" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "import_jobs_state_idx" ON "import_jobs" USING btree ("state");--> statement-breakpoint
CREATE INDEX "media_profile_idx" ON "media" USING btree ("profile_id","position");--> statement-breakpoint
CREATE INDEX "messages_thread_idx" ON "messages" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "orgs_account_idx" ON "orgs" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_slug_idx" ON "profiles" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "profiles_account_idx" ON "profiles" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "profiles_org_idx" ON "profiles" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "profiles_state_idx" ON "profiles" USING btree ("state");--> statement-breakpoint
CREATE INDEX "profiles_city_idx" ON "profiles" USING btree ("city");--> statement-breakpoint
CREATE INDEX "profiles_gender_idx" ON "profiles" USING btree ("gender");--> statement-breakpoint
CREATE INDEX "profiles_featured_idx" ON "profiles" USING btree ("featured");--> statement-breakpoint
CREATE INDEX "profiles_last_active_idx" ON "profiles" USING btree ("last_active_at");--> statement-breakpoint
CREATE INDEX "profiles_price_from_idx" ON "profiles" USING btree ("price_from");--> statement-breakpoint
CREATE INDEX "profiles_services_idx" ON "profiles" USING gin ("services");--> statement-breakpoint
CREATE INDEX "reports_state_idx" ON "reports" USING btree ("state");--> statement-breakpoint
CREATE INDEX "reports_target_idx" ON "reports" USING btree ("target_kind","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "threads_pair_idx" ON "threads" USING btree ("profile_id","client_account_id");--> statement-breakpoint
CREATE INDEX "threads_client_idx" ON "threads" USING btree ("client_account_id");--> statement-breakpoint
CREATE INDEX "verification_docs_account_idx" ON "verification_docs" USING btree ("account_id");