// 月次ループ（calculation-spec §7）。処理順序は結果に影響するため固定する。

import { monthlyRate, roundYen } from '../domain/money';
import type { AccountKind, Scenario } from '../domain/schema';
import { calendarMonthOf, type MonthIndex } from '../domain/time';
import { aggregate } from './aggregate';
import { compile } from './compile';
import { Ledger } from './ledger';
import { LoanState } from './loan';
import { EXTERNAL, type FlowRule, type MonthlyRow, type Plan, type SimOptions, type SimulationResult, type TransferRuleC } from './types';
import { ENGINE_VERSION } from './version';
import './events';

const FINANCIAL: AccountKind[] = ['cash', 'savings', 'investment'];
const REAL: AccountKind[] = ['property', 'vehicle', 'other_asset'];

/** 上昇の適用回数: base より後、m 以前に stepMonth を迎えた回数（calculation-spec §8.2） */
export function growthSteps(base: MonthIndex, m: MonthIndex, stepMonth: number): number {
  if (m <= base) return 0;
  const offset = (stepMonth - calendarMonthOf(base) + 12) % 12;
  const first = base + (offset === 0 ? 12 : offset);
  if (m < first) return 0;
  return Math.floor((m - first) / 12) + 1;
}

export function amountAt(r: Pick<FlowRule, 'amount' | 'growth' | 'growthBase' | 'growthStepMonth'>, m: MonthIndex, inflation: number): number {
  const g = r.growth;
  if (g.type === 'none') return r.amount;
  const rate = g.type === 'inflation' ? inflation : g.rate;
  return r.amount * Math.pow(1 + rate, growthSteps(r.growthBase, m, r.growthStepMonth));
}

function occurs(r: Pick<FlowRule, 'from' | 'to' | 'months'>, m: MonthIndex): boolean {
  if (m < r.from || m > r.to) return false;
  return r.months === null || r.months.includes(calendarMonthOf(m));
}

export function runPlan(plan: Plan, opts: SimOptions = {}): { ledger: Ledger; monthly: MonthlyRow[] } {
  const { ctx } = plan;
  const kinds = new Map(plan.accounts.map((a) => [a.id, a.kind] as const));
  const ledger = new Ledger(kinds);
  for (const a of plan.accounts) ledger.open(a.id, a.opening);
  const cash = plan.accounts.find((a) => a.kind === 'cash')!;
  const returnShift = opts.returnShift ?? 0;
  const loans = plan.loans.map((l) => new LoanState(l));
  const oneTimesByMonth = new Map<MonthIndex, typeof plan.oneTimes>();
  for (const o of [...plan.oneTimes].sort((a, b) => a.key.localeCompare(b.key))) {
    const list = oneTimesByMonth.get(o.month) ?? [];
    list.push(o);
    oneTimesByMonth.set(o.month, list);
  }
  const monthly: MonthlyRow[] = [];

  const postFlow = (r: FlowRule, m: MonthIndex) => {
    if (!occurs(r, m)) return;
    const amount = roundYen(amountAt(r, m, ctx.inflationRate));
    if (amount <= 0) return;
    ledger.post(`flow:${r.key}`, {
      month: m,
      from: r.direction === 'income' ? EXTERNAL : cash.id,
      to: r.direction === 'income' ? cash.id : EXTERNAL,
      amount,
      type: r.direction,
      category: r.category,
      name: r.name,
      sourceId: r.sourceId,
      sourceKind: r.sourceKind,
    });
  };

  for (let m = ctx.start; m <= ctx.end; m++) {
    // 2. 運用損益・利息（期首残高に月利を適用）
    for (const a of plan.accounts) {
      if (a.kind !== 'cash' && a.kind !== 'savings' && a.kind !== 'investment') continue;
      const rate = a.annualRate + (a.kind === 'investment' ? returnShift : 0);
      const bal = ledger.balance(a.id);
      if (rate === 0 || bal <= 0) continue;
      const r = roundYen(bal * monthlyRate(rate));
      const type = a.kind === 'investment' ? 'investment_return' : 'interest';
      const base = { month: m, type, category: type, name: a.name, sourceId: a.id, sourceKind: 'account' } as const;
      if (r > 0) ledger.post(`ret:${a.id}`, { ...base, from: EXTERNAL, to: a.id, amount: r });
      else if (r < 0) ledger.post(`ret:${a.id}`, { ...base, from: a.id, to: EXTERNAL, amount: Math.min(-r, bal) });
    }
    // 3. 実物資産の評価変動
    for (const a of plan.accounts) {
      if (!REAL.includes(a.kind) || a.annualRate === 0) continue;
      const bal = ledger.balance(a.id);
      if (bal <= 0) continue;
      const r = roundYen(bal * monthlyRate(a.annualRate));
      const base = { month: m, type: 'revaluation', category: 'revaluation', name: a.name, sourceId: a.sourceId, sourceKind: a.sourceKind } as const;
      if (r > 0) ledger.post(`reval:${a.id}`, { ...base, from: EXTERNAL, to: a.id, amount: r });
      else if (r < 0) ledger.post(`reval:${a.id}`, { ...base, from: a.id, to: EXTERNAL, amount: Math.min(-r, bal) });
    }
    // 4. 収入
    for (const f of plan.flows) if (f.direction === 'income') postFlow(f, m);
    // 5. 一時収支・資産購入・借入・売却
    for (const o of oneTimesByMonth.get(m) ?? []) {
      if (o.kind === 'post') {
        ledger.post(`one:${o.key}`, {
          month: m,
          from: o.from,
          to: o.to,
          amount: o.amount,
          type: o.type,
          category: o.category,
          name: o.name,
          sourceId: o.sourceId,
          sourceKind: o.sourceKind,
        });
      } else {
        const bal = ledger.balance(o.accountId);
        if (bal > 0) {
          ledger.post(`one:${o.key}`, {
            month: m,
            from: o.accountId,
            to: o.to,
            amount: bal,
            type: 'asset_sale',
            category: o.category,
            name: o.name,
            sourceId: o.sourceId,
            sourceKind: o.sourceKind,
          });
        }
      }
    }
    // 6. 定常支出
    for (const f of plan.flows) if (f.direction === 'expense') postFlow(f, m);
    // 7. ローン返済（利息は支出、元本は負債の減少）
    for (const l of loans) {
      const pay = l.nextPayment(m, ledger.balance(l.rule.accountId));
      if (!pay) continue;
      const base = { month: m, name: l.rule.name, sourceId: l.rule.sourceId, sourceKind: l.rule.sourceKind } as const;
      ledger.post(`loan:${l.rule.accountId}:i`, { ...base, from: cash.id, to: EXTERNAL, amount: pay.interest, type: 'loan_interest', category: 'loan_interest' });
      ledger.post(`loan:${l.rule.accountId}:p`, { ...base, from: cash.id, to: l.rule.accountId, amount: pay.principal, type: 'loan_principal', category: 'loan_principal' });
    }
    // 8. 振替（積立・取崩）。生活口座以外からの振替は残高を上限とする
    for (const t of plan.transfers) {
      if (!occurs(t as TransferRuleC & { months: number[] | null }, m)) continue;
      let amount = roundYen(amountAt(t, m, ctx.inflationRate));
      if (t.fromId !== cash.id) amount = Math.min(amount, Math.max(0, ledger.balance(t.fromId)));
      if (amount <= 0) continue;
      ledger.post(`xfer:${t.key}`, {
        month: m,
        from: t.fromId,
        to: t.toId,
        amount,
        type: 'transfer',
        category: 'transfer',
        name: t.name,
        sourceId: t.sourceId,
        sourceKind: t.sourceKind,
      });
    }
    // 9. 資金不足時の自動取り崩し（預金 → 投資の順）
    if (plan.autoLiquidate && ledger.balance(cash.id) < 0) {
      const order = [...plan.accounts.filter((a) => a.kind === 'savings'), ...plan.accounts.filter((a) => a.kind === 'investment')];
      for (const a of order) {
        const need = -ledger.balance(cash.id);
        if (need <= 0) break;
        const take = Math.min(need, Math.max(0, ledger.balance(a.id)));
        if (take <= 0) continue;
        ledger.post(`liq:${a.id}`, {
          month: m,
          from: a.id,
          to: cash.id,
          amount: take,
          type: 'transfer',
          category: 'auto_liquidation',
          name: `${a.name}から自動取り崩し`,
          sourceId: a.id,
          sourceKind: 'system',
        });
      }
    }
    // 10. 期末残高の記録
    monthly.push(snapshotRow(m, plan, ledger, cash.id));
  }
  return { ledger, monthly };
}

function snapshotRow(m: MonthIndex, plan: Plan, ledger: Ledger, cashId: string): MonthlyRow {
  const balances: Record<string, number> = {};
  let financialAssets = 0;
  let realAssets = 0;
  let liabilities = 0;
  for (const a of plan.accounts) {
    const b = ledger.balance(a.id);
    balances[a.id] = b;
    if (a.kind === 'loan') liabilities += b;
    else if (FINANCIAL.includes(a.kind)) financialAssets += b;
    else realAssets += b;
  }
  const cash = ledger.balance(cashId);
  return {
    month: m,
    balances,
    cash,
    financialAssets,
    realAssets,
    liabilities,
    netWorth: financialAssets + realAssets - liabilities,
    shortfall: cash < 0,
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
}

/** シナリオを計算する。純粋関数（同じ入力から常に同じ結果） */
export function simulate(s: Scenario, opts: SimOptions = {}): SimulationResult {
  const { plan, issues } = compile(s, opts);
  if (!plan) return { ok: false, issues };
  const { ledger, monthly } = runPlan(plan, opts);
  const agg = aggregate(plan, ledger, monthly);
  const self = s.members.find((m) => m.role === 'self')!;
  return {
    ok: true,
    engineVersion: ENGINE_VERSION,
    start: plan.ctx.start,
    end: plan.ctx.end,
    selfId: self.id,
    births: Object.fromEntries(plan.ctx.births),
    accounts: plan.accounts.map((a) => ({ id: a.id, kind: a.kind, name: a.name, sourceKind: a.sourceKind })),
    monthly: agg.monthly,
    yearly: agg.yearly,
    postings: ledger.postings,
    events: plan.events,
    metrics: agg.metrics,
    issues,
  };
}
