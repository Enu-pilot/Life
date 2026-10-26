// 金額の丸め（calculation-spec §3）。仕訳を作る瞬間に 1 回だけ丸める。

/** 0 から遠い方向への四捨五入（負数も対称）。 */
export function roundYen(x: number): number {
  if (!Number.isFinite(x)) throw new Error(`金額が有限数ではありません: ${x}`);
  const r = Math.sign(x) * Math.floor(Math.abs(x) + 0.5);
  return r === 0 ? 0 : r; // -0 を 0 にそろえる
}

/** 円未満切り捨て（ローン返済額・利息）。正の値のみを想定。 */
export function floorYen(x: number): number {
  if (!Number.isFinite(x)) throw new Error(`金額が有限数ではありません: ${x}`);
  const r = Math.floor(x);
  return r === 0 ? 0 : r;
}

/** 年率 → 月率（幾何換算, Q-07）。 */
export function monthlyRate(annual: number): number {
  return Math.pow(1 + annual, 1 / 12) - 1;
}
