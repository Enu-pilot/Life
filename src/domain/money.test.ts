import { describe, expect, it } from 'vitest';
import { floorYen, monthlyRate, roundYen } from './money';
import { formatMoney, parsePercentInput, parseYenInput } from './format';

describe('丸め', () => {
  it.each([
    [0.5, 1],
    [1.5, 2],
    [2.5, 3],
    [-0.5, -1],
    [-2.5, -3],
    [1.49, 1],
    [-1.49, -1],
    [0, 0],
    [-0.2, 0],
  ])('roundYen(%f) = %i（0 から遠い方向への四捨五入）', (x, y) => {
    expect(roundYen(x)).toBe(y);
    expect(Object.is(roundYen(x), -0)).toBe(false);
  });
  it('浮動小数誤差を含む値でも期待どおり', () => {
    // 300000 * 1.02 = 306000.00000000006（浮動小数）
    expect(roundYen(300000 * 1.02)).toBe(306000);
    // 0.1 + 0.2 = 0.30000000000000004
    expect(roundYen((0.1 + 0.2) * 10)).toBe(3);
  });
  it('floorYen は切り捨て', () => {
    expect(floorYen(87510.99)).toBe(87510);
    expect(floorYen(30000)).toBe(30000);
  });
  it('非有限数は例外', () => {
    expect(() => roundYen(NaN)).toThrow();
    expect(() => floorYen(Infinity)).toThrow();
  });
  it('月利の幾何換算: 12 か月複利で年率に一致', () => {
    expect(Math.pow(1 + monthlyRate(0.03), 12)).toBeCloseTo(1.03, 12);
    expect(monthlyRate(0)).toBe(0);
  });
});

describe('金額入力の解釈', () => {
  it.each([
    ['300000', 300000],
    ['300,000', 300000],
    ['３０万', 300000],
    ['30万円', 300000],
    ['1億2000万', 120000000],
    ['1.5万', 15000],
    ['0', 0],
    ['  12,345 円 ', 12345],
  ])('"%s" → %i', (s, v) => {
    expect(parseYenInput(s)).toBe(v);
  });
  it('空は null、不正は NaN', () => {
    expect(parseYenInput('')).toBeNull();
    expect(parseYenInput('abc')).toBeNaN();
    expect(parseYenInput('30万abc')).toBeNaN();
  });
  it('万円単位を既定にすると数値は万円として解釈', () => {
    expect(parseYenInput('30', 'man')).toBe(300000);
  });
  it('パーセント', () => {
    expect(parsePercentInput('1.5')).toBe(0.015);
    expect(parsePercentInput('-10')).toBe(-0.1);
    expect(parsePercentInput('３%')).toBe(0.03);
    expect(parsePercentInput('')).toBeNull();
    expect(parsePercentInput('x')).toBeNaN();
  });
  it('表示', () => {
    expect(formatMoney(1234567, 'yen')).toBe('1,234,567円');
    expect(formatMoney(1234567, 'man')).toBe('123.5万円');
  });
});
