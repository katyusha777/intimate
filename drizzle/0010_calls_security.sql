-- 0010_calls_security — the calls + invites wall (VIDEO-CALLING.md §3, style
-- of 0001_security). call_sessions (created 0003, predates its RLS) and
-- contact_invites get RLS + app_server policies; BOTH stay server-path only —
-- zero browser grants, so "a client cannot insert a call" is enforced by the
-- absence of any authenticated path, not by UI. Realtime gains the account
-- topic (badges + ring) and the call topic (SDP/ICE signaling).

-- ── 1. RLS on + app_server policies (hard rule 1).
ALTER TABLE public.call_sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.contact_invites ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "app_server full access" ON public.call_sessions TO app_server USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY "app_server full access" ON public.contact_invites TO app_server USING (true) WITH CHECK (true);
--> statement-breakpoint

-- ── 2. Helper: is the caller a participant of this call's thread? (Realtime
--      call-topic authorization; same shape as is_thread_participant.)
CREATE OR REPLACE FUNCTION private.is_call_participant(p_call_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.call_sessions c
    JOIN public.threads t ON t.id = c.thread_id
    WHERE c.id = p_call_id
      AND ((SELECT auth.uid()) = t.client_account_id
        OR (SELECT auth.uid()) = (SELECT p.account_id FROM public.profiles p
                                   WHERE p.id = t.profile_id)));
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION private.is_call_participant(uuid) FROM public, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.is_call_participant(uuid) TO authenticated;
--> statement-breakpoint

-- ── 3. Realtime authorization (SUPABASE.md §5.2).
-- account:{uid} — private per-account topic: unread badges, new-thread pings,
-- the incoming-call ring. Listen-only (the DB is the only sender).
CREATE POLICY "own account listen" ON realtime.messages FOR SELECT
  TO authenticated USING (
    realtime.messages.extension = 'broadcast'
    AND realtime.topic() LIKE 'account:%'
    AND split_part((SELECT realtime.topic()), ':', 2)::uuid = (SELECT auth.uid()));
--> statement-breakpoint
-- call:{sessionId} — the ephemeral SDP/ICE signaling channel. Both directions
-- (browsers exchange offer/answer/candidates); participants only. Payloads are
-- data, never instructions; nothing is persisted.
CREATE POLICY "call participants listen" ON realtime.messages FOR SELECT
  TO authenticated USING (
    realtime.messages.extension = 'broadcast'
    AND realtime.topic() LIKE 'call:%'
    AND (SELECT private.is_call_participant(
          split_part((SELECT realtime.topic()), ':', 2)::uuid)));
--> statement-breakpoint
CREATE POLICY "call participants send" ON realtime.messages FOR INSERT
  TO authenticated WITH CHECK (
    realtime.messages.extension = 'broadcast'
    AND realtime.topic() LIKE 'call:%'
    AND (SELECT private.is_call_participant(
          split_part((SELECT realtime.topic()), ':', 2)::uuid)));
--> statement-breakpoint

-- ── 4. Triggers.

-- Every message insert also pings the RECIPIENT's account topic (minimal
-- payload — the badge/inbox refresh signal wherever they are in the app).
CREATE OR REPLACE FUNCTION private.notify_recipient()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_recipient uuid;
BEGIN
  SELECT CASE WHEN NEW.sender = 'client'
              THEN (SELECT p.account_id FROM public.profiles p WHERE p.id = t.profile_id)
              ELSE t.client_account_id END
    INTO v_recipient
    FROM public.threads t WHERE t.id = NEW.thread_id;
  IF v_recipient IS NOT NULL THEN
    PERFORM realtime.send(
      jsonb_build_object('thread_id', NEW.thread_id, 'kind', NEW.kind),
      'message', 'account:' || v_recipient::text, true);
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER messages_notify_recipient
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION private.notify_recipient();
--> statement-breakpoint

-- Call lifecycle broadcast: INSERT (ringing) rings the client's account topic;
-- every state change also syncs the thread topic (both parties' open UIs).
-- Minimal payload: ids + mode + state, never SDP, never content.
CREATE OR REPLACE FUNCTION private.broadcast_call()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_payload jsonb;
BEGIN
  v_payload := jsonb_build_object(
    'id', NEW.id, 'thread_id', NEW.thread_id, 'mode', NEW.mode, 'state', NEW.state);
  IF NEW.client_account_id IS NOT NULL THEN
    PERFORM realtime.send(v_payload, 'call', 'account:' || NEW.client_account_id::text, true);
  END IF;
  IF NEW.thread_id IS NOT NULL THEN
    PERFORM realtime.send(v_payload, 'call', 'thread:' || NEW.thread_id::text, true);
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER call_sessions_broadcast
  AFTER INSERT OR UPDATE OF state ON public.call_sessions
  FOR EACH ROW EXECUTE FUNCTION private.broadcast_call();
