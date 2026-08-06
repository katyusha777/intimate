-- 0013_call_topic_broadcast — call lifecycle also broadcasts on the call's own
-- signaling topic. Gap found in the stability pass (2026-08-07): decline and
-- server-swept terminations only reached account:/thread: topics, so the party
-- holding only `call:{id}` (the ringing caller) never learned — she rang the
-- full 30s into a "missed" card for a call the client had declined in second
-- two. Both parties already hold the call topic (0010 RLS policies), so the
-- trigger is the one honest place to announce every state change.
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
  -- The signaling channel both parties hold for the call's whole life: state
  -- events ride beside offer/answer/ice (payload = ids + state, never SDP).
  PERFORM realtime.send(v_payload, 'call', 'call:' || NEW.id::text, true);
  RETURN NULL;
END $$;
