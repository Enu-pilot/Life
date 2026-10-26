// 月次ループ（calculation-spec §7）。処理順序は結果に影響するため固定する。

import { monthlyRate, roundYen } from '../domain/money';
import type { AccountKind, Scenario } from '../domain/schema';
import { calendarMonthOf, type MonthIndex } from '../domain/time';
import { amountAt, growthSteps } from './growth';
import { aggregate } from './aggregate';
import { compile } from './compile';
import { Ledger } from './ledger';
import { LoanState } from './loan';
import { EXTERNAL, type FlowRule, type MonthlyRow, type Plan, type SimOptions, type SimulationResult, type TransferRuleC } from './types';
import { ENGINE_VERSION } from './version';
import './events';

const FINANCIAL: AccountKind[] = ['cash', 'savings', 'investment'];
const REAL: AccountKind[] = ['property', 'vehicle', 'other_asset'];

function occurs(r: Pick<FlowRule, 'from' | 'to' | 'months'>, m: MonthIndex): boolean {
  if (m < r.from || m > r.to) return false;
  return r.months === null || r.months.includes(calendarMonthOf(m));
}

export { amountAt, growthSteps } from './growth';

export function runPlan(plan: Plan, opts: SimOptions = {}): { ledger: Ledger; monthly: MonthlyRow[] } {
  const { ctx } = plan;
  const kinds = new Map(plan.accounts.map((a) => [a.id, a.kind] as const));
  const ledger = new Ledger(kinds);
  for (const a of plan.accounts) ledger.open(a.id, a.opening);
  const cash = plan.accounts.find((a) => a.kind === 'cash')!;
  const returnShift = opts.returnShift ?? 0;
  const loans = plan.loans.map((l) => new LoanState(l));
  const oneTimesByMonth = new Map<MonthIndex, typeof plan.oneTimes>();
  for (const o of [...plan.oneTimes].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))) {
    const list = oneTimesByMonth.get(o.month) ?? [];
    list.push(o);
    oneTimesByMonth.set(o.month, list);
  }
  const monthly: MonthlyRow[] = [];
  // 月次の残高オブジェクトは同じキー順で作る（V8 の最適化が効きやすい）
  const balanceTemplate: Record<string, number> = Object.fromEntries(plan.accounts.map((a) => [a.id, 0]));
  const keyCache = new Map<string, string>();
  const cached = (k: string) => {
    let v = keyCache.get(k);
    if (v === undefined) keyCache.set(k, (v = k));
    return v;
  };
  const retKey = (id: string) => cached(`ret:${id}`);
  const revalKey = (id: string) => cached(`reval:${id}`);
  const loanKeyMap = new Map<string, { i: string; p: string }>();
  const loanKeys = (id: string) => {
    let v = loanKeyMap.get(id);
    if (!v) loanKeyMap.set(id, (v = { i: `loan:${id}:i`, p: `loan:${id}:p` }));
    return v;
  };
  // 事前の振り分け（性能対策）
  const incomeFlows = plan.flows.filter((f) => f.direction === 'income');
  const expenseFlows = plan.flows.filter((f) => f.direction === 'expense');
  const returnAccounts = plan.accounts
    .filter((a) => a.kind === 'cash' || a.kind === 'savings' || a.kind === 'investment')
    .map((a) => ({ a, mr: monthlyRate(a.annualRate - (a.feeRate ?? 0) + (a.kind === 'investment' ? returnShift : 0)) }))
    .filter((x) => x.mr !== 0);
  const realAccounts = plan.accounts.filter((a) => REAL.includes(a.kind) && a.annualRate !== 0).map((a) => ({ a, mr: monthlyRate(a.annualRate) }));
  // 上昇率の係数は適用回数が変わるまで同じ（累乗の計算をキャッシュ）
  const factorCache = new Map<object, { steps: number; factor: number }>();
  const amountOf = (r: FlowRule | TransferRuleC, m: MonthIndex): number => {
    const g = r.growth;
    if (g.type === 'none') return r.amount;
    const steps = growthSteps(r.growthBase, m, r.growthStepMonth);
    let c = factorCache.get(r);
    if (!c || c.steps !== steps) {
      c = { steps, factor: amountAt({ ...r, amount: 1 }, m, ctx.inflationRate) };
      factorCache.set(r, c);
    }
    return r.amount * c.factor;
  };

  // 仕訳キーはルールごとに 1 回だけ作る
  const flowKeys = new Map(plan.flows.map((f) => [f, `flow:${f.key}`] as const));
  const postFlow = (r: FlowRule, m: MonthIndex) => {
    if (!occurs(r, m)) return;
    const amount = roundYen(amountOf(r, m));
    if (amount <= 0) return;
    ledger.post(flowKeys.get(r)!, {
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
    for (const { a, mr } of returnAccounts) {
      const bal = ledger.balance(a.id);
      if (bal <= 0) continue;
      const r = roundYen(bal * mr);
      if (r === 0) continue;
      const type = a.kind === 'investment' ? 'investment_return' : 'interest';
      ledger.post(retKey(a.id), {
        month: m,
        type,
        category: type,
        name: a.name,
        sourceId: a.id,
        sourceKind: 'account',
        from: r > 0 ? EXTERNAL : a.id,
        to: r > 0 ? a.id : EXTERNAL,
        amount: r > 0 ? r : Math.min(-r, bal),
      });
    }
    // 3. 実物資産の評価変動
    for (const { a, mr } of realAccounts) {
      const bal = ledger.balance(a.id);
      if (bal <= 0) continue;
      const r = roundYen(bal * mr);
      if (r === 0) continue;
      ledger.post(revalKey(a.id), {
        month: m,
        type: 'revaluation',
        category: 'revaluation',
        name: a.name,
        sourceId: a.sourceId,
        sourceKind: a.sourceKind,
        from: r > 0 ? EXTERNAL : a.id,
        to: r > 0 ? a.id : EXTERNAL,
        amount: r > 0 ? r : Math.min(-r, bal),
      });
    }
    // 4. 収入
    for (const f of incomeFlows) postFlow(f, m);
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
    for (const f of expenseFlows) postFlow(f, m);
    // 7. ローン返済（利息は支出、元本は負債の減少）
    for (const l of loans) {
      const pay = l.nextPayment(m, ledger.balance(l.rule.accountId));
      if (!pay) continue;
      const { name, sourceId, sourceKind, accountId } = l.rule;
      ledger.post(loanKeys(accountId).i, { month: m, name, sourceId, sourceKind, from: cash.id, to: EXTERNAL, amount: pay.interest, type: 'loan_interest', category: 'loan_interest' });
      ledger.post(loanKeys(accountId).p, { month: m, name, sourceId, sourceKind, from: cash.id, to: accountId, amount: pay.principal, type: 'loan_principal', category: 'loan_principal' });
    }
    // 8. 振替（積立・取崩）。生活口座以外からの振替は残高を上限とする
    for (const t of plan.transfers) {
      if (!occurs(t as TransferRuleC & { months: number[] | null }, m)) continue;
      let amount = roundYen(amountOf(t, m));
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
    monthly.push(snapshotRow(m, plan, ledger, cash.id, balanceTemplate));
  }
  return { ledger, monthly };
}

function snapshotRow(m: MonthIndex, plan: Plan, ledger: Ledger, cashId: string, template: Record<string, number>): MonthlyRow {
  const balances: Record<string, number> = { ...template };
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
