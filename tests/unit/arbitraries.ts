// ランダムシナリオ生成器と不変条件の検査（プロパティテスト・クロスチェック用）
import fc from 'fast-check';
import type { Account, FlowItem, LifeEvent, Scenario, TransferRule } from '../../src/domain/schema';
import { formatYm } from '../../src/domain/time';
import { EXTERNAL, type SimulationResult } from '../../src/engine';

const ymArb = (minY: number, maxY: number) => fc.tuple(fc.integer({ min: minY, max: maxY }), fc.integer({ min: 1, max: 12 })).map(([y, m]) => formatYm(y * 12 + m - 1));
const rateArb = fc.oneof(fc.constant(0), fc.double({ min: -0.1, max: 0.12, noNaN: true }).map((x) => Math.round(x * 10000) / 10000));
const growthArb = fc.oneof(
  fc.constant({ type: 'none' as const }),
  fc.constant({ type: 'inflation' as const }),
  rateArb.map((rate) => ({ type: 'fixed' as const, rate })),
);
const triggerArb = fc.oneof(fc.constant(null), ymArb(2026, 2060).map((ym) => ({ type: 'date' as const, ym })));

const flowArb = (i: number) =>
  fc.record({
    direction: fc.constantFrom('income' as const, 'expense' as const),
    amount: fc.integer({ min: 0, max: 5_000_000 }),
    frequency: fc.constantFrom('monthly' as const, 'months' as const),
    months: fc.uniqueArray(fc.integer({ min: 1, max: 12 }), { minLength: 1, maxLength: 4 }),
    start: triggerArb,
    end: triggerArb,
    growth: growthArb,
    growthBase: fc.constantFrom('start' as const, 'itemStart' as const),
    growthStepMonth: fc.integer({ min: 1, max: 12 }),
    netRatio: fc.option(fc.constantFrom(0.75, 0.8, 0.83), { nil: undefined }),
  }).map(
    (f): FlowItem => ({
      id: `f${i}`,
      name: `f${i}`,
      category: f.direction === 'income' ? 'salary' : 'living',
      ...f,
      months: f.frequency === 'months' ? f.months : undefined,
      netRatio: f.direction === 'income' ? f.netRatio : undefined,
    }),
  );

const loanTermsArb = fc.record({
  annualRate: fc.constantFrom(0, 0.005, 0.012, 0.029),
  termMonths: fc.integer({ min: 1, max: 420 }),
  method: fc.constantFrom('equal_payment' as const, 'equal_principal' as const),
  rateChanges: fc.boolean().map((b) => (b ? [{ afterMonths: 36, annualRate: 0.02 }] : [])),
});

/** ランダムな人生イベント（終了指定は直前のイベント・収支を対象にする） */
const eventArb = (i: number, nFlow: number) =>
  fc
    .record({
      type: fc.constantFrom('one_time', 'rent', 'home_purchase', 'car', 'pension', 'retirement', 'flow_change'),
      ym: ymArb(2026, 2055),
      age: fc.integer({ min: 40, max: 75 }),
      amount: fc.integer({ min: 0, max: 3_000_000 }),
      price: fc.integer({ min: 0, max: 60_000_000 }),
      downRatio: fc.double({ min: 0, max: 1, noNaN: true }),
      loan: loanTermsArb,
      useLoan: fc.boolean(),
      growth: growthArb,
      rate: rateArb,
      cycle: fc.integer({ min: 0, max: 10 }),
      count: fc.integer({ min: 1, max: 4 }),
      hold: fc.option(ymArb(2030, 2070), { nil: null }),
      enabled: fc.boolean(),
      ends: fc.boolean(),
    })
    .map((p): LifeEvent => {
      const common = {
        id: `e${i}`,
        name: `e${i}`,
        enabled: p.enabled || i % 2 === 0,
        trigger: p.type === 'pension' || p.type === 'retirement' ? { type: 'age' as const, memberId: 'self', age: p.age } : { type: 'date' as const, ym: p.ym },
        endsIds: p.ends ? (i > 0 ? [`e${i - 1}`] : nFlow > 0 ? ['f0'] : []) : [],
      };
      const g = p.growth.type === 'fixed' ? { type: 'none' as const } : p.growth;
      const down = Math.floor(p.price * p.downRatio);
      switch (p.type) {
        case 'one_time':
          return { ...common, type: 'one_time', params: { direction: p.amount % 2 ? 'income' : 'expense', amount: p.amount, category: 'leisure', growth: g } };
        case 'rent':
          return { ...common, type: 'rent', params: { monthlyRent: Math.floor(p.amount / 10), renewalFee: Math.floor(p.amount / 10), renewalIntervalYears: p.cycle % 3, initialCost: p.amount, growth: p.growth, end: p.hold ? { type: 'date', ym: p.hold } : null } };
        case 'home_purchase':
          return {
            ...common,
            type: 'home_purchase',
            params: { price: p.price, downPayment: down, closingCosts: Math.floor(p.price / 20), loan: p.loan, propertyTaxYearly: Math.floor(p.price / 300), maintenanceMonthly: Math.floor(p.amount / 100), maintenanceGrowth: p.growth, revaluationRate: p.rate },
          };
        case 'car':
          return {
            ...common,
            type: 'car',
            params: { price: Math.floor(p.price / 10), priceGrowth: g, downPayment: Math.floor(down / 10), loan: p.useLoan ? p.loan : null, cycleYears: p.cycle, purchaseCount: p.count, maintenanceYearly: p.amount / 5 > 0 ? Math.floor(p.amount / 5) : 0, maintenanceGrowth: p.growth, depreciationRate: -Math.abs(p.rate), holdUntil: p.hold ? { type: 'date', ym: p.hold } : null },
          };
        case 'pension':
          return { ...common, type: 'pension', params: { memberId: 'self', annualAmount: p.amount, slideRate: Math.abs(p.rate) / 10, claimAdjustment: p.useLoan } };
        case 'retirement':
          return { ...common, type: 'retirement', params: { severance: p.price, flows: [] } };
        default:
          return {
            ...common,
            type: 'flow_change',
            params: { flows: [{ key: 'x', direction: 'expense', name: 'x', category: 'living', amount: Math.floor(p.amount / 10), frequency: 'monthly', end: p.hold ? { type: 'date', ym: p.hold } : null, growth: p.growth, growthBase: 'itemStart', growthStepMonth: 4 }] },
          };
      }
    });

const accountArb = (i: number) =>
  fc
    .record({
      kind: fc.constantFrom('savings' as const, 'investment' as const, 'property' as const, 'other_asset' as const, 'loan' as const),
      openingBalance: fc.integer({ min: 0, max: 50_000_000 }),
      annualRate: rateArb,
      remainingMonths: fc.integer({ min: 1, max: 400 }),
      method: fc.constantFrom('equal_payment' as const, 'equal_principal' as const),
      feeRate: fc.constantFrom(0, 0.001, 0.0093),
    })
    .map(
      (a): Account => ({
        id: `a${i}`,
        name: `a${i}`,
        kind: a.kind,
        openingBalance: a.openingBalance,
        annualRate: a.kind === 'loan' ? Math.abs(a.annualRate) : a.annualRate,
        ...(a.kind === 'investment' && a.feeRate > 0 ? { feeRate: a.feeRate } : {}),
        ...(a.kind === 'loan' ? { loan: { remainingMonths: a.remainingMonths, method: a.method } } : {}),
      }),
    );

export const scenarioArb: fc.Arbitrary<Scenario> = fc
  .record({
    birthYear: fc.integer({ min: 1950, max: 2005 }),
    years: fc.integer({ min: 1, max: 40 }),
    inflation: rateArb,
    autoLiquidate: fc.boolean(),
    cash: fc.integer({ min: 0, max: 10_000_000 }),
    cashRate: fc.constantFrom(0, 0.001, 0.02),
    nAcc: fc.integer({ min: 0, max: 4 }),
    nFlow: fc.integer({ min: 0, max: 6 }),
    nXfer: fc.integer({ min: 0, max: 3 }),
    nEvt: fc.integer({ min: 0, max: 4 }),
    seed: fc.integer(),
  })
  .chain((p) =>
    fc
      .tuple(
        fc.tuple(...Array.from({ length: p.nAcc }, (_, i) => accountArb(i))),
        fc.tuple(...Array.from({ length: p.nFlow }, (_, i) => flowArb(i))),
        fc.array(fc.record({ from: fc.nat(), to: fc.nat(), amount: fc.integer({ min: 0, max: 2_000_000 }), start: triggerArb, end: triggerArb, growth: growthArb }), {
          minLength: p.nXfer,
          maxLength: p.nXfer,
        }),
        fc.tuple(...Array.from({ length: p.nEvt }, (_, i) => eventArb(i, p.nFlow))),
      )
      .map(([accts, flows, xfers, events]) => {
        const accounts: Account[] = [{ id: 'cash', kind: 'cash', name: 'cash', openingBalance: p.cash, annualRate: p.cashRate }, ...accts];
        const transferable = accounts.filter((a) => ['cash', 'savings', 'investment', 'other_asset'].includes(a.kind));
        const transfers: TransferRule[] = [];
        if (transferable.length >= 2) {
          xfers.forEach((x, i) => {
            const from = transferable[x.from % transferable.length]!;
            const to = transferable[(x.from + 1 + (x.to % (transferable.length - 1))) % transferable.length]!;
            transfers.push({
              id: `t${i}`,
              name: `t${i}`,
              fromId: from.id,
              toId: to.id,
              amount: x.amount,
              frequency: 'monthly',
              start: x.start,
              end: x.end,
              growth: x.growth,
              growthBase: 'start',
              growthStepMonth: 1,
            });
          });
        }
        const startYear = 2027;
        const age = startYear - p.birthYear;
        return {
          id: 'p',
          name: 'p',
          createdAt: '',
          updatedAt: '',
          assumptions: { startYm: '2027-01', endAge: Math.min(110, age + p.years), inflationRate: p.inflation, defaultReturnRate: 0.03, autoLiquidate: p.autoLiquidate },
          members: [{ id: 'self', role: 'self' as const, name: '本人', birthYm: `${p.birthYear}-06` }],
          accounts,
          flows,
          transfers,
          events,
        };
      }),
  );

/** 全不変条件を検査する。違反があればメッセージを返す */
export function checkInvariants(r: Extract<SimulationResult, { ok: true }>): string[] {
  const errs: string[] = [];
  const kinds = new Map(r.accounts.map((a) => [a.id, a.kind]));
  // 仕訳: 正の整数、0 円なし
  for (const p of r.postings) if (!Number.isSafeInteger(p.amount) || p.amount <= 0) errs.push(`仕訳金額が不正: ${p.amount}`);
  // 口座残高恒等式: 各月の期末 = 前月末 + 流入 − 流出（符号付き）
  const byMonth = new Map<number, typeof r.postings>();
  for (const p of r.postings) (byMonth.get(p.month) ?? byMonth.set(p.month, []).get(p.month)!).push(p);
  const signed = (id: string, v: number) => (kinds.get(id) === 'loan' ? -v : v);
  let prevBal: Record<string, number> = r.yearly[0]!.opening.balances;
  for (const row of r.monthly) {
    const delta: Record<string, number> = {};
    for (const p of byMonth.get(row.month) ?? []) {
      if (p.from !== EXTERNAL) delta[p.from] = (delta[p.from] ?? 0) - p.amount;
      if (p.to !== EXTERNAL) delta[p.to] = (delta[p.to] ?? 0) + p.amount;
    }
    for (const id of Object.keys(row.balances)) {
      const expected = signed(id, prevBal[id] ?? 0) + (delta[id] ?? 0);
      if (signed(id, row.balances[id]!) !== expected) errs.push(`${formatYm(row.month)} ${id}: 残高恒等式違反`);
    }
    // 純資産の月次変化 = 収入 − 支出 + 運用損益 + 評価損益
    // 非負: 投資・実物資産・負債
    for (const [id, b] of Object.entries(row.balances)) {
      const k = kinds.get(id);
      if (k !== 'cash' && b < 0) errs.push(`${formatYm(row.month)} ${id}(${k}) が負: ${b}`);
    }
    prevBal = row.balances;
  }
  for (let i = 0; i < r.monthly.length; i++) {
    const prevNw = i === 0 ? r.metrics.startNetWorth : r.monthly[i - 1]!.netWorth;
    const b = r.monthly[i]!;
    if (prevNw + b.income - b.expense + b.investmentReturn + b.revaluation !== b.netWorth) errs.push(`${formatYm(b.month)}: 純資産恒等式違反`);
  }
  // 年次 = 月次の合計（フロー）、年末月の残高（ストック）
  for (const y of r.yearly) {
    const ms = r.monthly.filter((m) => m.month >= y.firstMonth && m.month <= y.lastMonth);
    const sum = (k: 'income' | 'expense' | 'investmentReturn' | 'revaluation' | 'loanPrincipal') => ms.reduce((a, m) => a + m[k], 0);
    for (const k of ['income', 'expense', 'investmentReturn', 'revaluation', 'loanPrincipal'] as const) if (sum(k) !== y[k]) errs.push(`${y.year} ${k} の年次集計違反`);
    if (y.netWorth !== ms[ms.length - 1]!.netWorth) errs.push(`${y.year} 年末残高違反`);
    if (y.reconciliationError !== 0) errs.push(`${y.year} 照合差 ${y.reconciliationError}`);
    if (y.financialAssets + y.realAssets - y.liabilities !== y.netWorth) errs.push(`${y.year} 純資産の定義違反`);
  }
  return errs;
}

