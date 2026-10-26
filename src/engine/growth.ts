// 上昇率の適用（calculation-spec §8.2）

import { calendarMonthOf, type MonthIndex } from '../domain/time';
import type { FlowRule } from './types';

/** 上昇の適用回数: base より後、m 以前に stepMonth を迎えた回数 */
export function growthSteps(base: MonthIndex, m: MonthIndex, stepMonth: number): number {
  if (m <= base) return 0;
  const offset = (stepMonth - calendarMonthOf(base) + 12) % 12;
  const first = base + (offset === 0 ? 12 : offset);
  if (m < first) return 0;
  return Math.floor((m - first) / 12) + 1;
}

/** 月 m の金額（丸め前）= 金額 × (1 + 率)^適用回数 */
export function amountAt(r: Pick<FlowRule, 'amount' | 'growth' | 'growthBase' | 'growthStepMonth'>, m: MonthIndex, inflation: number): number {
  const g = r.growth;
  if (g.type === 'none') return r.amount;
  const rate = g.type === 'inflation' ? inflation : g.rate;
  return r.amount * Math.pow(1 + rate, growthSteps(r.growthBase, m, r.growthStepMonth));
}
