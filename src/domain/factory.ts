// 新規データ・既定値の生成とシナリオ複製（ID 振り直し）。

import { CURRENT_SCHEMA_VERSION, type AppData, type Scenario } from './schema';
import { formatYm } from './time';

export function newId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  // 非セキュアコンテキスト用のフォールバック
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** 既定値（Q-18 で確定）。 */
export const DEFAULT_ASSUMPTIONS = {
  endAge: 100,
  inflationRate: 0.015,
  defaultReturnRate: 0.03,
  autoLiquidate: false,
} as const;

/** 作成時の翌月（保存されるのは値であり、後から自動で変わらない）。 */
export function defaultStartYm(now: Date): string {
  return formatYm(now.getFullYear() * 12 + now.getMonth() + 1);
}

export function newScenario(name: string, now: Date, selfBirthYm?: string): Scenario {
  const ts = now.toISOString();
  return {
    id: newId(),
    name,
    createdAt: ts,
    updatedAt: ts,
    assumptions: { startYm: defaultStartYm(now), ...DEFAULT_ASSUMPTIONS },
    members: selfBirthYm ? [{ id: newId(), role: 'self', name: '本人', birthYm: selfBirthYm }] : [],
    accounts: [{ id: newId(), kind: 'cash', name: '生活口座', openingBalance: 0, annualRate: 0 }],
    flows: [],
    transfers: [],
    events: [],
  };
}

export function newAppData(now: Date): AppData {
  const s = newScenario('基本プラン', now);
  return {
    app: 'lifeplan',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    savedAt: now.toISOString(),
    settings: { displayUnit: 'man' },
    activeScenarioId: s.id,
    scenarios: [s],
  };
}

/** ID・参照を保持するフィールド。複製時はこれらだけを変換する（列挙値や自由記述は変換しない） */
const REF_KEYS = new Set(['id', 'ownerId', 'memberId', 'fromId', 'toId', 'endsIds']);

/**
 * シナリオの完全コピー（Q-09）。全 ID を振り直し、シナリオ内の参照を新 ID に変換する。
 * イベント由来の派生 ID（`${eventId}:spouse` 等）も接頭辞で変換する。
 */
export function duplicateScenario(src: Scenario, name: string, now: Date): Scenario {
  const map = new Map<string, string>();
  const reg = (id: string) => {
    if (!map.has(id)) map.set(id, newId());
  };
  src.members.forEach((m) => reg(m.id));
  src.accounts.forEach((a) => reg(a.id));
  src.flows.forEach((f) => reg(f.id));
  src.transfers.forEach((t) => reg(t.id));
  src.events.forEach((e) => reg(e.id));

  const remap = (s: string): string => {
    const direct = map.get(s);
    if (direct) return direct;
    const i = s.indexOf(':');
    if (i > 0) {
      const head = map.get(s.slice(0, i));
      if (head) return head + s.slice(i);
    }
    return s;
  };
  const walk = (v: unknown, key?: string): unknown => {
    if (typeof v === 'string') return key && REF_KEYS.has(key) ? remap(v) : v;
    if (Array.isArray(v)) return v.map((x) => walk(x, key));
    if (v && typeof v === 'object') {
      const o: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) o[k] = walk(x, k);
      return o;
    }
    return v;
  };
  const ts = now.toISOString();
  const body = walk({
    assumptions: src.assumptions,
    members: src.members,
    accounts: src.accounts,
    flows: src.flows,
    transfers: src.transfers,
    events: src.events,
  }) as Pick<Scenario, 'assumptions' | 'members' | 'accounts' | 'flows' | 'transfers' | 'events'>;
  return {
    id: newId(),
    name,
    ...(src.description !== undefined ? { description: src.description } : {}),
    createdAt: ts,
    updatedAt: ts,
    copiedFrom: src.id,
    ...body,
  };
}
