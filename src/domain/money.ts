// 金額の丸め（calculation-spec §3）。仕訳を作る瞬間に 1 回だけ丸める。

/**
 * 倍精度浮動小数の表現誤差を除くため、有効数字 15 桁に正規化する。
 * 例: 100 × 1.005 = 100.49999999999999 → 100.5、30,000,000 × (0.012 / 12) = 29999.999999999996 → 30000
 */
export function normalize15(x: number): number {
  if (x === 0) return 0;
  return Number(x.toPrecision(15));
}

/**
 * 正規化（有効数字 15 桁）で動きうる幅。端数が丸めの境界からこれより離れていれば、
 * 正規化しても丸め結果は変わらないため、文字列変換を省略できる（性能対策。結果は同一）。
 */
function nearBoundary(frac: number, boundary: number, a: number): boolean {
  return Math.abs(frac - boundary) <= a * 1e-14 + 1e-12;
}

/** 0 から遠い方向への四捨五入（負数も対称）。 */
export function roundYen(x: number): number {
  if (!Number.isFinite(x)) throw new Error(`金額が有限数ではありません: ${x}`);
  let a = Math.abs(x);
  if (nearBoundary(a - Math.floor(a), 0.5, a)) a = normalize15(a);
  const r = Math.sign(x) * Math.floor(a + 0.5);
  return r === 0 ? 0 : r; // -0 を 0 にそろえる
}

/** 円未満切り捨て（ローン返済額・利息）。正の値のみを想定。 */
export function floorYen(x: number): number {
  if (!Number.isFinite(x)) throw new Error(`金額が有限数ではありません: ${x}`);
  const frac = x - Math.floor(x);
  const v = nearBoundary(frac, 0, Math.abs(x)) || nearBoundary(frac, 1, Math.abs(x)) ? normalize15(x) : x;
  const r = Math.floor(v);
  return r === 0 ? 0 : r;
}

/** 年率 → 月率（幾何換算, Q-07）。 */
export function monthlyRate(annual: number): number {
  return Math.pow(1 + annual, 1 / 12) - 1;
}
