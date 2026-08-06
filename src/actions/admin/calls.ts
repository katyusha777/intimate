/**
 * Calls metadata log (docs/ADMIN.md §11). Calls are peer-to-peer and NEVER
 * recorded — the admin sees metadata only, by architecture. The `call_sessions`
 * table is the durable home; the real WebRTC build writes rows, this reads
 * them. Empty until calls land.
 */
import { env } from 'cloudflare:workers';
import { and, desc, eq } from 'drizzle-orm';
import { createDb, type Db } from '@/db/client';
import { callSessions, profiles } from '@/db/schema';

const adb = (): Db => createDb((env as unknown as { HYPERDRIVE: Hyperdrive }).HYPERDRIVE);

export interface CallSession {
  id: string;
  profileName: string;
  profileSlug: string;
  clientName: string;
  /** Always the professional — clients can never initiate (DB CHECK). */
  initiatedBy: 'professional';
  mode: 'voice' | 'video';
  state: 'ringing' | 'active' | 'ended' | 'declined' | 'timeout';
  startedAt: string;
  durationS: number;
}

export async function listCalls(filter: { mode?: string; state?: string } = {}): Promise<CallSession[]> {
  const d = adb();
  const rows = await d
    .select({
      id: callSessions.id,
      profileName: profiles.name,
      profileSlug: profiles.slug,
      clientName: callSessions.clientName,
      mode: callSessions.mode,
      state: callSessions.state,
      startedAt: callSessions.startedAt,
      durationS: callSessions.durationS,
    })
    .from(callSessions)
    .innerJoin(profiles, eq(profiles.id, callSessions.profileId))
    .where(
      and(
        filter.mode ? eq(callSessions.mode, filter.mode as CallSession['mode']) : undefined,
        filter.state ? eq(callSessions.state, filter.state as CallSession['state']) : undefined,
      ),
    )
    .orderBy(desc(callSessions.startedAt));
  return rows.map((r) => ({
    id: r.id,
    profileName: r.profileName,
    profileSlug: r.profileSlug,
    clientName: r.clientName,
    initiatedBy: 'professional' as const,
    mode: r.mode,
    state: r.state,
    startedAt: r.startedAt.toISOString(),
    durationS: r.durationS,
  }));
}
