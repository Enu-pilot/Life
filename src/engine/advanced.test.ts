// Phase 5: 高度な計算モデルのテスト（期待値は Python Decimal と手計算で独立に算出）
import { describe, expect, it } from 'vitest';
import { checkInvariants } from '../../tests/unit/arbitraries';
import { account, flow, scenario } from '../../tests/unit/fixtures';
import type { LifeEvent, Scenario } from '../domain/schema';
import { parseYm } from '../domain/time';
import { pensionClaimFactor } from './events';
import { deflate, toReal } from './real';
import { simulate } from './simulate';

function ok(s: Scenario) {
  const r = simulate(s);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r;
}
const at = (r: ReturnType<typeof ok>, ym: string) => r.monthly.find((x) => x.month === parseYm(ym))!;

const pension = (age: number, claimAdjustment: boolean, month?: number): LifeEvent => ({
  id: 'p',
  type: 'pension',
  name: '年金',
  enabled: true,
  trigger: { type: 'age', memberId: 'self', age, ...(month ? { month } : {}) },
  endsIds: [],
  params: { memberId: 'self', annualAmount: 1800000, slideRate: 0, claimAdjustment },
});
/** 本人（既定 1965-01 生まれ・昭和37年4月2日以降）、2027-01 開始、85 歳まで */
const base = (birthYm = '1965-01', events: LifeEvent[] = []) =>
  scenario({ members: [{ id: 'self', role: 'self', name: '本人', birthYm }], assumptions: { ...scenario().assumptions, endAge: 85 }, events });

describe('公的年金の繰上げ・繰下げ（日本年金機構の増減率）', () => {
  it.each([
    [60, 114000], // 1,800,000 × (1 − 0.004 × 60) ÷ 12
    [64, 142800], // × (1 − 0.004 × 12) = 0.952 → 142,800（Python Decimal で確認）
    [65, 150000],
    [66, 162600], // × (1 + 0.007 × 12) = 1.084
    [70, 213000], // × 1.42
    [75, 276000], // × 1.84
  ])('1970 年生まれ・%i 歳開始の月額は %i 円', (age, monthly) => {
    // 60 歳（2030 年）以降がすべて計算期間内に入る生年を使う
    const r = ok(base('1970-01', [pension(age, true)]));
    const first = r.postings.find((p) => p.sourceId === 'p')!;
    expect(first.amount).toBe(monthly);
    expect(first.month).toBe(parseYm('1970-01') + age * 12);
    expect(r.issues).toEqual([]);
  });
  it('昭和37年4月1日以前生まれ（1962-03）は繰上げ 0.5%/月: 60 歳 → × 0.70 = 105,000', () => {
    const r = ok(base('1962-03', [pension(60, true)]));
    expect(r.postings.find((p) => p.sourceId === 'p')!.amount).toBe(105000);
  });
  it('1962-04 生まれは 4 月 2 日以降とみなし 0.4%/月', () => {
    const f = pensionClaimFactor(parseYm('1962-04'), 60, false);
    expect('factor' in f && f.factor).toBeCloseTo(0.76, 12);
  });
  it('昭和27年4月1日以前生まれ（1952-03）の繰下げ上限は 70 歳: 75 歳開始は適用せず警告', () => {
    expect(pensionClaimFactor(parseYm('1952-03'), 75, false)).toHaveProperty('reason');
    const f = pensionClaimFactor(parseYm('1952-04'), 75, false);
    expect('factor' in f && f.factor).toBeCloseTo(1.84, 12);
    expect('months' in f && f.months).toBe(120);
  });
  it('範囲外（59 歳）・月指定ありは増減率を適用せず警告し、入力額のまま', () => {
    const r = ok(base('1965-01', [pension(59, true)]));
    expect(r.issues.map((i) => i.code)).toContain('PENSION_CLAIM_NA');
    expect(r.postings.find((p) => p.sourceId === 'p')!.amount).toBe(150000);
    const r2 = ok(base('1965-01', [pension(70, true, 3)]));
    expect(r2.issues.map((i) => i.code)).toContain('PENSION_CLAIM_NA');
  });
  it('claimAdjustment = false（v1 からの移行データ）は従来どおり入力額', () => {
    const r = ok(base('1965-01', [pension(70, false)]));
    expect(r.postings.find((p) => p.sourceId === 'p')!.amount).toBe(150000);
    expect(r.issues).toEqual([]);
  });
});

describe('額面入力の簡易推計（手取り率）', () => {
  it('額面 400,000 × 手取り率 80% = 320,000 を計上。支出には適用しない', () => {
    const r = ok(
      scenario({
        assumptions: { ...scenario().assumptions, endAge: 38 },
        flows: [flow({ id: 'g', amount: 400000, netRatio: 0.8 }), flow({ id: 'e', direction: 'expense', amount: 100000, netRatio: 0.5 })],
      }),
    );
    expect(at(r, '2027-01').income).toBe(320000);
    expect(at(r, '2027-01').expense).toBe(100000);
  });
  it('上昇率は額面に対して適用（額面 300,000・2%・手取り 80%: 2028-01 は 306,000 × 0.8 = 244,800）', () => {
    const r = ok(scenario({ assumptions: { ...scenario().assumptions, endAge: 40 }, flows: [flow({ id: 'g', amount: 300000, netRatio: 0.8, growth: { type: 'fixed', rate: 0.02 } })] }));
    expect(at(r, '2028-01').income).toBe(244800);
  });
});

describe('投資の手数料', () => {
  it('利回り 3% − 手数料 1% = 実質 2%: 1,000,000 円が 12 か月後 1,020,001 円（Python Decimal で独立計算。毎月の丸めで +1 円）', () => {
    const r = ok(
      scenario({
        assumptions: { ...scenario().assumptions, endAge: 38 },
        accounts: [account({ id: 'cash', kind: 'cash' }), account({ id: 'inv', kind: 'investment', openingBalance: 1000000, annualRate: 0.03, feeRate: 0.01 })],
      }),
    );
    expect(at(r, '2027-12').balances.inv).toBe(1020001);
  });
});

describe('楽観・標準・悲観（感度分析）', () => {
  const s = scenario({
    assumptions: { ...scenario().assumptions, endAge: 70, inflationRate: 0.015 },
    accounts: [account({ id: 'cash', kind: 'cash', openingBalance: 1000000 }), account({ id: 'inv', kind: 'investment', openingBalance: 5000000, annualRate: 0.03 })],
    flows: [flow({ id: 'in', amount: 300000 }), flow({ id: 'out', direction: 'expense', amount: 250000, growth: { type: 'inflation' } })],
  });
  it('利回り +2% の感度分析 = 口座の利回りを 5% にしたシナリオと完全一致', () => {
    const shifted = simulate(s, { returnShift: 0.02 });
    const manual = simulate({ ...s, accounts: s.accounts.map((a) => (a.id === 'inv' ? { ...a, annualRate: 0.05 } : a)) });
    expect(shifted.ok && shifted.yearly).toEqual(manual.ok && manual.yearly);
  });
  it('物価 +1% の感度分析 = 物価上昇率 2.5% のシナリオと完全一致', () => {
    const shifted = simulate(s, { inflationShift: 0.01 });
    const manual = simulate({ ...s, assumptions: { ...s.assumptions, inflationRate: 0.025 } });
    expect(shifted.ok && shifted.yearly).toEqual(manual.ok && manual.yearly);
  });
  it('楽観 ≧ 標準 ≧ 悲観（終了時の純資産）', () => {
    const [o, m, p] = [simulate(s, { returnShift: 0.02, inflationShift: -0.005 }), simulate(s), simulate(s, { returnShift: -0.02, inflationShift: 0.005 })];
    if (!o.ok || !m.ok || !p.ok) throw new Error();
    expect(o.metrics.endNetWorth).toBeGreaterThan(m.metrics.endNetWorth);
    expect(m.metrics.endNetWorth).toBeGreaterThan(p.metrics.endNetWorth);
    expect(checkInvariants(p)).toEqual([]);
  });
});

describe('実質値（物価調整後）', () => {
  it('1,000,000 円を 24 か月後・物価 2% で割り引くと 961,169 円（Python Decimal: 961,168.78…）', () => {
    expect(deflate(1000000, 0, 24, 0.02)).toBe(961169);
    expect(deflate(1000000, 0, 0, 0.02)).toBe(1000000);
  });
  it('物価上昇に連動する支出は実質値ではほぼ一定（年 1 回の上昇月とのずれを除く）', () => {
    const r = ok(scenario({ assumptions: { ...scenario().assumptions, endAge: 60, inflationRate: 0.02 }, flows: [flow({ id: 'e', direction: 'expense', amount: 100000, growth: { type: 'inflation' } })] }));
    const real = toReal(r, 0.02);
    // 1 月（上昇直後）は実質 100,000 円
    for (const y of [2030, 2040, 2049]) expect(real.monthly.find((m) => m.month === parseYm(`${y}-01`))!.expense).toBe(100000);
    // 名目は増えている
    expect(r.monthly.find((m) => m.month === parseYm('2049-01'))!.expense).toBeGreaterThan(150000);
  });
  it('物価上昇率 0 なら名目 = 実質', () => {
    const r = ok(scenario({ flows: [flow({ id: 'x', amount: 1234 })] }));
    expect(toReal(r, 0).yearly).toEqual(r.yearly);
  });
});
