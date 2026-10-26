import { describe, expect, it } from 'vitest';
import { checkInvariants } from '../../../tests/unit/arbitraries';
import { account, flow, scenario } from '../../../tests/unit/fixtures';
import type { LifeEvent, Scenario } from '../../domain/schema';
import { formatYm, parseYm } from '../../domain/time';
import { simulate } from '../simulate';

function ok(s: Scenario) {
  const r = simulate(s);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r;
}
const at = (r: ReturnType<typeof ok>, ym: string) => r.monthly.find((x) => x.month === parseYm(ym))!;
const date = (ym: string) => ({ type: 'date' as const, ym });
const ev = <T extends LifeEvent['type']>(id: string, type: T, trigger: LifeEvent['trigger'], params: Extract<LifeEvent, { type: T }>['params'], endsIds: string[] = []) =>
  ({ id, type, name: id, enabled: true, trigger, endsIds, params }) as Extract<LifeEvent, { type: T }>;

/** 本人 1990-01、2027-01 開始、50 歳（2040-01）まで */
const base = (over: Partial<Scenario> = {}) =>
  scenario({ assumptions: { ...scenario().assumptions, endAge: 50 }, accounts: [account({ id: 'cash', kind: 'cash', openingBalance: 5000000 })], ...over });

const home = (over: Partial<Extract<LifeEvent, { type: 'home_purchase' }>['params']> = {}) =>
  ev('home', 'home_purchase', date('2028-04'), {
    price: 10000000,
    downPayment: 2000000,
    closingCosts: 500000,
    loan: { annualRate: 0, termMonths: 80, method: 'equal_payment', rateChanges: [] },
    propertyTaxYearly: 0,
    maintenanceMonthly: 0,
    maintenanceGrowth: { type: 'none' },
    revaluationRate: 0,
    ...over,
  });

describe('住宅購入（test-strategy §5-6 の手計算例）', () => {
  const r = ok(base({ events: [home()] }));
  it('購入月: 生活口座 −250 万（頭金 200 万 + 諸費用 50 万）、不動産 +1,000 万、ローン +800 万', () => {
    const before = at(r, '2028-03');
    const m = at(r, '2028-04');
    expect(before.cash - m.cash).toBe(2500000);
    expect(m.balances['home:property']).toBe(10000000);
    expect(m.balances['home:loan']).toBe(8000000);
    expect(m.assetPurchase).toBe(2000000);
    expect(m.loanDraw).toBe(8000000);
    expect(m.expense).toBe(500000);
  });
  it('購入月の純資産の変化は諸費用（−50 万）のみ', () => {
    expect(at(r, '2028-04').netWorth - at(r, '2028-03').netWorth).toBe(-500000);
  });
  it('翌月から毎月 生活口座 −10 万・ローン −10 万。元本返済は支出に含めない。80 回で完済', () => {
    const m = at(r, '2028-05');
    expect(at(r, '2028-04').cash - m.cash).toBe(100000);
    expect(m.balances['home:loan']).toBe(7900000);
    expect(m.loanPrincipal).toBe(100000);
    expect(m.expense).toBe(0);
    expect(m.netWorth).toBe(at(r, '2028-04').netWorth);
    // 2028-05 から 80 回 → 2034-12 で完済
    expect(at(r, '2034-11').balances['home:loan']).toBe(100000);
    expect(at(r, '2034-12').balances['home:loan']).toBe(0);
    expect(formatYm(r.metrics.loanPayoff.find((l) => l.accountId === 'home:loan')!.month!)).toBe('2034-12');
    expect(at(r, '2035-01').loanPrincipal).toBe(0);
  });
  it('固定資産税は購入翌年から毎年 4 月、管理費は購入月から毎月', () => {
    const r2 = ok(base({ events: [home({ propertyTaxYearly: 120000, maintenanceMonthly: 20000 })] }));
    expect(at(r2, '2028-04').expense).toBe(500000 + 20000);
    expect(at(r2, '2029-03').expense).toBe(20000);
    expect(at(r2, '2029-04').expense).toBe(20000 + 120000);
    expect(r2.yearly.find((y) => y.year === 2028)!.byCategory.housing).toBe(-(500000 + 9 * 20000));
  });
  it('金利ありのローンは利息のみ支出に入り、純資産は利息分だけ減る', () => {
    // 1,200 万・年 1.2%・元利均等 12 回: 月利 0.001、初回利息 = 12,000,000 × 0.001 = 12,000
    const r3 = ok(base({ events: [home({ price: 12000000, downPayment: 0, closingCosts: 0, loan: { annualRate: 0.012, termMonths: 12, method: 'equal_payment', rateChanges: [] } })] }));
    const m = at(r3, '2028-05');
    expect(m.loanInterest).toBe(12000);
    expect(m.expense).toBe(12000);
    expect(m.netWorth - at(r3, '2028-04').netWorth).toBe(-12000);
  });
  it('頭金が物件価格を超える場合は警告して計算に含めない', () => {
    const r4 = ok(base({ events: [home({ downPayment: 20000000 })] }));
    expect(r4.issues.map((i) => i.code)).toContain('INVALID_PARAMS');
    expect(r4.monthly.every((m) => m.realAssets === 0)).toBe(true);
  });
});

describe('賃貸・引っ越し・終了指定', () => {
  const rent = ev('rent', 'rent', date('2027-01'), { monthlyRent: 100000, renewalFee: 100000, renewalIntervalYears: 2, initialCost: 300000, growth: { type: 'none' }, end: null });
  it('家賃は毎月、入居時費用は入居月、更新料は 2 年ごと（2029-01, 2031-01 …）', () => {
    const r = ok(base({ events: [rent] }));
    expect(at(r, '2027-01').expense).toBe(400000);
    expect(at(r, '2027-02').expense).toBe(100000);
    expect(at(r, '2029-01').expense).toBe(200000);
    expect(at(r, '2030-01').expense).toBe(100000);
    expect(at(r, '2031-01').expense).toBe(200000);
  });
  it('住宅購入で家賃を終了: 購入月の前月まで家賃、購入月以降なし', () => {
    const r = ok(base({ events: [rent, home()].map((e) => (e.id === 'home' ? { ...e, endsIds: ['rent'] } : e)) as LifeEvent[] }));
    const y2028 = r.yearly.find((y) => y.year === 2028)!;
    expect(y2028.byCategory.rent).toBe(-300000); // 1〜3 月の 3 か月分
    // 2029-01 の更新料も計上されない（終了指定は定期的な一時金も止める）
    expect(r.yearly.find((y) => y.year === 2029)!.byCategory.rent).toBeUndefined();
    expect(r.issues.map((i) => i.code)).not.toContain('RENT_OVERLAP');
  });
  it('終了指定がない引っ越しは家賃の重複を警告する', () => {
    const move = ev('move', 'rent', date('2030-01'), { monthlyRent: 150000, renewalFee: 0, renewalIntervalYears: 0, initialCost: 0, growth: { type: 'none' }, end: null });
    const r = ok(base({ events: [rent, move] }));
    expect(r.issues.map((i) => i.code)).toContain('RENT_OVERLAP');
    const fixed = ok(base({ events: [rent, { ...move, endsIds: ['rent'] }] }));
    expect(fixed.issues.map((i) => i.code)).not.toContain('RENT_OVERLAP');
    expect(at(fixed, '2030-01').expense).toBe(150000);
  });
  it('基本の収支項目もイベントで終了できる（転職で旧給与を終了）', () => {
    const r = ok(
      base({
        flows: [flow({ id: 'old', amount: 300000 })],
        events: [
          ev('job', 'job', date('2028-04'), {
            subtype: 'change',
            cost: 100000,
            flows: [{ key: 'new', direction: 'income', name: '新給与', category: 'salary', amount: 350000, frequency: 'monthly', end: null, growth: { type: 'none' }, growthBase: 'start', growthStepMonth: 4 }],
          }, ['old']),
        ],
      }),
    );
    expect(at(r, '2028-03').income).toBe(300000);
    expect(at(r, '2028-04').income).toBe(350000);
    expect(at(r, '2028-04').expense).toBe(100000);
  });
});

describe('自動車（購入・買い替え・維持費・売却）', () => {
  const car = (over: Partial<Extract<LifeEvent, { type: 'car' }>['params']> = {}) =>
    ev('car', 'car', date('2027-04'), {
      price: 2000000,
      priceGrowth: { type: 'none' },
      downPayment: 0,
      loan: null,
      cycleYears: 5,
      purchaseCount: 2,
      maintenanceYearly: 120000,
      maintenanceGrowth: { type: 'none' },
      depreciationRate: 0,
      holdUntil: date('2037-04'),
      ...over,
    });
  it('現金購入は資産購入（支出ではない）、維持費は年額 ÷ 12 を毎月', () => {
    const r = ok(base({ events: [car()] }));
    const m = at(r, '2027-04');
    expect(m.assetPurchase).toBe(2000000);
    expect(m.expense).toBe(10000);
    expect(m.balances['car:vehicle']).toBe(2000000);
  });
  it('5 年後の買い替え月: 前の車両を評価額（減価 0 なら 200 万）で売却してから購入', () => {
    const r = ok(base({ events: [car()] }));
    const m = at(r, '2032-04');
    expect(m.assetSale).toBe(2000000);
    expect(m.assetPurchase).toBe(2000000);
    expect(m.balances['car:vehicle']).toBe(2000000);
  });
  it('手放す月に売却し、維持費はその前月まで', () => {
    const r = ok(base({ events: [car()] }));
    expect(at(r, '2037-03').expense).toBe(10000);
    expect(at(r, '2037-04').expense).toBe(0);
    expect(at(r, '2037-04').assetSale).toBe(2000000);
    expect(at(r, '2037-04').balances['car:vehicle']).toBe(0);
  });
  it('減価 −15%/年: 1 年後の評価額は 170 万円（月次幾何換算 12 回、Python Decimal で独立計算）', () => {
    const r = ok(base({ events: [car({ depreciationRate: -0.15, cycleYears: 0, holdUntil: null })] }));
    expect(at(r, '2028-04').balances['car:vehicle']).toBe(1700000);
  });
  it('ローン購入: 頭金は資産購入、残りは自動車ローン（翌月から返済）', () => {
    const r = ok(base({ events: [car({ downPayment: 500000, loan: { annualRate: 0, termMonths: 30, method: 'equal_payment', rateChanges: [] }, cycleYears: 0 })] }));
    expect(at(r, '2027-04').assetPurchase).toBe(500000);
    expect(at(r, '2027-04').balances['car:loan0']).toBe(1500000);
    expect(at(r, '2027-05').loanPrincipal).toBe(50000);
  });
});

describe('結婚・出産・教育費・年金・一時支出・退職', () => {
  it('結婚で配偶者を追加し、配偶者の年齢で終わる収入を計上できる', () => {
    const r = ok(
      base({
        events: [
          ev('mar', 'marriage', date('2028-06'), {
            spouseName: '配偶者',
            spouseBirthYm: '1992-03',
            cost: 3000000,
            flows: [{ key: 'sp', direction: 'income', name: '配偶者給与', category: 'salary', ownerId: 'mar:spouse', amount: 200000, frequency: 'monthly', end: { type: 'age', memberId: 'mar:spouse', age: 40, endMode: 'before' }, growth: { type: 'none' }, growthBase: 'start', growthStepMonth: 4 }],
          }),
        ],
      }),
    );
    expect(at(r, '2028-06').expense).toBe(3000000);
    expect(at(r, '2028-06').income).toBe(200000);
    // 配偶者 1992-03 生まれ: 40 歳になる前月 = 2032-02 まで
    expect(at(r, '2032-02').income).toBe(200000);
    expect(at(r, '2032-03').income).toBe(0);
    expect(r.births['mar:spouse']).toBe(parseYm('1992-03'));
  });
  it('出産 → 教育費: 2028-05 生まれは 2035-04 に小学校入学（公立 年 366,599 円 → 月 30,550 円）', () => {
    const r = ok(
      scenario({
        assumptions: { ...scenario().assumptions, endAge: 65 },
        events: [
          ev('b', 'birth', date('2028-05'), { childName: '子', cost: 0, flows: [] }),
          ev('edu', 'education', { type: 'school', memberId: 'b:child', stage: 'elementary' }, {
            memberId: 'b:child',
            kindergarten: 'none',
            elementary: 'public',
            junior: 'none',
            high: 'none',
            university: 'national',
            overrides: {},
            growth: { type: 'none' },
          }),
        ],
      }),
    );
    expect(at(r, '2035-03').expense).toBe(0);
    expect(at(r, '2035-04').expense).toBe(30550); // 366,599 ÷ 12 = 30,549.9… → 30,550
    expect(at(r, '2041-03').expense).toBe(30550);
    expect(at(r, '2041-04').expense).toBe(0);
    // 大学（国公立）: 2047-04 入学。入学費用 672,000 + 在学費用 1,035,000 ÷ 12 = 86,250
    expect(at(r, '2047-04').expense).toBe(672000 + 86250);
    expect(at(r, '2051-03').expense).toBe(86250);
    expect(at(r, '2051-04').expense).toBe(0);
  });
  it('教育費の上書き値が既定値より優先される', () => {
    const r = ok(
      scenario({
        members: [...scenario().members, { id: 'kid', role: 'child', name: '子', birthYm: '2021-06' }],
        events: [
          ev('edu', 'education', { type: 'school', memberId: 'kid', stage: 'elementary' }, {
            memberId: 'kid',
            kindergarten: 'none',
            elementary: 'private',
            junior: 'none',
            high: 'none',
            university: 'none',
            overrides: { 'elementary:private': 1200000 },
            growth: { type: 'none' },
          }),
        ],
      }),
    );
    expect(at(r, '2028-04').expense).toBe(100000);
  });
  it('年金: 65 歳の誕生月から年額 ÷ 12（1,800,000 → 150,000）', () => {
    const r = ok(
      scenario({
        assumptions: { ...scenario().assumptions, endAge: 70 },
        events: [ev('p', 'pension', { type: 'age', memberId: 'self', age: 65 }, { memberId: 'self', annualAmount: 1800000, slideRate: 0 })],
      }),
    );
    expect(at(r, '2054-12').income).toBe(0);
    expect(at(r, '2055-01').income).toBe(150000);
  });
  it('一時支出（物価連動）: 開始 2027-01・物価 2% → 2029-06 は 2 回上昇（1,000,000 × 1.02² = 1,040,400）', () => {
    const r = ok(
      base({
        assumptions: { ...base().assumptions, inflationRate: 0.02 },
        events: [ev('trip', 'one_time', date('2029-06'), { direction: 'expense', amount: 1000000, category: 'leisure', growth: { type: 'inflation' } })],
      }),
    );
    expect(at(r, '2029-06').expense).toBe(1040400);
    expect(r.yearly.find((y) => y.year === 2029)!.byCategory.leisure).toBe(-1040400);
  });
  it('退職: 退職金（一時収入）と給与の終了', () => {
    const r = ok(
      base({
        flows: [flow({ id: 'sal', amount: 300000 })],
        events: [ev('ret', 'retirement', { type: 'age', memberId: 'self', age: 45 }, { severance: 10000000, flows: [] }, ['sal'])],
      }),
    );
    // 1990-01 生まれ: 45 歳 = 2035-01
    expect(at(r, '2034-12').income).toBe(300000);
    expect(at(r, '2035-01').income).toBe(10000000);
    expect(at(r, '2035-02').income).toBe(0);
  });
});

describe('イベントの編集・削除・無効化と二重適用の防止', () => {
  const events: LifeEvent[] = [
    home(),
    ev('trip', 'one_time', date('2030-08'), { direction: 'expense', amount: 500000, category: 'leisure', growth: { type: 'none' } }),
  ];
  it('イベントがない場合も計算できる', () => {
    expect(simulate(base()).ok).toBe(true);
  });
  it('無効化した結果 = 削除した結果（完全一致）', () => {
    const disabled = ok(base({ events: events.map((e) => (e.id === 'trip' ? { ...e, enabled: false } : e)) }));
    const removed = ok(base({ events: events.filter((e) => e.id !== 'trip') }));
    expect(disabled.yearly).toEqual(removed.yearly);
    expect(disabled.postings).toEqual(removed.postings);
  });
  it('編集（金額変更）が結果に反映され、差分は変更額と一致する', () => {
    const a = ok(base({ events }));
    const b = ok(base({ events: events.map((e) => (e.id === 'trip' && e.type === 'one_time' ? { ...e, params: { ...e.params, amount: 800000 } } : e)) }));
    expect(a.metrics.endNetWorth - b.metrics.endNetWorth).toBe(300000);
  });
  it('同じシナリオを何度計算しても結果は同じ（二重適用しない）', () => {
    const s = base({ events });
    const r1 = ok(s);
    const r2 = ok(s);
    const r3 = ok(s);
    expect(r2).toEqual(r1);
    expect(r3).toEqual(r1);
    expect(r1.postings.filter((p) => p.sourceId === 'trip')).toHaveLength(1);
    // 入力データ（シナリオ）は計算で変更されない
    expect(s.events).toEqual(events);
  });
  it('同じ ID のイベントが 2 件あるとエラー（二重計上の防止）', () => {
    const r = simulate(base({ events: [events[1]!, events[1]!] }));
    expect(!r.ok && r.issues.map((i) => i.code)).toContain('DUPLICATE_ID');
  });
  it('期間外のイベントは警告して計算に含めない', () => {
    const r = ok(base({ events: [ev('late', 'one_time', date('2099-01'), { direction: 'expense', amount: 1, category: 'leisure', growth: { type: 'none' } })] }));
    expect(r.issues.map((i) => i.code)).toContain('EVENT_OUT_OF_RANGE');
    expect(r.metrics.lifetimeExpense).toBe(0);
  });
  it('無効な出産イベントの子を参照する教育費は警告して除外', () => {
    const r = ok(
      base({
        events: [
          { ...ev('b', 'birth', date('2028-05'), { childName: '子', cost: 0, flows: [] }), enabled: false },
          ev('edu', 'education', { type: 'school', memberId: 'b:child', stage: 'elementary' }, {
            memberId: 'b:child',
            kindergarten: 'none',
            elementary: 'public',
            junior: 'none',
            high: 'none',
            university: 'none',
            overrides: {},
            growth: { type: 'none' },
          }),
        ],
      }),
    );
    expect(r.issues.map((i) => i.code)).toContain('EVENT_UNRESOLVED');
    expect(r.metrics.lifetimeExpense).toBe(0);
  });
});

describe('複数イベントの組み合わせ', () => {
  it('結婚・出産・教育・賃貸→住宅購入・車・転職・退職・年金を同時に入れても全不変条件が成立', () => {
    const r = ok(
      scenario({
        assumptions: { ...scenario().assumptions, endAge: 95, inflationRate: 0.015, autoLiquidate: true },
        accounts: [account({ id: 'cash', kind: 'cash', openingBalance: 3000000 }), account({ id: 'inv', kind: 'investment', openingBalance: 2000000, annualRate: 0.04 })],
        flows: [flow({ id: 'sal', amount: 350000, growth: { type: 'fixed', rate: 0.02 }, growthStepMonth: 4 }), flow({ id: 'liv', direction: 'expense', amount: 200000, growth: { type: 'inflation' } })],
        events: [
          ev('rent', 'rent', date('2027-01'), { monthlyRent: 90000, renewalFee: 90000, renewalIntervalYears: 2, initialCost: 0, growth: { type: 'none' }, end: null }),
          ev('mar', 'marriage', date('2028-10'), { spouseName: 'S', spouseBirthYm: '1991-07', cost: 2500000, flows: [] }),
          ev('b1', 'birth', date('2030-02'), { childName: 'C', cost: 200000, flows: [] }),
          ev('edu', 'education', { type: 'school', memberId: 'b1:child', stage: 'kindergarten' }, {
            memberId: 'b1:child',
            kindergarten: 'private',
            elementary: 'public',
            junior: 'private',
            high: 'public',
            university: 'private_science',
            overrides: {},
            growth: { type: 'inflation' },
          }),
          { ...home({ price: 50000000, downPayment: 6000000, closingCosts: 3500000, loan: { annualRate: 0.009, termMonths: 420, method: 'equal_principal', rateChanges: [{ afterMonths: 60, annualRate: 0.02 }] }, propertyTaxYearly: 160000, maintenanceMonthly: 28000, revaluationRate: -0.015 }), endsIds: ['rent'] },
          ev('car', 'car', date('2029-04'), { price: 3500000, priceGrowth: { type: 'inflation' }, downPayment: 1000000, loan: { annualRate: 0.025, termMonths: 60, method: 'equal_payment', rateChanges: [] }, cycleYears: 7, purchaseCount: 4, maintenanceYearly: 400000, maintenanceGrowth: { type: 'inflation' }, depreciationRate: -0.18, holdUntil: { type: 'age', memberId: 'self', age: 75 } }),
          ev('ret', 'retirement', { type: 'age', memberId: 'self', age: 60 }, { severance: 18000000, flows: [] }, ['sal']),
          ev('pen', 'pension', { type: 'age', memberId: 'self', age: 65 }, { memberId: 'self', annualAmount: 2100000, slideRate: 0.002 }),
        ],
      }),
    );
    expect(checkInvariants(r)).toEqual([]);
    expect(r.events.filter((e) => e.skipped)).toEqual([]);
  });
});

import { sampleScenario } from '../../domain/sample';
import { parseAppData } from '../../domain/schema';

describe('サンプルデータ', () => {
  it('スキーマに適合し、警告なしで計算でき、不変条件が成立する', () => {
    const s = sampleScenario(new Date('2026-10-26T00:00:00'));
    expect(parseAppData({ app: 'lifeplan', schemaVersion: 1, savedAt: '', settings: { displayUnit: 'man' }, activeScenarioId: s.id, scenarios: [s] }).ok).toBe(true);
    const r = ok(s);
    expect(r.issues).toEqual([]);
    expect(checkInvariants(r)).toEqual([]);
    expect(r.events.every((e) => !e.skipped)).toBe(true);
  });
});
