/**
 * Mock reports backend: a single KV list (reports:all). Users append via
 * `file`; admins read/resolve. The Supabase backend replaces this with a
 * `reports` table + RLS (reporter can insert; admins read/update); the seam
 * (api/reports.ts) is the switch.
 */
import { env } from 'cloudflare:workers';
import { isEscalation, ReportSchema, type Report, type ReportsApi } from '@/app/models/report';

interface Kv {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}
function kv(): Kv | undefined {
  return (env as unknown as Record<string, unknown>).SESSION as Kv | undefined;
}
const KEY = 'reports:all';
const now = () => new Date().toISOString();
const rid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

async function readAll(): Promise<Report[]> {
  const raw = await kv()?.get(KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.map((r) => ReportSchema.safeParse(r)).flatMap((r) => (r.success ? [r.data] : []));
  } catch {
    return [];
  }
}
async function writeAll(list: Report[]): Promise<void> {
  await kv()?.put(KEY, JSON.stringify(list));
}

export const reportsApi: ReportsApi = {
  async file(session, input) {
    const list = await readAll();
    const report = ReportSchema.parse({
      id: rid(),
      createdAt: now(),
      reporterEmail: session.email,
      escalated: isEscalation(input.reason),
      ...input,
    });
    list.push(report);
    await writeAll(list);
    return report;
  },

  async list() {
    return readAll();
  },

  async byId(id) {
    return (await readAll()).find((r) => r.id === id) ?? null;
  },

  async resolve({ id, resolution, note, handledBy }) {
    const list = await readAll();
    const r = list.find((x) => x.id === id);
    if (!r) return;
    r.state = 'resolved';
    r.resolution = resolution;
    r.resolutionNote = note ?? '';
    r.handledBy = handledBy;
    r.handledAt = now();
    await writeAll(list);
  },

  async dismiss({ id, note, handledBy }) {
    const list = await readAll();
    const r = list.find((x) => x.id === id);
    if (!r) return;
    r.state = 'dismissed';
    r.resolutionNote = note ?? '';
    r.handledBy = handledBy;
    r.handledAt = now();
    await writeAll(list);
  },

  async openCount() {
    return (await readAll()).filter((r) => r.state === 'open').length;
  },

  async escalationCount() {
    return (await readAll()).filter((r) => r.state === 'open' && r.escalated).length;
  },
};
