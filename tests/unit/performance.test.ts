// 性能（requirements §7）: 110 年（1,320 か月）× イベント 50 件のシナリオを 50ms 以内で再計算する
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { LifeEvent, Scenario } from '../../src/domain/schema';
import { formatYm } from '../../src/domain/time';
import { simulate } from '../../src/engine';
import { checkInvariants } from './arbitraries';
import { account, flow, scenario } from './fixtures';

export function largeScenario(): Scenario {
  const start = 2027 * 12;
  const events: LifeEvent[] = [];
  const date = (k: number) => ({ type: 'date' as const, ym: formatYm(start + k) });
  for (let i = 0; i < 20; i++) events.push({ id: `ot${i}`, type: 'one_time', name: `一時${i}`, enabled: true, trigger: date(i * 50 + 3), endsIds: [], params: { direction: i % 3 ? 'expense' : 'income', amount: 300000 + i * 1000, category: 'leisure', growth: { type: 'inflation' } } });
  for (let i = 0; i < 6; i++) events.push({ id: `rent${i}`, type: 'rent', name: `賃貸${i}`, enabled: true, trigger: date(i * 120), endsIds: i > 0 ? [`rent${i - 1}`] : [], params: { monthlyRent: 90000 + i * 5000, renewalFee: 90000, renewalIntervalYears: 2, initialCost: 400000, growth: { type: 'inflation' }, end: null } });
  for (let i = 0; i < 10; i++) events.push({ id: `fc${i}`, type: 'flow_change', name: `変更${i}`, enabled: true, trigger: date(i * 100 + 10), endsIds: i > 0 ? [`fc${i - 1}`] : [], params: { flows: [{ key: 'x', direction: 'expense', name: 'x', category: 'living', amount: 20000 + i * 1000, frequency: 'monthly', end: null, growth: { type: 'inflation' }, growthBase: 'start', growthStepMonth: 1 }] } });
  for (let i = 0; i < 5; i++) events.push({ id: `car${i}`, type: 'car', name: `車${i}`, enabled: true, trigger: date(i * 200 + 5), endsIds: [], params: { price: 2500000, priceGrowth: { type: 'inflation' }, downPayment: 500000, loan: { annualRate: 0.025, termMonths: 60, method: 'equal_payment', rateChanges: [] }, cycleYears: 4, purchaseCount: 4, maintenanceYearly: 300000, maintenanceGrowth: { type: 'inflation' }, depreciationRate: -0.15, holdUntil: date(i * 200 + 190) } });
  for (let i = 0; i < 2; i++) events.push({ id: `home${i}`, type: 'home_purchase', name: `住宅${i}`, enabled: true, trigger: date(i * 400 + 60), endsIds: [], params: { price: 40000000, downPayment: 4000000, closingCosts: 2500000, loan: { annualRate: 0.01, termMonths: 420, method: 'equal_payment', rateChanges: [{ afterMonths: 120, annualRate: 0.02 }] }, propertyTaxYearly: 150000, maintenanceMonthly: 30000, maintenanceGrowth: { type: 'inflation' }, revaluationRate: -0.01 } });
  for (let i = 0; i < 3; i++) {
    events.push({ id: `b${i}`, type: 'birth', name: `出産${i}`, enabled: true, trigger: date(24 + i * 30), endsIds: [], params: { childName: `子${i}`, cost: 100000, flows: [] } });
    events.push({ id: `e${i}`, type: 'education', name: `教育${i}`, enabled: true, trigger: { type: 'school', memberId: `b${i}:child`, stage: 'kindergarten' }, endsIds: [], params: { memberId: `b${i}:child`, kindergarten: 'private', elementary: 'public', junior: 'public', high: 'private', university: 'private_science', overrides: {}, growth: { type: 'inflation' } } });
  }
  events.push({ id: 'p', type: 'pension', name: '年金', enabled: true, trigger: { type: 'age', memberId: 'self', age: 70 }, endsIds: [], params: { memberId: 'self', annualAmount: 2000000, slideRate: 0.005, claimAdjustment: true } });
  return scenario({
    members: [{ id: 'self', role: 'self', name: '本人', birthYm: '2026-12' }],
    assumptions: { ...scenario().assumptions, endAge: 110, inflationRate: 0.015, autoLiquidate: true },
    accounts: [account({ id: 'cash', kind: 'cash', openingBalance: 5000000 }), account({ id: 'sav', kind: 'savings', openingBalance: 2000000, annualRate: 0.002 }), account({ id: 'inv', kind: 'investment', openingBalance: 3000000, annualRate: 0.04, feeRate: 0.002 })],
    flows: Array.from({ length: 20 }, (_, i) => flow({ id: `f${i}`, direction: i % 2 ? 'expense' : 'income', amount: 50000 + i * 10000, growth: i % 2 ? { type: 'inflation' } : { type: 'fixed', rate: 0.01 }, growthStepMonth: 4 })),
    transfers: [{ id: 't', name: '積立', fromId: 'cash', toId: 'inv', amount: 30000, frequency: 'monthly', start: null, end: null, growth: { type: 'none' }, growthBase: 'start', growthStepMonth: 1 }],
    events,
  });
}

describe('性能', () => {
  it('110 年 × イベント 50 件: 中央値を計測（要件 50ms）', () => {
    const s = largeScenario();
    expect(s.events.length).toBe(50);
    const first = simulate(s);
    if (!first.ok) throw new Error(JSON.stringify(first.issues));
    expect(first.monthly.length).toBe(1320);
    expect(checkInvariants(first)).toEqual([]);
    // JIT のウォームアップ（ブラウザで繰り返し再計算する状況に相当）
    for (let i = 0; i < 5; i++) simulate(s);
    const times: number[] = [];
    for (let i = 0; i < 15; i++) {
      const t = performance.now();
      simulate(s);
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)]!;
    writeFileSync('test-results-performance.json', JSON.stringify({ months: first.monthly.length, events: s.events.length, postings: first.postings.length, medianMs: median, maxMs: times.at(-1) }, null, 1));
    expect(median).toBeLessThan(50);
  });
});
