-- 0002_handle_new_user — signup wiring at the DB (SUPABASE.md §2, DATA.md).
--
-- Two triggers on auth.users keep the service-role key OUT of the signup path:
--  1. BEFORE INSERT: copy the WHITELISTED account_type from user_metadata
--     (what signUp options.data carries) into app_metadata — authz lives in
--     app_metadata only (decision 3); users can edit user_metadata, so only
--     'client' | 'advertiser' are accepted and only at creation time.
--  2. AFTER INSERT: create the public.accounts row (identity denormalized:
--     email/display_name/phone) — every table hangs off accounts.id.
-- Role escalation (admin, agency) stays a server-side admin action.

CREATE OR REPLACE FUNCTION private.stamp_account_type()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_type text;
BEGIN
  v_type := NEW.raw_user_meta_data ->> 'account_type';
  IF v_type IS NULL OR v_type NOT IN ('client', 'advertiser') THEN
    v_type := 'client';
  END IF;
  NEW.raw_app_meta_data :=
    coalesce(NEW.raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object('account_type', v_type);
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER on_auth_user_created_stamp
  BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION private.stamp_account_type();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION private.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.accounts (id, account_type, email, display_name, phone)
  VALUES (
    NEW.id,
    coalesce(NEW.raw_app_meta_data ->> 'account_type', 'client')::public.account_type,
    NEW.email,
    coalesce(
      nullif(NEW.raw_user_meta_data ->> 'display_name', ''),
      initcap(split_part(coalesce(NEW.email, 'user'), '@', 1))),
    NEW.phone)
  ON CONFLICT (id) DO NOTHING;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION private.handle_new_user();
