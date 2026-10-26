// 仕訳台帳（calculation-spec §5）。残高は仕訳からのみ変化させる。

import type { AccountKind } from '../domain/schema';
import type { MonthIndex } from '../domain/time';
import { EXTERNAL, type Posting } from './types';

export class DuplicatePostingError extends Error {}

/**
 * 内部では「資産として符号付き」の残高を持つ（負債は負の値）。
 * 仕訳 from → to は from の残高を減らし to の残高を増やす。
 * 負債口座からの仕訳（借入）は負債を増やし、負債口座への仕訳（元本返済）は負債を減らす。
 */
export class Ledger {
  private signed = new Map<string, number>();
  private keys = new Set<string>();
  readonly postings: Posting[] = [];

  constructor(readonly kinds: Map<string, AccountKind>) {}

  open(id: string, opening: number): void {
    const kind = this.kinds.get(id);
    this.signed.set(id, kind === 'loan' ? -opening : opening);
  }

  /** 資産は残高、負債は正の残高 */
  balance(id: string): number {
    const v = this.signed.get(id) ?? 0;
    const b = this.kinds.get(id) === 'loan' ? -v : v;
    return b === 0 ? 0 : b; // -0 を 0 にそろえる
  }

  signedBalance(id: string): number {
    return this.signed.get(id) ?? 0;
  }

  /**
   * 仕訳を記録する。uniqueKey が同じ仕訳は二重に作れない（イベント二重適用の検出, §5.2-3）。
   * 金額 0 の仕訳は作らない。
   */
  post(uniqueKey: string, p: Posting): void {
    if (!Number.isSafeInteger(p.amount) || p.amount < 0) {
      throw new Error(`仕訳金額は 0 以上の整数でなければなりません: ${p.amount} (${uniqueKey})`);
    }
    if (p.amount === 0) return;
    const k = `${p.month}|${uniqueKey}`;
    if (this.keys.has(k)) throw new DuplicatePostingError(`同じ仕訳が二重に作られました: ${k}`);
    this.keys.add(k);
    if (p.from !== EXTERNAL) this.signed.set(p.from, this.signedBalance(p.from) - p.amount);
    if (p.to !== EXTERNAL) this.signed.set(p.to, this.signedBalance(p.to) + p.amount);
    this.postings.push(p);
  }

  /** 月の範囲の仕訳 */
  postingsIn(from: MonthIndex, to: MonthIndex): Posting[] {
    return this.postings.filter((p) => p.month >= from && p.month <= to);
  }
}
