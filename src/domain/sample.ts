// サンプルデータ（F-ETC-02）。架空の世帯であり、金額は操作確認用の例示。
import { newId } from './factory';
import type { FlowItem, LifeEvent, Scenario } from './schema';
import { formatYm, parseYm } from './time';

/** 開始年月を基準に、本人 30 歳の架空の世帯を作る */
export function sampleScenario(now: Date): Scenario {
  const start = now.getFullYear() * 12 + now.getMonth() + 1;
  const ym = (offsetMonths: number) => formatYm(start + offsetMonths);
  const selfBirth = formatYm(start - 30 * 12 - 3);
  const ids = { self: newId(), cash: newId(), inv: newId(), sal: newId(), bonus: newId(), living: newId(), rent: newId(), mar: newId(), born: newId() };
  const flow = (o: Partial<FlowItem> & Pick<FlowItem, 'id' | 'name' | 'direction' | 'category' | 'amount'>): FlowItem => ({
    frequency: 'monthly',
    start: null,
    end: null,
    growth: { type: 'none' },
    growthBase: 'start',
    growthStepMonth: 1,
    ...o,
  });
  const age = (a: number, endMode?: 'before' | 'through') => ({ type: 'age' as const, memberId: ids.self, age: a, ...(endMode ? { endMode } : {}) });
  const events: LifeEvent[] = [
    { id: ids.mar, type: 'marriage', name: '結婚', enabled: true, trigger: { type: 'date', ym: ym(18) }, endsIds: [], params: { spouseName: '配偶者', spouseBirthYm: formatYm(parseYm(selfBirth) + 20), cost: 2500000, flows: [{ key: 'sp', direction: 'income', name: '配偶者の給与', category: 'salary', ownerId: `${ids.mar}:spouse`, amount: 220000, frequency: 'monthly', end: { type: 'age', memberId: `${ids.mar}:spouse`, age: 60, endMode: 'before' }, growth: { type: 'fixed', rate: 0.01 }, growthBase: 'itemStart', growthStepMonth: 4 }] } },
    { id: ids.born, type: 'birth', name: '第一子の誕生', enabled: true, trigger: { type: 'date', ym: ym(36) }, endsIds: [], params: { childName: '第一子', cost: 100000, flows: [{ key: 'care', direction: 'expense', name: '子育て費', category: 'childcare', amount: 40000, frequency: 'monthly', end: { type: 'age', memberId: `${ids.born}:child`, age: 22, endMode: 'before' }, growth: { type: 'inflation' }, growthBase: 'start', growthStepMonth: 1 }] } },
    { id: newId(), type: 'education', name: '第一子の教育費', enabled: true, trigger: { type: 'school', memberId: `${ids.born}:child`, stage: 'kindergarten' }, endsIds: [], params: { memberId: `${ids.born}:child`, kindergarten: 'public', elementary: 'public', junior: 'public', high: 'public', university: 'private_arts', overrides: {}, growth: { type: 'inflation' } } },
    { id: newId(), type: 'home_purchase', name: 'マンション購入', enabled: true, trigger: { type: 'date', ym: ym(60) }, endsIds: [ids.rent], params: { price: 40000000, downPayment: 3000000, closingCosts: 2800000, loan: { annualRate: 0.009, termMonths: 420, method: 'equal_payment', rateChanges: [{ afterMonths: 120, annualRate: 0.015 }] }, propertyTaxYearly: 150000, maintenanceMonthly: 30000, maintenanceGrowth: { type: 'inflation' }, revaluationRate: -0.01 } },
    { id: newId(), type: 'car', name: '自動車', enabled: true, trigger: { type: 'date', ym: ym(40) }, endsIds: [], params: { price: 3000000, priceGrowth: { type: 'inflation' }, downPayment: 0, loan: null, cycleYears: 10, purchaseCount: 3, maintenanceYearly: 400000, maintenanceGrowth: { type: 'inflation' }, depreciationRate: -0.15, holdUntil: age(75) } },
    { id: newId(), type: 'retirement', name: '定年退職', enabled: true, trigger: age(60), endsIds: [ids.sal, ids.bonus], params: { severance: 15000000, flows: [{ key: 'rehire', direction: 'income', name: '再雇用', category: 'salary', amount: 250000, frequency: 'monthly', end: age(65, 'before'), growth: { type: 'none' }, growthBase: 'start', growthStepMonth: 4 }] } },
    { id: newId(), type: 'pension', name: '本人の年金', enabled: true, trigger: age(65), endsIds: [], params: { memberId: ids.self, annualAmount: 1800000, slideRate: 0, claimAdjustment: true } },
    { id: newId(), type: 'pension', name: '配偶者の年金', enabled: true, trigger: { type: 'age', memberId: `${ids.mar}:spouse`, age: 65 }, endsIds: [], params: { memberId: `${ids.mar}:spouse`, annualAmount: 900000, slideRate: 0, claimAdjustment: true } },
    { id: newId(), type: 'one_time', name: '家族旅行', enabled: true, trigger: { type: 'date', ym: ym(84) }, endsIds: [], params: { direction: 'expense', amount: 600000, category: 'leisure', growth: { type: 'inflation' } } },
  ];
  const ts = now.toISOString();
  return {
    id: newId(),
    name: 'サンプル（架空の世帯）',
    description: '操作確認用のサンプルです。金額は例示であり、実在の世帯・統計の代表値ではありません（教育費の既定値を除く）。',
    createdAt: ts,
    updatedAt: ts,
    assumptions: { startYm: ym(0), endAge: 95, inflationRate: 0.015, defaultReturnRate: 0.03, autoLiquidate: false },
    members: [{ id: ids.self, role: 'self', name: '本人', birthYm: selfBirth }],
    accounts: [
      { id: ids.cash, kind: 'cash', name: '生活口座', openingBalance: 6000000, annualRate: 0 },
      { id: ids.inv, kind: 'investment', name: 'NISA・投資信託', openingBalance: 1000000, annualRate: 0.03 },
    ],
    flows: [
      flow({ id: ids.sal, name: '給与（手取り）', direction: 'income', category: 'salary', amount: 280000, growth: { type: 'fixed', rate: 0.015 }, growthStepMonth: 4, end: age(60, 'before') }),
      flow({ id: ids.bonus, name: '賞与（手取り）', direction: 'income', category: 'bonus', amount: 400000, frequency: 'months', months: [6, 12], growth: { type: 'fixed', rate: 0.015 }, growthStepMonth: 4, end: age(60, 'before') }),
      flow({ id: ids.living, name: '基本生活費', direction: 'expense', category: 'living', amount: 160000, growth: { type: 'inflation' } }),
      flow({ id: ids.rent, name: '家賃', direction: 'expense', category: 'rent', amount: 95000 }),
      flow({ id: newId(), name: '保険', direction: 'expense', category: 'insurance', amount: 15000 }),
    ],
    transfers: [{ id: newId(), name: 'つみたて投資', fromId: ids.cash, toId: ids.inv, amount: 30000, frequency: 'monthly', start: null, end: age(60, 'before'), growth: { type: 'none' }, growthBase: 'start', growthStepMonth: 1 }],
    events,
  };
}
