// フォームの検証（スキーマ検証 + 項目間の検証）。結果は「フィールドパス → メッセージ」。

import { accountSchema, flowItemSchema, transferRuleSchema, type Account, type FlowItem, type Scenario, type TransferRule, type Trigger } from '../domain/schema';
import { isYearMonth, parseYm, type MonthIndex } from '../domain/time';
import { resolveEnd, resolveStart } from '../engine';
import { collectErrors } from './components/common';

/** 画面で解決できるメンバーの生年月（登録メンバー + 結婚・出産イベントの派生メンバー） */
export function birthsOf(s: Scenario): Map<string, MonthIndex> {
  const m = new Map<string, MonthIndex>();
  for (const x of s.members) if (isYearMonth(x.birthYm)) m.set(x.id, parseYm(x.birthYm));
  for (const e of s.events) {
    if (e.type === 'marriage' && isYearMonth(e.params.spouseBirthYm)) m.set(`${e.id}:spouse`, parseYm(e.params.spouseBirthYm));
  }
  for (const e of s.events) {
    if (e.type === 'birth') {
      try {
        m.set(`${e.id}:child`, resolveStart(e.trigger, m));
      } catch {
        // 解決できない場合は検査しない
      }
    }
  }
  return m;
}

/** 開始 ≦ 終了 の検査。年齢・学齢指定も解決して比べる（解決できない場合は検査しない） */
export function periodOrder(start: Trigger | null, end: Trigger | null, s?: Scenario): string | null {
  if (!end) return null;
  try {
    if (start?.type === 'date' && !isYearMonth(start.ym)) return null;
    if (end.type === 'date' && !isYearMonth(end.ym)) return '終了の年月を YYYY-MM 形式で入力してください';
    const births = s ? birthsOf(s) : new Map<string, MonthIndex>();
    const from = start ? resolveStart(start, births) : s ? parseYm(s.assumptions.startYm) : null;
    const to = resolveEnd(end, births);
    if (from !== null && to < from) return '終了が開始より前になっています';
  } catch {
    return null;
  }
  return null;
}

function monthsCheck(f: { frequency: string; months?: number[] | undefined }): string | null {
  if (f.frequency === 'months' && (!f.months || f.months.length === 0)) return '発生月を 1 つ以上選んでください';
  return null;
}

export function validateFlow(f: FlowItem, s?: Scenario): Record<string, string> {
  const e = collectErrors(flowItemSchema, f);
  if (!f.name.trim()) e.name = '名称を入力してください';
  const m = monthsCheck(f);
  if (m) e.months = m;
  const d = periodOrder(f.start, f.end, s);
  if (d) e.end = d;
  return e;
}

export function validateAccount(a: Account, s: Scenario): Record<string, string> {
  const e = collectErrors(accountSchema, a);
  if (!a.name.trim()) e.name = '名称を入力してください';
  if (a.kind === 'cash' && s.accounts.some((x) => x.kind === 'cash' && x.id !== a.id)) e.kind = '生活口座は 1 つのみです（Q-21）';
  if (a.kind === 'loan' && !a.loan) e['loan.remainingMonths'] = '残り返済回数を入力してください';
  return e;
}

const TRANSFERABLE: Account['kind'][] = ['cash', 'savings', 'investment', 'other_asset'];

export function transferableAccounts(s: Scenario): Account[] {
  return s.accounts.filter((a) => TRANSFERABLE.includes(a.kind));
}

export function validateTransfer(t: TransferRule, s: Scenario): Record<string, string> {
  const e = collectErrors(transferRuleSchema, t);
  if (!t.name.trim()) e.name = '名称を入力してください';
  const ok = transferableAccounts(s).map((a) => a.id);
  if (!ok.includes(t.fromId)) e.fromId = '振替元の口座を選んでください';
  if (!ok.includes(t.toId)) e.toId = '振替先の口座を選んでください';
  if (t.fromId === t.toId) e.toId = '振替元と振替先は別の口座にしてください';
  const m = monthsCheck(t);
  if (m) e.months = m;
  const d = periodOrder(t.start, t.end, s);
  if (d) e.end = d;
  return e;
}
