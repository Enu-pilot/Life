// ローン計算（calculation-spec §9）。月利 = 年率 / 12、返済額・利息は円未満切り捨て、最終回で精算。

import { floorYen } from '../domain/money';
import type { MonthIndex } from '../domain/time';
import type { LoanRule } from './types';

/** 元利均等の毎月返済額（円未満切り捨て） */
export function equalPayment(balance: number, annualRate: number, n: number): number {
  if (n <= 0) return balance;
  const r = annualRate / 12;
  if (r === 0) return floorYen(balance / n);
  return floorYen((balance * r) / (1 - Math.pow(1 + r, -n)));
}

export type LoanPayment = { interest: number; principal: number };

/** ローン 1 本の返済状態。月ごとに nextPayment を呼ぶ */
export class LoanState {
  private made = 0;
  private payment = 0;
  private principalPart = 0;
  private currentRate: number | null = null;

  constructor(readonly rule: LoanRule) {}

  rateAt(m: MonthIndex): number {
    let rate = this.rule.annualRate;
    for (const c of this.rule.rateChanges) if (c.month <= m) rate = c.annualRate;
    return rate;
  }

  /**
   * 月 m の返済額（利息・元本）。balance は返済前の負債残高（正）。
   * 返済対象外の月は null。
   */
  nextPayment(m: MonthIndex, balance: number): LoanPayment | null {
    if (m < this.rule.firstPayment || balance <= 0) return null;
    const remaining = this.rule.termMonths - this.made;
    const rate = this.rateAt(m);
    const r = rate / 12;
    if (this.currentRate === null || rate !== this.currentRate) {
      // 初回および金利変更時に、残高と残り回数から返済額を再計算する
      this.currentRate = rate;
      this.payment = equalPayment(balance, rate, Math.max(remaining, 1));
      this.principalPart = floorYen(balance / Math.max(remaining, 1));
    }
    const interest = floorYen(balance * r);
    let principal: number;
    if (remaining <= 1) {
      principal = balance; // 最終回（または回数超過時）は残高を精算
    } else if (this.rule.method === 'equal_payment') {
      principal = Math.max(0, Math.min(balance, this.payment - interest));
    } else {
      principal = Math.min(balance, this.principalPart);
    }
    this.made++;
    return { interest, principal };
  }
}
