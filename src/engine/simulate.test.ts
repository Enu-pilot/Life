import { describe, expect, it } from 'vitest';
import { account, flow, scenario } from '../../tests/unit/fixtures';
import { floorYen, roundYen } from '../domain/money';
import type { Scenario } from '../domain/schema';
import { formatYm, parseYm } from '../domain/time';
import { equalPayment, LoanState } from './loan';
import { growthSteps, simulate } from './simulate';

/** 本人 1990-01 生まれ、2027-01 開始。endAge 38 → 終了 2028-01（13 か月） */
const short = (over: Partial<Scenario> = {}) => scenario({ assumptions: { ...scenario().assumptions, endAge: 38 }, ...over });

function ok(s: Scenario) {
  const r = simulate(s);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r;
}

const at = (r: ReturnType<typeof ok>, ym: string) => r.monthly.find((x) => x.month === parseYm(ym))!;

describe('必須検証', () => {
  it('収入も支出もない場合: 残高は変わらず、警告を出す', () => {
    const r = ok(short({ accounts: [account({ id: 'cash', kind: 'cash', openingBalance: 500000 })] }));
    expect(r.monthly).toHaveLength(13);
    expect(r.monthly.every((m) => m.cash === 500000 && m.netWorth === 500000)).toBe(true);
    expect(r.metrics.lifetimeIncome).toBe(0);
    expect(r.metrics.lifetimeExpense).toBe(0);
    expect(r.issues.some((i) => i.code === 'NO_FLOWS')).toBe(true);
  });

  it('収入が支出を上回る場合（初期資産ゼロ）: 毎月 +100,000 円', () => {
    const r = ok(
      short({
        flows: [flow({ id: 'in', amount: 300000 }), flow({ id: 'out', direction: 'expense', amount: 200000 })],
      }),
    );
    // 13 か月 × 100,000 = 1,300,000
    expect(r.monthly[0]!.cash).toBe(100000);
    expect(r.monthly[12]!.cash).toBe(1300000);
    expect(r.yearly.map((y) => [y.year, y.income, y.expense, y.netIncome, y.cash])).toEqual([
      [2027, 3600000, 2400000, 1200000, 1200000],
      [2028, 300000, 200000, 100000, 1300000],
    ]);
    expect(r.metrics.shortfall.firstMonth).toBeNull();
  });

  it('支出が収入を上回る場合: 資金不足の初回月・最大額・月数', () => {
    const r = ok(
      short({
        accounts: [account({ id: 'cash', kind: 'cash', openingBalance: 100000 })],
        flows: [flow({ id: 'in', amount: 200000 }), flow({ id: 'out', direction: 'expense', amount: 250000 })],
      }),
    );
    // 2027-01: 50,000 / 02: 0 / 03: -50,000 … 2028-01: 100,000 - 13×50,000 = -550,000
    expect(at(r, '2027-02').cash).toBe(0);
    expect(at(r, '2027-02').shortfall).toBe(false);
    expect(formatYm(r.metrics.shortfall.firstMonth!)).toBe('2027-03');
    expect(r.metrics.shortfall.months).toBe(11);
    expect(r.metrics.shortfall.maxAmount).toBe(550000);
    expect(r.metrics.minCash).toEqual({ amount: -550000, month: parseYm('2028-01') });
    expect(r.yearly[0]!.shortfallMonths).toBe(10);
  });

  it('収入・支出が途中で変わる場合: 6 月まで 30 万、7 月から 35 万', () => {
    const r = ok(
      short({
        flows: [
          flow({ id: 'a', amount: 300000, end: { type: 'date', ym: '2027-06' } }),
          flow({ id: 'b', amount: 350000, start: { type: 'date', ym: '2027-07' } }),
        ],
      }),
    );
    expect(at(r, '2027-06').cash).toBe(1800000);
    expect(at(r, '2027-07').cash).toBe(2150000);
    // 6×300,000 + 6×350,000 = 3,900,000
    expect(r.yearly[0]!.income).toBe(3900000);
    expect(r.yearly[1]!.income).toBe(350000);
  });

  it('長期間（110 年 = 1,320 か月）でも計算でき、恒等式が保たれる', () => {
    const s = scenario({
      members: [{ id: 'self', role: 'self', name: '本人', birthYm: '2026-12' }],
      assumptions: { ...scenario().assumptions, endAge: 110 },
      accounts: [account({ id: 'cash', kind: 'cash' }), account({ id: 'inv', kind: 'investment', openingBalance: 1000000, annualRate: 0.03 })],
      flows: [flow({ id: 'one', amount: 1 })],
    });
    const t0 = performance.now();
    const r = ok(s);
    const ms = performance.now() - t0;
    // 2027-01 〜 2136-12（2026-12 + 110 年 = 2136-12 を含む）
    expect(r.monthly).toHaveLength(1321 - 1);
    expect(formatYm(r.end)).toBe('2136-12');
    expect(r.metrics.lifetimeIncome).toBe(1320);
    expect(r.yearly.every((y) => y.reconciliationError === 0)).toBe(true);
    expect(ms).toBeLessThan(500); // 性能要件 50ms は Phase 6 で計測（テスト環境の揺れを考慮した上限）
  });

  it('月末・年末の境界: 12 月と 1 月は別の年に集計、終了月を含む', () => {
    const r = ok(short({ flows: [flow({ id: 'x', amount: 1000, start: { type: 'date', ym: '2027-12' }, end: { type: 'date', ym: '2028-01' } })] }));
    expect(r.yearly[0]!.income).toBe(1000);
    expect(r.yearly[1]!.income).toBe(1000);
    expect(at(r, '2027-11').cash).toBe(0);
    expect(r.yearly[0]!.lastMonth).toBe(parseYm('2027-12'));
    expect(r.yearly[1]!.firstMonth).toBe(parseYm('2028-01'));
  });

  it('年齢による終了: 「60歳になる前月まで」と「60歳の間も含む」は 12 か月違う', () => {
    const base = scenario({ assumptions: { ...scenario().assumptions, endAge: 65 } });
    const before = ok({ ...base, flows: [flow({ id: 's', amount: 1, end: { type: 'age', memberId: 'self', age: 60, endMode: 'before' } })] });
    const through = ok({ ...base, flows: [flow({ id: 's', amount: 1, end: { type: 'age', memberId: 'self', age: 60, endMode: 'through' } })] });
    // 1990-01 生まれ: before は 2049-12 まで、through は 2050-12 まで。開始 2027-01 から 276 か月 / 288 か月
    expect(before.metrics.lifetimeIncome).toBe(276);
    expect(through.metrics.lifetimeIncome).toBe(288);
    const lastBefore = before.postings.filter((p) => p.sourceId === 's').at(-1)!;
    expect(formatYm(lastBefore.month)).toBe('2049-12');
  });

  it('年次表の年齢は 12 月時点', () => {
    const r = ok(short({ members: [{ id: 'self', role: 'self', name: '本人', birthYm: '1990-05' }], assumptions: { ...scenario().assumptions, endAge: 38 } }));
    expect(r.yearly[0]!.ages.self).toBe(37); // 2027-12 時点
  });

  it('同じ入力から同じ結果が得られる（決定性）。入力配列の順序を変えても年次結果は同じ', () => {
    const s = scenario({
      accounts: [account({ id: 'cash', kind: 'cash', openingBalance: 100 }), account({ id: 'inv', kind: 'investment', openingBalance: 1234567, annualRate: 0.0437 })],
      flows: [flow({ id: 'a', amount: 333333, growth: { type: 'fixed', rate: 0.017 } }), flow({ id: 'b', direction: 'expense', amount: 211111, growth: { type: 'inflation' } })],
      assumptions: { ...scenario().assumptions, inflationRate: 0.013 },
    });
    expect(simulate(s)).toEqual(simulate(structuredClone(s)));
    const reordered = { ...s, flows: [...s.flows].reverse() };
    const a = simulate(s);
    const b = simulate(reordered);
    expect(a.ok && b.ok && a.yearly.map((y) => y.netWorth)).toEqual(b.ok && b.yearly.map((y) => y.netWorth));
  });
});

describe('金額の丸めと浮動小数点誤差', () => {
  it('100 × 1.005 は倍精度では 100.49999… だが、101 円に丸める', () => {
    expect(100 * 1.005).toBeLessThan(100.5); // 前提: 浮動小数の表現誤差
    expect(roundYen(100 * 1.005)).toBe(101);
    const r = ok(
      short({
        flows: [flow({ id: 'x', amount: 100, growth: { type: 'fixed', rate: 0.005 }, growthStepMonth: 2 })],
      }),
    );
    expect(at(r, '2027-01').income).toBe(100);
    expect(at(r, '2027-02').income).toBe(101); // 100 × 1.005 = 100.5 → 101
  });
  it('30,000,000 × (1.2% ÷ 12) の利息は 30,000 円（29,999 にならない）', () => {
    expect(floorYen(30000000 * (0.012 / 12))).toBe(30000);
  });
  it('上昇率は前年の丸め後金額ではなく元の金額から計算する（誤差が累積しない）', () => {
    // 期待値は Python Decimal（40 桁）で独立計算:
    //   n=2:  333,333 × 1.015^2  = 343,407.989925       → 343,408
    //   n=10: 333,333 × 1.015^10 = 386,846.5548281…     → 386,847
    // 前年の丸め後金額に毎年 1.015 を掛けると n=10 で 386,845 になり、2 円ずれる（誤差の累積）
    const s = scenario({
      assumptions: { ...scenario().assumptions, endAge: 48 },
      flows: [flow({ id: 'x', amount: 333333, growth: { type: 'fixed', rate: 0.015 }, growthStepMonth: 1 })],
    });
    const r = ok(s);
    expect(at(r, '2029-01').income).toBe(343408);
    expect(at(r, '2037-01').income).toBe(386847);
  });
  it('1,000,000 円を年 3%（幾何月次換算）で 12 か月運用すると 1,030,000 円（Python Decimal で独立計算）', () => {
    const r = ok(short({ accounts: [account({ id: 'cash', kind: 'cash' }), account({ id: 'inv', kind: 'investment', openingBalance: 1000000, annualRate: 0.03 })] }));
    expect(at(r, '2027-12').balances.inv).toBe(1030000);
  });
  it('当月の入金には当月の運用益が付かない', () => {
    const s = short({
      accounts: [account({ id: 'cash', kind: 'cash', openingBalance: 100000 }), account({ id: 'inv', kind: 'investment', annualRate: 0.12 })],
      transfers: [
        {
          id: 't',
          name: '積立',
          fromId: 'cash',
          toId: 'inv',
          amount: 100000,
          frequency: 'months',
          months: [1],
          start: null,
          end: null,
          growth: { type: 'none' },
          growthBase: 'start',
          growthStepMonth: 1,
        },
      ],
    });
    const r = ok(s);
    expect(at(r, '2027-01').investmentReturn).toBe(0);
    expect(at(r, '2027-01').balances.inv).toBe(100000);
    // 2 月: 100,000 × ((1.12)^(1/12) − 1) = 948.879… → 949
    expect(at(r, '2027-02').investmentReturn).toBe(949);
  });
  it('負の利回りでも残高はマイナスにならない', () => {
    const r = ok(short({ accounts: [account({ id: 'cash', kind: 'cash' }), account({ id: 'inv', kind: 'investment', openingBalance: 1000, annualRate: -0.5 })] }));
    expect(r.monthly.every((m) => (m.balances.inv ?? 0) >= 0)).toBe(true);
    expect(at(r, '2028-01').balances.inv).toBeLessThan(1000);
  });
  it('マイナスの生活口座には利息を付けない', () => {
    const r = ok(
      short({
        accounts: [account({ id: 'cash', kind: 'cash', annualRate: 0.1 })],
        flows: [flow({ id: 'o', direction: 'expense', amount: 1000 })],
      }),
    );
    expect(r.monthly.every((m) => m.investmentReturn === 0)).toBe(true);
    expect(r.monthly[12]!.cash).toBe(-13000);
  });
});

describe('上昇率の適用回数', () => {
  it('開始 2027-01、4 月適用: 2027-03 は 0 回、2027-04 は 1 回、2028-04 は 2 回', () => {
    const b = parseYm('2027-01');
    expect(growthSteps(b, parseYm('2027-03'), 4)).toBe(0);
    expect(growthSteps(b, parseYm('2027-04'), 4)).toBe(1);
    expect(growthSteps(b, parseYm('2028-03'), 4)).toBe(1);
    expect(growthSteps(b, parseYm('2028-04'), 4)).toBe(2);
  });
  it('基準月と適用月が同じなら翌年から', () => {
    expect(growthSteps(parseYm('2027-04'), parseYm('2027-04'), 4)).toBe(0);
    expect(growthSteps(parseYm('2027-04'), parseYm('2028-04'), 4)).toBe(1);
  });
  it('月額 300,000・年 2%・4 月適用: 2027-03=300,000 / 2027-04=306,000 / 2028-04=312,120', () => {
    const r = ok(
      scenario({
        assumptions: { ...scenario().assumptions, endAge: 40 },
        flows: [flow({ id: 's', amount: 300000, growth: { type: 'fixed', rate: 0.02 }, growthStepMonth: 4 })],
      }),
    );
    expect(at(r, '2027-03').income).toBe(300000);
    expect(at(r, '2027-04').income).toBe(306000);
    expect(at(r, '2028-04').income).toBe(312120);
  });
  it('賞与（6・12 月）は 2027-01〜2029-12 で 6 回', () => {
    const r = ok(
      scenario({
        assumptions: { ...scenario().assumptions, endAge: 45 },
        flows: [flow({ id: 'b', amount: 1, frequency: 'months', months: [6, 12], end: { type: 'date', ym: '2029-12' } })],
      }),
    );
    expect(r.metrics.lifetimeIncome).toBe(6);
  });
});

describe('ローン（元利均等・元金均等）', () => {
  it('3,000 万円・年 1.2%・420 回（Python Decimal で独立計算した値）', () => {
    expect(equalPayment(30000000, 0.012, 420)).toBe(87510);
    const st = new LoanState({
      accountId: 'l',
      name: 'l',
      sourceId: 'l',
      sourceKind: 'account',
      firstPayment: 0,
      termMonths: 420,
      method: 'equal_payment',
      annualRate: 0.012,
      rateChanges: [],
    });
    let bal = 30000000;
    let totalInterest = 0;
    let first: { interest: number; principal: number } | null = null;
    let last = 0;
    for (let m = 0; m < 420; m++) {
      const p = st.nextPayment(m, bal)!;
      if (m === 0) first = p;
      totalInterest += p.interest;
      bal -= p.principal;
      if (m === 419) last = p.interest + p.principal;
    }
    expect(first).toEqual({ interest: 30000, principal: 57510 });
    expect(last).toBe(87611);
    expect(totalInterest).toBe(6754301);
    expect(bal).toBe(0);
    expect(st.nextPayment(420, 0)).toBeNull();
  });
  it('金利 0%: 返済額 = 借入額 / 回数、端数は最終回', () => {
    expect(equalPayment(1000, 0, 3)).toBe(333);
    const st = new LoanState({ accountId: 'l', name: 'l', sourceId: 'l', sourceKind: 'account', firstPayment: 0, termMonths: 3, method: 'equal_payment', annualRate: 0, rateChanges: [] });
    expect([st.nextPayment(0, 1000), st.nextPayment(1, 667), st.nextPayment(2, 334)]).toEqual([
      { interest: 0, principal: 333 },
      { interest: 0, principal: 333 },
      { interest: 0, principal: 334 },
    ]);
  });
  it('1 回払い', () => {
    const st = new LoanState({ accountId: 'l', name: 'l', sourceId: 'l', sourceKind: 'account', firstPayment: 0, termMonths: 1, method: 'equal_payment', annualRate: 0.12, rateChanges: [] });
    expect(st.nextPayment(0, 10000)).toEqual({ interest: 100, principal: 10000 });
  });
  it('元金均等: 元本は floor(1,000,000/3)=333,333、利息は残高×月利', () => {
    const st = new LoanState({ accountId: 'l', name: 'l', sourceId: 'l', sourceKind: 'account', firstPayment: 0, termMonths: 3, method: 'equal_principal', annualRate: 0.12, rateChanges: [] });
    expect(st.nextPayment(0, 1000000)).toEqual({ interest: 10000, principal: 333333 });
    expect(st.nextPayment(1, 666667)).toEqual({ interest: 6666, principal: 333333 });
    expect(st.nextPayment(2, 333334)).toEqual({ interest: 3333, principal: 333334 });
  });
  it('金利変更月に残高と残り回数から返済額を再計算する', () => {
    // 120,000 円・12 回・0% → 10,000/月。6 回返済後（残高 60,000・残り 6 回）に年 12% へ変更:
    // P = floor(60,000 × 0.01 / (1 − 1.01^−6)) = floor(10,352.903…) = 10,352
    const st = new LoanState({
      accountId: 'l',
      name: 'l',
      sourceId: 'l',
      sourceKind: 'account',
      firstPayment: 0,
      termMonths: 12,
      method: 'equal_payment',
      annualRate: 0,
      rateChanges: [{ month: 6, annualRate: 0.12 }],
    });
    let bal = 120000;
    for (let m = 0; m < 6; m++) bal -= st.nextPayment(m, bal)!.principal;
    expect(bal).toBe(60000);
    const p = st.nextPayment(6, bal)!;
    expect(p.interest).toBe(600);
    expect(p.interest + p.principal).toBe(10352);
  });
  it('既存ローン（負債口座）は開始月から返済し、利息は支出、元本は支出に含めない', () => {
    const r = ok(
      short({
        accounts: [
          account({ id: 'cash', kind: 'cash', openingBalance: 1000000 }),
          account({ id: 'loan', kind: 'loan', openingBalance: 120000, annualRate: 0, loan: { remainingMonths: 12, method: 'equal_payment' } }),
        ],
      }),
    );
    expect(r.yearly[0]!.expense).toBe(0);
    expect(r.yearly[0]!.loanPrincipal).toBe(120000);
    expect(r.yearly[0]!.liabilities).toBe(0);
    expect(r.yearly[0]!.cash).toBe(880000);
    // 純資産は不変（1,000,000 − 120,000 = 880,000）
    expect(r.metrics.startNetWorth).toBe(880000);
    expect(r.yearly[0]!.netWorth).toBe(880000);
    expect(formatYm(r.metrics.loanPayoff[0]!.month!)).toBe('2027-12');
  });
});

describe('資金不足の自動取り崩し', () => {
  const base = (auto: boolean) =>
    short({
      assumptions: { ...scenario().assumptions, endAge: 38, autoLiquidate: auto },
      accounts: [account({ id: 'cash', kind: 'cash' }), account({ id: 'sav', kind: 'savings', openingBalance: 150000 }), account({ id: 'inv', kind: 'investment', openingBalance: 1000000 })],
      flows: [flow({ id: 'o', direction: 'expense', amount: 100000 })],
    });
  it('OFF: 生活口座がマイナスのまま', () => {
    const r = ok(base(false));
    expect(r.monthly[0]!.cash).toBe(-100000);
    expect(r.metrics.shortfall.months).toBe(13);
  });
  it('ON: 預金 → 投資の順に補填し、取り崩し額を記録', () => {
    const r = ok(base(true));
    expect(r.monthly[0]!.cash).toBe(0);
    expect(r.monthly[0]!.balances.sav).toBe(50000);
    expect(r.monthly[1]!.balances.sav).toBe(0);
    expect(r.monthly[1]!.balances.inv).toBe(950000);
    expect(r.monthly[1]!.autoLiquidation).toBe(100000);
    // 預金・投資の合計 1,150,000 で補填できるのは 11 か月分（1,100,000）。
    // 12 か月目は残り 50,000 しか補填できず −50,000、13 か月目は −150,000 → 不足は 2 か月
    expect(r.monthly[10]!.cash).toBe(0);
    expect(r.monthly[11]!.cash).toBe(-50000);
    expect(r.metrics.shortfall.months).toBe(2);
    const last = r.monthly[12]!;
    expect(last.balances.inv).toBe(0);
    expect(last.cash).toBe(-150000);
  });
});

describe('検証エラー', () => {
  it('本人がいなければ計算しない', () => {
    const r = simulate(scenario({ members: [] }));
    expect(r.ok).toBe(false);
    expect(r.issues[0]!.code).toBe('NO_SELF');
  });
  it('終了年齢が開始時点の年齢以下', () => {
    const r = simulate(scenario({ assumptions: { ...scenario().assumptions, endAge: 37 } }));
    expect(!r.ok && r.issues.map((i) => i.code)).toContain('END_AGE');
  });
  it('ID の重複', () => {
    const r = simulate(scenario({ flows: [flow({ id: 'cash', amount: 1 })] }));
    expect(!r.ok && r.issues.map((i) => i.code)).toContain('DUPLICATE_ID');
  });
  it('存在しないメンバーを参照する収支は警告して除外', () => {
    const r = ok(short({ flows: [flow({ id: 'x', amount: 1, end: { type: 'age', memberId: 'ghost', age: 10 } })] }));
    expect(r.issues.map((i) => i.code)).toContain('MEMBER_UNRESOLVED');
    expect(r.metrics.lifetimeIncome).toBe(0);
  });
  it('終了が開始より前の収支は警告', () => {
    const r = ok(short({ flows: [flow({ id: 'x', amount: 1, start: { type: 'date', ym: '2027-05' }, end: { type: 'date', ym: '2027-04' } })] }));
    expect(r.issues.map((i) => i.code)).toContain('EMPTY_PERIOD');
  });
});

describe('年次の説明（期首 + 収入 − 支出 + 運用損益 + 評価損益 = 期末）', () => {
  it('各年の照合差が 0', () => {
    const r = ok(
      scenario({
        assumptions: { ...scenario().assumptions, endAge: 50 },
        accounts: [
          account({ id: 'cash', kind: 'cash', openingBalance: 2000000, annualRate: 0.001 }),
          account({ id: 'inv', kind: 'investment', openingBalance: 3000000, annualRate: 0.05 }),
          account({ id: 'home', kind: 'property', openingBalance: 30000000, annualRate: -0.02 }),
          account({ id: 'mort', kind: 'loan', openingBalance: 25000000, annualRate: 0.008, loan: { remainingMonths: 300, method: 'equal_payment' } }),
        ],
        flows: [flow({ id: 'in', amount: 450000, growth: { type: 'fixed', rate: 0.02 }, growthStepMonth: 4 }), flow({ id: 'out', direction: 'expense', amount: 250000, growth: { type: 'inflation' } })],
      }),
    );
    for (const y of r.yearly) {
      expect(y.reconciliationError).toBe(0);
      expect(y.opening.netWorth + y.income - y.expense + y.investmentReturn + y.revaluation).toBe(y.netWorth);
    }
    for (let i = 1; i < r.yearly.length; i++) expect(r.yearly[i]!.opening.netWorth).toBe(r.yearly[i - 1]!.netWorth);
  });
});

import { explainYear } from './explain';

describe('年次の内訳説明', () => {
  it('純資産・生活口座ともに 期首 + 内訳 = 期末（差 0）', () => {
    const r = ok(
      scenario({
        assumptions: { ...scenario().assumptions, endAge: 45, autoLiquidate: true },
        accounts: [
          account({ id: 'cash', kind: 'cash', openingBalance: 300000 }),
          account({ id: 'sav', kind: 'savings', openingBalance: 500000, annualRate: 0.002 }),
          account({ id: 'inv', kind: 'investment', openingBalance: 1000000, annualRate: 0.04 }),
          account({ id: 'loan', kind: 'loan', openingBalance: 2000000, annualRate: 0.02, loan: { remainingMonths: 60, method: 'equal_payment' } }),
        ],
        flows: [flow({ id: 'in', amount: 250000 }), flow({ id: 'out', direction: 'expense', amount: 260000, growth: { type: 'inflation' } })],
        transfers: [
          { id: 't', name: '積立', fromId: 'cash', toId: 'inv', amount: 20000, frequency: 'monthly', start: null, end: null, growth: { type: 'none' }, growthBase: 'start', growthStepMonth: 1 },
        ],
      }),
    );
    for (const y of r.yearly) {
      const e = explainYear(r, y.year)!;
      expect(e.netWorth.error).toBe(0);
      expect(e.cash.error).toBe(0);
      const srcTotal = e.bySource.reduce((a, s) => a + s.amount, 0);
      expect(srcTotal).toBe(y.income - y.expense);
    }
    expect(explainYear(r, 1900)).toBeNull();
  });
});
