// 人生イベントの展開器レジストリ（architecture.md §5.1）。
// 展開器はイベントのパラメータから計算ルール（収支・一時仕訳・口座・ローン）を生成する。保存データには書き戻さない。

import type { EventType, FlowTemplate, LifeEvent, Trigger } from '../../domain/schema';
import type { MonthIndex } from '../../domain/time';
import type { AccountC, Ctx, FlowRule, LoanRule, OneTime } from '../types';

export type ExpandApi = {
  ctx: Ctx;
  /** イベント発生月 */
  month: MonthIndex;
  resolveStart(t: Trigger): MonthIndex;
  resolveEnd(t: Trigger): MonthIndex;
  /** イベントの収支テンプレートを、発生月開始の収支ルールとして追加する */
  addTemplate(t: FlowTemplate): void;
  addFlow(rule: Omit<FlowRule, 'sourceId' | 'sourceKind'>): void;
  addOneTime(o: DistributiveOmit<OneTime, 'sourceId' | 'sourceKind'>): void;
  addAccount(a: Omit<AccountC, 'sourceId' | 'sourceKind'>): void;
  addLoan(l: Omit<LoanRule, 'sourceId' | 'sourceKind'>): void;
  warn(code: string, message: string): void;
};

type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;

export type Expander<T extends EventType> = (e: Extract<LifeEvent, { type: T }>, api: ExpandApi) => void;

export const EXPANDERS: { [T in EventType]?: Expander<T> } = {};

export function registerExpander<T extends EventType>(type: T, fn: Expander<T>): void {
  (EXPANDERS as Record<string, unknown>)[type] = fn;
}

/** イベントが追加する世帯メンバー（結婚 → 配偶者、出産 → 子） */
export function derivedMembers(e: LifeEvent, eventMonth: () => MonthIndex, parse: (ym: string) => MonthIndex): { id: string; birth: MonthIndex }[] {
  if (e.type === 'marriage') return [{ id: `${e.id}:spouse`, birth: parse(e.params.spouseBirthYm) }];
  if (e.type === 'birth') return [{ id: `${e.id}:child`, birth: eventMonth() }];
  return [];
}
