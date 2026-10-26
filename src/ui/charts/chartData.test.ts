import { describe, expect, it } from 'vitest';
import { account, flow, scenario } from '../../../tests/unit/fixtures';
import { simulate } from '../../engine';
import { assetRows, compareRows, monthlyCashflow, yearlyCashflow } from './chartData';

const s = scenario({
  assumptions: { ...scenario().assumptions, endAge: 45, inflationRate: 0.02 },
  accounts: [
    account({ id: 'cash', kind: 'cash', openingBalance: 1000000 }),
    account({ id: 'inv', kind: 'investment', openingBalance: 2000000, annualRate: 0.05 }),
    account({ id: 'home', kind: 'property', openingBalance: 30000000, annualRate: -0.01 }),
    account({ id: 'loan', kind: 'loan', openingBalance: 20000000, annualRate: 0.01, loan: { remainingMonths: 240, method: 'equal_payment' } }),
  ],
  flows: [flow({ id: 'in', amount: 400000 }), flow({ id: 'out', direction: 'expense', amount: 250000, growth: { type: 'inflation' } })],
});
const r = simulate(s);
if (!r.ok) throw new Error('setup');

describe('グラフと数値表の一致', () => {
  it('資産グラフの各年: 内訳の合計 = 年次表の純資産、負債は年次表の負債（符号反転）', () => {
    const rows = assetRows(r);
    expect(rows.map((x) => x.year)).toEqual(r.yearly.map((y) => y.year));
    rows.forEach((row, i) => {
      const y = r.yearly[i]!;
      expect(row.netWorth).toBe(y.netWorth);
      expect(row.cash + row.savings + row.investment).toBe(y.financialAssets);
      expect(row.property + row.vehicle + row.other_asset).toBe(y.realAssets);
      expect(-row.loan).toBe(y.liabilities);
      expect(row.cash + row.savings + row.investment + row.property + row.vehicle + row.other_asset + row.loan).toBe(y.netWorth);
    });
  });
  it('収支グラフ（年次）= 年次表の収入・支出・収支', () => {
    yearlyCashflow(r).forEach((row, i) => {
      const y = r.yearly[i]!;
      expect(row.income).toBe(y.income);
      expect(-row.expense).toBe(y.expense);
      expect(row.net).toBe(y.netIncome);
    });
  });
  it('収支グラフ（月次）の 12 か月の合計 = その年の年次値', () => {
    const y = r.yearly[1]!;
    const m = monthlyCashflow(r, y.year);
    expect(m).toHaveLength(12);
    expect(m.reduce((a, x) => a + x.income, 0)).toBe(y.income);
    expect(-m.reduce((a, x) => a + x.expense, 0)).toBe(y.expense);
  });
  it('比較データは暦年でそろえ、期間外は null', () => {
    const shorter = simulate({ ...s, assumptions: { ...s.assumptions, endAge: 40 } });
    if (!shorter.ok) throw new Error('setup');
    const rows = compareRows(
      [
        { id: 'a', result: r },
        { id: 'b', result: shorter },
      ],
      'netWorth',
    );
    expect(rows[0]!.a).toBe(r.yearly[0]!.netWorth);
    expect(rows[0]!.b).toBe(shorter.yearly[0]!.netWorth);
    expect(rows.at(-1)!.b).toBeNull();
    expect(rows.at(-1)!.a).toBe(r.yearly.at(-1)!.netWorth);
  });
});
