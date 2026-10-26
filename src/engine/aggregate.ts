// 月次 → 年次の集計と指標（calculation-spec §13）

import { ageAt, monthIndexOf, yearOf, type MonthIndex } from '../domain/time';
import type { Ledger } from './ledger';
import { EXTERNAL, type FlowTotals, type Metrics, type MonthlyRow, type Plan, type Snapshot, type YearlyRow } from './types';

const ZERO: FlowTotals = {
  income: 0,
  expense: 0,
  loanInterest: 0,
  loanPrincipal: 0,
  assetPurchase: 0,
  assetSale: 0,
  loanDraw: 0,
  investmentReturn: 0,
  revaluation: 0,
  autoLiquidation: 0,
};
const FLOW_KEYS = Object.keys(ZERO) as (keyof FlowTotals)[];

function snapshotOf(r: Snapshot): Snapshot {
  return {
    balances: r.balances,
    cash: r.cash,
    financialAssets: r.financialAssets,
    realAssets: r.realAssets,
    liabilities: r.liabilities,
    netWorth: r.netWorth,
  };
}

export function openingSnapshot(plan: Plan): Snapshot {
  const balances: Record<string, number> = {};
  let financialAssets = 0;
  let realAssets = 0;
  let liabilities = 0;
  let cash = 0;
  for (const a of plan.accounts) {
    // イベントで後から作られる口座は開始時点で 0
    const b = a.sourceKind === 'event' ? 0 : a.opening;
    balances[a.id] = b;
    if (a.kind === 'loan') liabilities += b;
    else if (a.kind === 'cash' || a.kind === 'savings' || a.kind === 'investment') financialAssets += b;
    else realAssets += b;
    if (a.kind === 'cash') cash = b;
  }
  return { balances, cash, financialAssets, realAssets, liabilities, netWorth: financialAssets + realAssets - liabilities };
}

export function aggregate(plan: Plan, ledger: Ledger, monthly: MonthlyRow[]): { monthly: MonthlyRow[]; yearly: YearlyRow[]; metrics: Metrics } {
  const start = plan.ctx.start;
  const byCat: Record<string, number>[] = monthly.map(() => ({}));
  for (const p of ledger.postings) {
    const i = p.month - start;
    const row = monthly[i]!;
    const cat = byCat[i]!;
    switch (p.type) {
      case 'income':
        row.income += p.amount;
        cat[p.category] = (cat[p.category] ?? 0) + p.amount;
        break;
      case 'expense':
        row.expense += p.amount;
        cat[p.category] = (cat[p.category] ?? 0) - p.amount;
        break;
      case 'loan_interest':
        row.expense += p.amount;
        row.loanInterest += p.amount;
        cat.loan_interest = (cat.loan_interest ?? 0) - p.amount;
        break;
      case 'loan_principal':
        row.loanPrincipal += p.amount;
        break;
      case 'asset_purchase':
        row.assetPurchase += p.amount;
        break;
      case 'asset_sale':
        row.assetSale += p.amount;
        break;
      case 'loan_draw':
        row.loanDraw += p.amount;
        break;
      case 'investment_return':
      case 'interest':
        row.investmentReturn += p.to === EXTERNAL ? -p.amount : p.amount;
        break;
      case 'revaluation':
        row.revaluation += p.to === EXTERNAL ? -p.amount : p.amount;
        break;
      case 'transfer':
        if (p.category === 'auto_liquidation') row.autoLiquidation += p.amount;
        break;
    }
  }

  const births = [...plan.ctx.births.entries()];
  const yearly: YearlyRow[] = [];
  let prev: Snapshot = openingSnapshot(plan);
  const initial = prev;
  for (let i = 0; i < monthly.length; ) {
    const year = yearOf(monthly[i]!.month);
    const rows: MonthlyRow[] = [];
    const cats: Record<string, number> = {};
    while (i < monthly.length && yearOf(monthly[i]!.month) === year) {
      rows.push(monthly[i]!);
      for (const [k, v] of Object.entries(byCat[i]!)) cats[k] = (cats[k] ?? 0) + v;
      i++;
    }
    const last = rows[rows.length - 1]!;
    const totals = { ...ZERO };
    for (const r of rows) for (const k of FLOW_KEYS) totals[k] += r[k];
    const dec = monthIndexOf(year, 12);
    const ages: Record<string, number> = {};
    for (const [id, b] of births) {
      const a = ageAt(b, dec);
      if (a >= 0) ages[id] = a;
    }
    const closing = snapshotOf(last);
    yearly.push({
      year,
      ages,
      firstMonth: rows[0]!.month,
      lastMonth: last.month,
      ...totals,
      ...closing,
      netIncome: totals.income - totals.expense,
      cashChange: closing.cash - prev.cash,
      opening: prev,
      byCategory: cats,
      shortfallMonths: rows.filter((r) => r.shortfall).length,
      reconciliationError: prev.netWorth + totals.income - totals.expense + totals.investmentReturn + totals.revaluation - closing.netWorth,
    });
    prev = closing;
  }

  let minCash = { amount: Infinity, month: start as MonthIndex };
  let firstShortfall: MonthIndex | null = null;
  let maxShort = 0;
  let shortMonths = 0;
  for (const r of monthly) {
    if (r.cash < minCash.amount) minCash = { amount: r.cash, month: r.month };
    if (r.cash < 0) {
      shortMonths++;
      if (firstShortfall === null) firstShortfall = r.month;
      maxShort = Math.max(maxShort, -r.cash);
    }
  }
  const loanPayoff = plan.loans.map((l) => {
    let paid: MonthIndex | null = null;
    let had = false;
    for (const r of monthly) {
      const b = r.balances[l.accountId] ?? 0;
      if (b > 0) had = true;
      if (had && b === 0) {
        paid = r.month;
        break;
      }
    }
    return { accountId: l.accountId, name: l.name, month: paid };
  });
  const lastRow = monthly[monthly.length - 1];
  return {
    monthly,
    yearly,
    metrics: {
      startNetWorth: initial.netWorth,
      endNetWorth: lastRow?.netWorth ?? initial.netWorth,
      endFinancialAssets: lastRow?.financialAssets ?? initial.financialAssets,
      minCash: minCash.amount === Infinity ? { amount: initial.cash, month: start } : minCash,
      shortfall: { firstMonth: firstShortfall, maxAmount: maxShort, months: shortMonths },
      lifetimeIncome: yearly.reduce((a, y) => a + y.income, 0),
      lifetimeExpense: yearly.reduce((a, y) => a + y.expense, 0),
      loanPayoff,
    },
  };
}
