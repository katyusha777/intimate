-- 0001_security — the Phase-0 wall (SUPABASE.md §11 wave 2, DATA.md §6).
-- Everything drizzle-kit can't express: roles, grants, RLS policies, the
-- private schema + helpers, and the triggers. Deny tests: tests/rls.test.ts.
--
-- Runs as `postgres` (local + hosted). Hosted postgres is NOT superuser:
-- BYPASSRLS on app_server may be refused there, so the explicit
-- `to app_server` policies below are the guarantee; the attribute is a bonus.
--
-- DECIDED (2026-08-03): NO `accounts.id → auth.users` FK. GDPR erasure calls
-- `auth.admin.deleteUser()` while the accounts row must SURVIVE (scrubbed) for
-- audit/defensibility — any FK would either block the deletion (no action) or
-- vaporize history (cascade). accounts.id = auth.users.id by convention; rows
-- are only ever created server-side at signup.

-- ── 1. app_server: the Hyperdrive/Drizzle login role (SUPABASE.md decision 5).
--      Password is set OUT-OF-BAND per tier (never in a committed migration):
--      alter role app_server with password '…';
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_server') THEN
    CREATE ROLE app_server LOGIN;
  END IF;
END $$;
--> statement-breakpoint
-- Let postgres SET ROLE app_server (admin ops + the deny tests impersonate it).
GRANT app_server TO postgres;
--> statement-breakpoint
DO $$ BEGIN
  BEGIN
    ALTER ROLE app_server BYPASSRLS;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'BYPASSRLS refused (not superuser) — app_server relies on its explicit policies';
  END;
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO app_server;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_server;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_server;
--> statement-breakpoint

-- ── 2. Grants are the gate before RLS (SUPABASE.md §3): kill the defaults,
--      then grant deliberately. Tables with no grants are unreachable via
--      PostgREST no matter what policies exist.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM anon, authenticated;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM public, anon, authenticated;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE USAGE, SELECT ON SEQUENCES FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM public, anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
--> statement-breakpoint

-- Deliberate browser-path grants (everything not listed: server/admin only).
GRANT SELECT ON public.profiles TO anon, authenticated;
--> statement-breakpoint
-- The presence heartbeat (SUPABASE.md §5.4): the ONLY browser-writable profile
-- column. Column-level grant = RLS can't restrict columns, grants can.
GRANT UPDATE (last_active_at) ON public.profiles TO authenticated;
--> statement-breakpoint
GRANT SELECT ON public.media TO anon, authenticated;
--> statement-breakpoint
GRANT SELECT ON public.accounts TO authenticated;
--> statement-breakpoint
GRANT SELECT ON public.threads TO authenticated;
--> statement-breakpoint
GRANT SELECT ON public.messages TO authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON public.favorites TO authenticated;
--> statement-breakpoint

-- ── 3. private schema: policy helpers + trigger functions. Never exposed via
--      the Data API (api.schemas = public only); execute granted per-role.
CREATE SCHEMA IF NOT EXISTS private;
--> statement-breakpoint
GRANT USAGE ON SCHEMA private TO authenticated, app_server;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION private.is_thread_participant(p_thread_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.threads t
    WHERE t.id = p_thread_id
      AND ((SELECT auth.uid()) = t.client_account_id
        OR (SELECT auth.uid()) = (SELECT p.account_id FROM public.profiles p
                                   WHERE p.id = t.profile_id)));
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION private.is_thread_participant(uuid) FROM public, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.is_thread_participant(uuid) TO authenticated;
--> statement-breakpoint

-- ── 4. RLS on every table (hard rule 1) — before any of them holds data.
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.orgs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.media ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.verification_docs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.conversation_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.threads ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.import_jobs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.articles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- app_server full access on every table — the RLS exemption that works even
-- when the BYPASSRLS attribute was refused (see header).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'accounts','orgs','profiles','media','verification_docs',
    'conversation_settings','threads','messages','contacts','favorites',
    'reports','audit_log','import_jobs','articles']
  LOOP
    EXECUTE format(
      'CREATE POLICY "app_server full access" ON public.%I TO app_server USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;
--> statement-breakpoint

-- ── 5. Browser-path policies (DATA.md §6 posture). Separate policy per
--      operation, always `to` a role, always wrapped (select auth.uid()).

-- profiles: the lifecycle rule in SQL — public sees live only; owner sees own.
CREATE POLICY "public read live" ON public.profiles FOR SELECT
  TO anon, authenticated USING (state = 'live');
--> statement-breakpoint
CREATE POLICY "owner read own" ON public.profiles FOR SELECT
  TO authenticated USING ((SELECT auth.uid()) = account_id);
--> statement-breakpoint
-- Heartbeat only: combined with the column grant, this lets her island update
-- last_active_at on her own row and nothing else.
CREATE POLICY "owner heartbeat" ON public.profiles FOR UPDATE
  TO authenticated USING ((SELECT auth.uid()) = account_id)
  WITH CHECK ((SELECT auth.uid()) = account_id);
--> statement-breakpoint

-- media: approved, non-private images of live profiles; owner sees all hers.
CREATE POLICY "public read approved" ON public.media FOR SELECT
  TO anon, authenticated USING (
    state = 'approved' AND NOT is_private
    AND profile_id IN (SELECT id FROM public.profiles WHERE state = 'live'));
--> statement-breakpoint
CREATE POLICY "owner read own media" ON public.media FOR SELECT
  TO authenticated USING (
    profile_id IN (SELECT id FROM public.profiles
                   WHERE account_id = (SELECT auth.uid())));
--> statement-breakpoint

-- accounts: own row only.
CREATE POLICY "own account" ON public.accounts FOR SELECT
  TO authenticated USING ((SELECT auth.uid()) = id);
--> statement-breakpoint

-- threads/messages: participants only (MESSAGING.md §4).
CREATE POLICY "participants read threads" ON public.threads FOR SELECT
  TO authenticated USING (
    (SELECT auth.uid()) = client_account_id
    OR profile_id IN (SELECT id FROM public.profiles
                      WHERE account_id = (SELECT auth.uid())));
--> statement-breakpoint
CREATE POLICY "participants read messages" ON public.messages FOR SELECT
  TO authenticated USING ((SELECT private.is_thread_participant(thread_id)));
--> statement-breakpoint

-- favorites: the client's own rows, full lifecycle (RLS-guarded browser mutation).
CREATE POLICY "own favorites: select" ON public.favorites FOR SELECT
  TO authenticated USING ((SELECT auth.uid()) = client_account_id);
--> statement-breakpoint
CREATE POLICY "own favorites: insert" ON public.favorites FOR INSERT
  TO authenticated WITH CHECK ((SELECT auth.uid()) = client_account_id);
--> statement-breakpoint
CREATE POLICY "own favorites: delete" ON public.favorites FOR DELETE
  TO authenticated USING ((SELECT auth.uid()) = client_account_id);
--> statement-breakpoint

-- orgs, conversation_settings, contacts, reports, audit_log, verification_docs,
-- import_jobs, articles: RLS on, ZERO browser policies/grants — server path
-- (app_server) and admin actions only. PostgREST cannot reach them.

-- ── 6. Realtime authorization: policies on realtime.messages (SUPABASE.md §5.2).
CREATE POLICY "thread participants listen" ON realtime.messages FOR SELECT
  TO authenticated USING (
    realtime.messages.extension = 'broadcast'
    AND realtime.topic() LIKE 'thread:%'
    AND (SELECT private.is_thread_participant(
          split_part((SELECT realtime.topic()), ':', 2)::uuid)));
--> statement-breakpoint
CREATE POLICY "thread participants send" ON realtime.messages FOR INSERT
  TO authenticated WITH CHECK (
    realtime.messages.extension = 'broadcast'
    AND realtime.topic() LIKE 'thread:%'
    AND (SELECT private.is_thread_participant(
          split_part((SELECT realtime.topic()), ':', 2)::uuid)));
--> statement-breakpoint
-- Presence (city rooms + availability): logged-in surfaces only; anonymous
-- pages read presence-derived counts from SSR, never a socket (§5.4).
CREATE POLICY "presence listen" ON realtime.messages FOR SELECT
  TO authenticated USING (
    realtime.messages.extension = 'presence' AND realtime.topic() LIKE 'presence:%');
--> statement-breakpoint
CREATE POLICY "presence track" ON realtime.messages FOR INSERT
  TO authenticated WITH CHECK (
    realtime.messages.extension = 'presence' AND realtime.topic() LIKE 'presence:%');
--> statement-breakpoint

-- ── 7. Triggers.

-- audit_log is append-only for EVERY role — trigger beats grants because it
-- also binds app_server and postgres (SECURITY.md §3).
CREATE OR REPLACE FUNCTION private.audit_log_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END $$;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_rewrite
  BEFORE UPDATE OR DELETE ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION private.audit_log_immutable();
--> statement-breakpoint

-- Every message insert broadcasts to its private thread topic (minimal payload:
-- IDs + state, never content — API.md §4) and touches the thread's clock.
CREATE OR REPLACE FUNCTION private.broadcast_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM realtime.send(
    jsonb_build_object(
      'id', NEW.id, 'thread_id', NEW.thread_id, 'kind', NEW.kind,
      'sender', NEW.sender, 'created_at', NEW.created_at),
    'message', 'thread:' || NEW.thread_id::text, true);
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER messages_broadcast
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION private.broadcast_message();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION private.touch_thread()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.threads SET last_message_at = NEW.created_at WHERE id = NEW.thread_id;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER messages_touch_thread
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION private.touch_thread();
--> statement-breakpoint

-- state_changed_at stamps itself on every lifecycle transition (DATA.md §2) —
-- DB-enforced so no code path can forget the retention/410 anchor.
CREATE OR REPLACE FUNCTION private.stamp_state_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.state_changed_at := now();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER profiles_stamp_state_change
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW WHEN (OLD.state IS DISTINCT FROM NEW.state)
  EXECUTE FUNCTION private.stamp_state_change();
