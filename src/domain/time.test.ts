import { describe, expect, it } from 'vitest';
import { ageAt, calendarMonthOf, elementaryEntry, formatYm, parseYm, stageEntry, yearOf } from './time';

// 期待値はすべて手計算（test-strategy §3.1）
describe('年月', () => {
  it.each(['1900-01', '1999-12', '2000-01', '2100-12'])('%s を往復変換できる', (ym) => {
    expect(formatYm(parseYm(ym))).toBe(ym);
  });
  it('通し月番号は year*12 + (month-1)', () => {
    expect(parseYm('2026-01')).toBe(2026 * 12);
    expect(parseYm('2026-12')).toBe(2026 * 12 + 11);
    expect(yearOf(parseYm('2026-12'))).toBe(2026);
    expect(calendarMonthOf(parseYm('2026-12'))).toBe(12);
  });
  it.each(['2026-13', '2026-00', '2026-1', '26-01', '', '2026/01'])('不正な形式 %s は例外', (ym) => {
    expect(() => parseYm(ym)).toThrow();
  });
});

describe('年齢', () => {
  it('誕生月の前月は加算前', () => {
    expect(ageAt(parseYm('1990-05'), parseYm('2026-04'))).toBe(35);
  });
  it('誕生月に加算', () => {
    expect(ageAt(parseYm('1990-05'), parseYm('2026-05'))).toBe(36);
  });
  it('出生前は負', () => {
    expect(ageAt(parseYm('2030-01'), parseYm('2029-12'))).toBe(-1);
  });
});

describe('学齢', () => {
  it('3月生まれ（早生まれ）は生年+6 の 4 月に小学校入学', () => {
    expect(formatYm(elementaryEntry(parseYm('2020-03')))).toBe('2026-04');
  });
  it('4月生まれは 4/2 以降扱いで生年+7', () => {
    expect(formatYm(elementaryEntry(parseYm('2020-04')))).toBe('2027-04');
  });
  it('1月生まれは生年+6', () => {
    expect(formatYm(elementaryEntry(parseYm('2020-01')))).toBe('2026-04');
  });
  it('12月生まれの大学入学は生年+19', () => {
    expect(formatYm(stageEntry(parseYm('2019-12'), 'university'))).toBe('2038-04');
  });
  it('幼稚園（3年保育）は小学校の 3 年前', () => {
    expect(formatYm(stageEntry(parseYm('2020-04'), 'kindergarten'))).toBe('2024-04');
  });
});
