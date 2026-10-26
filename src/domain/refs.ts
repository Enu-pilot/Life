import type { Scenario } from './schema';

/** 他の要素を参照するフィールド名（定義側の `id` は含まない） */
export const REF_FIELDS = new Set(['ownerId', 'memberId', 'fromId', 'toId', 'endsIds']);

/** オブジェクト内の参照値（ID）をすべて集める */
export function collectRefs(v: unknown, key?: string, out: Set<string> = new Set()): Set<string> {
  if (typeof v === 'string') {
    if (key && REF_FIELDS.has(key)) out.add(v);
  } else if (Array.isArray(v)) {
    v.forEach((x) => collectRefs(x, key, out));
  } else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) collectRefs(x, k, out);
  }
  return out;
}

function refersTo(v: unknown, id: string): boolean {
  for (const r of collectRefs(v)) if (r === id || r.startsWith(`${id}:`)) return true;
  return false;
}

/** シナリオ内で id が参照されている箇所。削除可否の判定に使う */
export function findReferences(s: Scenario, id: string): string[] {
  const hits: string[] = [];
  s.flows.forEach((f) => f.id !== id && refersTo(f, id) && hits.push(`収支「${f.name}」`));
  s.transfers.forEach((t) => t.id !== id && refersTo(t, id) && hits.push(`積立「${t.name}」`));
  s.events.forEach((e) => e.id !== id && refersTo(e, id) && hits.push(`イベント「${e.name}」`));
  return hits;
}
