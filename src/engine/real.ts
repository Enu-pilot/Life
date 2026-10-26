// 実質値（物価調整後）への換算（§18）。計算結果（名目値）を開始時点の物価で割り引いて表示するための変換。
// 計算そのものは名目値で行い、この変換は表示用。年次の値は各年の最終月の物価で割り引く（簡易）。

import { roundYen } from '../domain/money';
import type { MonthIndex } from '../domain/time';
import type { FlowTotals, MonthlyRow, SimulationResult, Snapshot, YearlyRow } from './types';

type Ok = Extract<SimulationResult, { ok: true }>;

/** 開始月から m までの物価指数 (1 + i)^((m − start) / 12) */
export function priceIndex(start: MonthIndex, m: MonthIndex, inflation: number): number {
  return Math.pow(1 + inflation, (m - start) / 12);
}

export function deflate(value: number, start: MonthIndex, m: MonthIndex, inflation: number): number {
  return roundYen(value / priceIndex(start, m, inflation));
}

const FLOW_KEYS: (keyof FlowTotals)[] = ['income', 'expense', 'loanInterest', 'loanPrincipal', 'assetPurchase', 'assetSale', 'loanDraw', 'investmentReturn', 'revaluation', 'autoLiquidation'];

function snap(s: Snapshot, d: (v: number) => number): Snapshot {
  return {
    balances: Object.fromEntries(Object.entries(s.balances).map(([k, v]) => [k, d(v)])),
    cash: d(s.cash),
    financialAssets: d(s.financialAssets),
    realAssets: d(s.realAssets),
    liabilities: d(s.liabilities),
    netWorth: d(s.netWorth),
  };
}

/** 表示用に実質値へ換算した結果を返す（明細・照合は名目値の結果を使うこと） */
export function toReal(r: Ok, inflation: number): Ok {
  const d = (m: MonthIndex) => (v: number) => deflate(v, r.start, m, inflation);
  const monthly: MonthlyRow[] = r.monthly.map((row) => {
    const f = d(row.month);
    const out = { ...row, ...snap(row, f) };
    for (const k of FLOW_KEYS) out[k] = f(row[k]);
    return out;
  });
  const yearly: YearlyRow[] = r.yearly.map((y) => {
    const f = d(y.lastMonth);
    const out: YearlyRow = { ...y, ...snap(y, f), opening: snap(y.opening, d(y.firstMonth - 1)), byCategory: Object.fromEntries(Object.entries(y.byCategory).map(([k, v]) => [k, f(v)])) };
    for (const k of FLOW_KEYS) out[k] = f(y[k]);
    out.netIncome = out.income - out.expense;
    out.cashChange = out.cash - out.opening.cash;
    return out;
  });
  const last = r.monthly[r.monthly.length - 1];
  return {
    ...r,
    monthly,
    yearly,
    metrics: {
      ...r.metrics,
      endNetWorth: last ? d(last.month)(r.metrics.endNetWorth) : r.metrics.endNetWorth,
      endFinancialAssets: last ? d(last.month)(r.metrics.endFinancialAssets) : r.metrics.endFinancialAssets,
      minCash: { ...r.metrics.minCash, amount: d(r.metrics.minCash.month)(r.metrics.minCash.amount) },
    },
  };
}
