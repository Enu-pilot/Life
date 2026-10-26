// グラフ用データ。年次表と同じ result.yearly / result.monthly から作る（グラフと表の値の一致を保証）

import type { AccountKind } from '../../domain/schema';
import { calendarMonthOf, yearOf } from '../../domain/time';
import type { OkResult } from '../useSimulation';

/** 既定パレット（dataviz reference palette, light）。系列の順序は固定 */
export const SERIES = {
  cash: { label: '生活口座', color: '#2a78d6' },
  savings: { label: '預金', color: '#eb6834' },
  investment: { label: '投資', color: '#1baf7a' },
  property: { label: '不動産', color: '#eda100' },
  vehicle: { label: '車両', color: '#e87ba4' },
  other_asset: { label: 'その他資産', color: '#008300' },
  loan: { label: '負債', color: '#6250d6' },
} as const;
export const COMPARE_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'] as const;
export const INK = { primary: '#0b0b0b', secondary: '#52514e', grid: '#e4e3df', critical: '#e34948' };

export type AssetRow = {
  year: number;
  label: string;
  cash: number;
  savings: number;
  investment: number;
  property: number;
  vehicle: number;
  other_asset: number;
  /** 負債（グラフでは下向きに描くため負の値） */
  loan: number;
  netWorth: number;
  shortfall: boolean;
};

export function assetRows(r: OkResult): AssetRow[] {
  const kinds = new Map(r.accounts.map((a) => [a.id, a.kind] as const));
  return r.yearly.map((y) => {
    const sums: Record<AccountKind, number> = { cash: 0, savings: 0, investment: 0, property: 0, vehicle: 0, other_asset: 0, loan: 0 };
    for (const [id, b] of Object.entries(y.balances)) sums[kinds.get(id)!] += b;
    const age = y.ages[r.selfId];
    return {
      year: y.year,
      label: age !== undefined ? `${y.year}（${age}歳）` : String(y.year),
      cash: sums.cash,
      savings: sums.savings,
      investment: sums.investment,
      property: sums.property,
      vehicle: sums.vehicle,
      other_asset: sums.other_asset,
      loan: -sums.loan,
      netWorth: y.netWorth,
      shortfall: y.shortfallMonths > 0,
    };
  });
}

export type CashflowRow = { key: string; label: string; income: number; expense: number; net: number; shortfall: boolean };

export function yearlyCashflow(r: OkResult): CashflowRow[] {
  return r.yearly.map((y) => {
    const age = y.ages[r.selfId];
    return { key: String(y.year), label: age !== undefined ? `${y.year}（${age}歳）` : String(y.year), income: y.income, expense: -y.expense, net: y.netIncome, shortfall: y.shortfallMonths > 0 };
  });
}

export function monthlyCashflow(r: OkResult, year: number): CashflowRow[] {
  return r.monthly
    .filter((m) => yearOf(m.month) === year)
    .map((m) => ({ key: String(m.month), label: `${calendarMonthOf(m.month)}月`, income: m.income, expense: -m.expense, net: m.income - m.expense, shortfall: m.shortfall }));
}

/** 使われている系列だけを返す（空の系列を凡例に出さない） */
export function usedKinds(rows: AssetRow[]): (keyof typeof SERIES)[] {
  return (Object.keys(SERIES) as (keyof typeof SERIES)[]).filter((k) => rows.some((r) => r[k] !== 0));
}

export type CompareRow = { year: number } & Record<string, number | null>;

/** 比較用: 暦年でそろえた純資産（またはその他の指標）。データがない年は null */
export function compareRows(results: { id: string; result: OkResult }[], metric: 'netWorth' | 'financialAssets' | 'cash'): CompareRow[] {
  const years = new Set<number>();
  results.forEach((x) => x.result.yearly.forEach((y) => years.add(y.year)));
  return [...years]
    .sort((a, b) => a - b)
    .map((year) => {
      const row: CompareRow = { year };
      for (const x of results) row[x.id] = x.result.yearly.find((y) => y.year === year)?.[metric] ?? null;
      return row;
    });
}

export const yenAxis = (v: number) => {
  const man = v / 1e4;
  if (Math.abs(man) >= 10000) return `${(man / 10000).toLocaleString('ja-JP', { maximumFractionDigits: 1 })}億`;
  return `${man.toLocaleString('ja-JP', { maximumFractionDigits: 0 })}万`;
};
