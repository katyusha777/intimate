/**
 * Calls metadata log (docs/ADMIN.md §11). Calls are peer-to-peer and NEVER
 * recorded — the admin sees metadata only, by architecture (a feature of the
 * safety story, not a gap). This rides on the real calls build later; for now
 * a seeded mock of `call_sessions` so the surface exists and is demoable.
 */
import { env } from 'cloudflare:workers';
import { profilesApi } from '@/app/api/profiles';

interface Kv {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}
function kv(): Kv | undefined {
  return (env as unknown as Record<string, unknown>).SESSION as Kv | undefined;
}

export interface CallSession {
  id: string;
  profileName: string;
  profileSlug: string;
  clientName: string;
  /** Always the professional — clients can never initiate (asserted visually). */
  initiatedBy: 'professional';
  mode: 'voice' | 'video';
  state: 'ended' | 'declined' | 'timeout' | 'active';
  startedAt: string;
  durationS: number;
}

const KEY = 'admin:calls';
const FLAG = 'admin:calls:seeded';

async function readCalls(): Promise<CallSession[]> {
  const raw = await kv()?.get(KEY);
  try {
    return raw ? (JSON.parse(raw) as CallSession[]) : [];
  } catch {
    return [];
  }
}

async function seedCalls(): Promise<void> {
  if (await kv()?.get(FLAG)) return;
  await kv()?.put(FLAG, '1');
  const { items } = await profilesApi.list({ limit: 8 });
  const min = (n: number) => new Date(Date.now() - n * 60_000).toISOString();
  const clients = ['Daan', 'Thomas', 'Sven', 'Lucas', 'Noah', 'Finn'];
  const specs: Array<[number, CallSession['mode'], CallSession['state'], number]> = [
    [12, 'video', 'active', 0],
    [48, 'voice', 'ended', 320],
    [95, 'video', 'ended', 540],
    [140, 'voice', 'declined', 0],
    [220, 'video', 'timeout', 0],
    [400, 'voice', 'ended', 210],
    [700, 'video', 'ended', 880],
    [1300, 'voice', 'declined', 0],
  ];
  const calls: CallSession[] = specs.map(([agoMin, mode, state, durationS], i) => {
    const p = items[i % items.length]!;
    return {
      id: `call_${i}`,
      profileName: p.name,
      profileSlug: p.slug,
      clientName: clients[i % clients.length]!,
      initiatedBy: 'professional',
      mode,
      state,
      startedAt: min(agoMin),
      durationS,
    };
  });
  await kv()?.put(KEY, JSON.stringify(calls));
}

export async function listCalls(filter: { mode?: string; state?: string } = {}): Promise<CallSession[]> {
  await seedCalls();
  let calls = await readCalls();
  if (filter.mode) calls = calls.filter((c) => c.mode === filter.mode);
  if (filter.state) calls = calls.filter((c) => c.state === filter.state);
  return calls.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}
