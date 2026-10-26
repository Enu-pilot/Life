import { describe, expect, it } from 'vitest';
import { scenario, flow } from '../../tests/unit/fixtures';
import { findReferences } from '../domain/refs';
import { formatYm, parseYm } from '../domain/time';
import { DuplicatePostingError, Ledger } from './ledger';
import { resolveEnd, resolveStart, UnresolvedMemberError } from './triggers';
import { EXTERNAL } from './types';

const births = new Map([
  ['me', parseYm('1990-05')],
  ['kid', parseYm('2020-03')],
]);
const S = (t: Parameters<typeof resolveStart>[0]) => formatYm(resolveStart(t, births));
const E = (t: Parameters<typeof resolveEnd>[0]) => formatYm(resolveEnd(t, births));

describe('トリガー解決（手計算）', () => {
  it('年月指定は開始・終了ともその月', () => {
    expect(S({ type: 'date', ym: '2030-04' })).toBe('2030-04');
    expect(E({ type: 'date', ym: '2030-04' })).toBe('2030-04');
  });
  it('年齢指定の開始は誕生月', () => {
    expect(S({ type: 'age', memberId: 'me', age: 65 })).toBe('2055-05');
  });
  it('年齢指定の終了: before は前月、through は 1 年後の前月', () => {
    expect(E({ type: 'age', memberId: 'me', age: 65 })).toBe('2055-04');
    expect(E({ type: 'age', memberId: 'me', age: 65, endMode: 'before' })).toBe('2055-04');
    expect(E({ type: 'age', memberId: 'me', age: 65, endMode: 'through' })).toBe('2056-04');
  });
  it('「65歳の間の3月」（年度末定年など）', () => {
    // 65 歳の期間は 2055-05〜2056-04。その中の 3 月は 2056-03
    expect(S({ type: 'age', memberId: 'me', age: 65, month: 3 })).toBe('2056-03');
    expect(E({ type: 'age', memberId: 'me', age: 65, month: 3 })).toBe('2056-03');
    // 65 歳の間の 5 月は誕生月そのもの
    expect(S({ type: 'age', memberId: 'me', age: 65, month: 5 })).toBe('2055-05');
  });
  it('学齢指定（早生まれの子）: 開始は 4 月、終了はその前月', () => {
    expect(S({ type: 'school', memberId: 'kid', stage: 'elementary' })).toBe('2026-04');
    expect(E({ type: 'school', memberId: 'kid', stage: 'university' })).toBe('2038-03');
  });
  it('存在しないメンバーは UnresolvedMemberError', () => {
    expect(() => resolveStart({ type: 'age', memberId: 'x', age: 1 }, births)).toThrow(UnresolvedMemberError);
    expect(() => resolveEnd({ type: 'school', memberId: 'x', stage: 'high' }, births)).toThrow(UnresolvedMemberError);
  });
});

describe('仕訳台帳', () => {
  const p = { month: 1, from: EXTERNAL, to: 'cash', amount: 100, type: 'income' as const, category: 'salary', name: 'x', sourceId: 'x', sourceKind: 'item' as const };
  it('同じキーの仕訳を二重に作ると例外（イベント二重適用の検出）', () => {
    const l = new Ledger(new Map([['cash', 'cash']]));
    l.open('cash', 0);
    l.post('k', p);
    expect(() => l.post('k', p)).toThrow(DuplicatePostingError);
    expect(l.balance('cash')).toBe(100);
  });
  it('0 円の仕訳は作らない、負・小数は例外', () => {
    const l = new Ledger(new Map([['cash', 'cash']]));
    l.open('cash', 0);
    l.post('z', { ...p, amount: 0 });
    expect(l.postings).toHaveLength(0);
    expect(() => l.post('n', { ...p, amount: -1 })).toThrow();
    expect(() => l.post('f', { ...p, amount: 1.5 })).toThrow();
  });
  it('負債は借入で増え、元本返済で減る', () => {
    const l = new Ledger(
      new Map([
        ['cash', 'cash'],
        ['loan', 'loan'],
        ['home', 'property'],
      ] as const),
    );
    l.open('cash', 1000);
    l.open('loan', 0);
    l.open('home', 0);
    l.post('d', { ...p, from: 'loan', to: 'home', amount: 800, type: 'loan_draw' });
    expect(l.balance('loan')).toBe(800);
    expect(l.balance('home')).toBe(800);
    l.post('r', { ...p, from: 'cash', to: 'loan', amount: 300, type: 'loan_principal' });
    expect(l.balance('loan')).toBe(500);
    expect(l.balance('cash')).toBe(700);
    expect(l.postingsIn(1, 1)).toHaveLength(2);
  });
});

describe('参照検索', () => {
  it('参照フィールドのみを見て、派生 ID も検出する', () => {
    const s = scenario({
      flows: [flow({ id: 'f', amount: 1, ownerId: 'self' }), flow({ id: 'g', amount: 1, end: { type: 'age', memberId: 'ev:child', age: 22 } })],
    });
    expect(findReferences(s, 'self')).toEqual(['収支「f」']);
    expect(findReferences(s, 'ev')).toEqual(['収支「g」']);
    expect(findReferences(s, 'cash')).toEqual([]);
  });
});
