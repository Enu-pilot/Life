// フォームの検証（スキーマ検証 + 項目間の検証）。結果は「フィールドパス → メッセージ」。

import { accountSchema, flowItemSchema, transferRuleSchema, type Account, type FlowItem, type Scenario, type TransferRule, type Trigger } from '../domain/schema';
import { parseYm } from '../domain/time';
import { collectErrors } from './components/common';

function dateOrder(start: Trigger | null, end: Trigger | null): string | null {
  if (start?.type === 'date' && end?.type === 'date' && parseYm(start.ym) > parseYm(end.ym)) {
    return '終了は開始以降の年月にしてください';
  }
  return null;
}

function monthsCheck(f: { frequency: string; months?: number[] | undefined }): string | null {
  if (f.frequency === 'months' && (!f.months || f.months.length === 0)) return '発生月を 1 つ以上選んでください';
  return null;
}

export function validateFlow(f: FlowItem): Record<string, string> {
  const e = collectErrors(flowItemSchema, f);
  if (!f.name.trim()) e.name = '名称を入力してください';
  const m = monthsCheck(f);
  if (m) e.months = m;
  const d = dateOrder(f.start, f.end);
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
  const d = dateOrder(t.start, t.end);
  if (d) e.end = d;
  return e;
}
