CREATE TABLE "prelaunch_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"locale" text DEFAULT 'nl' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "consent_ip" text;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "consent_locale" text;--> statement-breakpoint
CREATE UNIQUE INDEX "prelaunch_leads_email_idx" ON "prelaunch_leads" USING btree ("email");--> statement-breakpoint
-- Hard rule 1: RLS on, server path only — zero browser grants (like orgs).
ALTER TABLE public.prelaunch_leads ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "app_server full access" ON public.prelaunch_leads TO app_server USING (true) WITH CHECK (true);--> statement-breakpoint
REVOKE ALL ON public.prelaunch_leads FROM anon, authenticated;
