// 年次の内訳説明（期首 → 期末の関係）。UI の年次明細とテストで使う。

import { categoryLabel } from '../domain/categories';
import type { MonthIndex } from '../domain/time';
import type { Posting, SimulationResult, YearlyRow } from './types';

type Ok = Extract<SimulationResult, { ok: true }>;

export type ExplainLine = { label: string; amount: number };

export type YearExplanation = {
  row: YearlyRow;
  /** 純資産: 期首 + 各項目 = 期末 */
  netWorth: { opening: number; lines: ExplainLine[]; closing: number; error: number };
  /** 生活口座: 期首 + 各項目 = 期末 */
  cash: { opening: number; lines: ExplainLine[]; closing: number; error: number };
  /** 出所（収支項目・イベント・口座）別の収入・支出 */
  bySource: { name: string; sourceKind: string; category: string; amount: number }[];
  postings: Posting[];
};

const CASH_LABEL: Record<string, string> = {
  income: '収入',
  expense: '支出',
  loan_interest: 'ローン利息',
  loan_principal: 'ローン元本返済',
  asset_purchase: '資産購入（頭金等）',
  asset_sale: '資産売却',
  transfer: '積立・取崩（振替）',
  interest: '利息',
  investment_return: '運用損益',
  loan_draw: '借入',
  revaluation: '評価損益',
};

export function explainYear(r: Ok, year: number): YearExplanation | null {
  const row = r.yearly.find((y) => y.year === year);
  if (!row) return null;
  const inYear = (m: MonthIndex) => m >= row.firstMonth && m <= row.lastMonth;
  const postings = r.postings.filter((p) => inYear(p.month));
  const cashId = r.accounts.find((a) => a.kind === 'cash')!.id;

  const nwLines: ExplainLine[] = [
    { label: '収入', amount: row.income },
    { label: '支出（ローン利息を含む）', amount: -row.expense },
    { label: '運用損益・利息', amount: row.investmentReturn },
    { label: '実物資産の評価損益', amount: row.revaluation },
  ];
  const nwSum = row.opening.netWorth + nwLines.reduce((a, l) => a + l.amount, 0);

  const cashMap = new Map<string, number>();
  for (const p of postings) {
    let d = 0;
    if (p.to === cashId) d += p.amount;
    if (p.from === cashId) d -= p.amount;
    if (d === 0) continue;
    const label = p.category === 'auto_liquidation' ? '自動取り崩し' : (CASH_LABEL[p.type] ?? p.type);
    cashMap.set(label, (cashMap.get(label) ?? 0) + d);
  }
  const cashLines = [...cashMap.entries()].map(([label, amount]) => ({ label, amount }));
  const cashSum = row.opening.cash + cashLines.reduce((a, l) => a + l.amount, 0);

  const src = new Map<string, { name: string; sourceKind: string; category: string; amount: number }>();
  for (const p of postings) {
    let amount = 0;
    if (p.type === 'income') amount = p.amount;
    else if (p.type === 'expense' || p.type === 'loan_interest') amount = -p.amount;
    else continue;
    const key = `${p.sourceId}|${p.category}|${p.name}`;
    const cur = src.get(key) ?? { name: p.name, sourceKind: p.sourceKind, category: categoryLabel(p.category), amount: 0 };
    cur.amount += amount;
    src.set(key, cur);
  }

  return {
    row,
    netWorth: { opening: row.opening.netWorth, lines: nwLines, closing: row.netWorth, error: nwSum - row.netWorth },
    cash: { opening: row.opening.cash, lines: cashLines, closing: row.cash, error: cashSum - row.cash },
    bySource: [...src.values()].sort((a, b) => b.amount - a.amount),
    postings,
  };
}


