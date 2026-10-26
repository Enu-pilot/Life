import { Area, Bar, CartesianGrid, ComposedChart, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatMoney, type DisplayUnit } from '../../domain/format';
import { yearOf } from '../../domain/time';
import type { OkResult } from '../useSimulation';
import { assetRows, COMPARE_COLORS, INK, SERIES, usedKinds, yenAxis, type CashflowRow, type CompareRow } from './chartData';

const axisProps = { stroke: INK.secondary, tick: { fill: INK.secondary, fontSize: 12 }, tickLine: false } as const;

function shortfallRanges<T extends { shortfall: boolean }>(rows: T[], key: (r: T) => string | number): [string | number, string | number][] {
  const out: [string | number, string | number][] = [];
  let start: T | null = null;
  let prev: T | null = null;
  for (const r of rows) {
    if (r.shortfall && !start) start = r;
    if (!r.shortfall && start) {
      out.push([key(start), key(prev!)]);
      start = null;
    }
    prev = r;
  }
  if (start && prev) out.push([key(start), key(prev)]);
  return out;
}

/** 資産推移: 積み上げ面（資産は上、負債は下）＋純資産の線。イベントは縦線、資金不足の年は赤い帯 */
export function AssetChart({ result, unit, small }: { result: OkResult; unit: DisplayUnit; small?: boolean }) {
  const rows = assetRows(result);
  const kinds = usedKinds(rows);
  const events = result.events.filter((e) => e.enabled && !e.skipped);
  const fmt = (v: number) => formatMoney(v, unit);
  return (
    <div className="chart" role="img" aria-label="資産推移のグラフ（同じ値を年次表で確認できます）">
      <ResponsiveContainer width="100%" height={small ? 220 : 360}>
        <ComposedChart data={rows} margin={{ top: 10, right: 16, bottom: 0, left: 8 }} stackOffset="sign">
          <CartesianGrid stroke={INK.grid} vertical={false} />
          <XAxis dataKey="year" {...axisProps} minTickGap={24} />
          <YAxis {...axisProps} tickFormatter={yenAxis} width={64} />
          {shortfallRanges(rows, (r) => r.year).map(([a, b]) => (
            <ReferenceArea key={`sf${a}`} x1={a} x2={b} fill={INK.critical} fillOpacity={0.12} ifOverflow="extendDomain" label={small ? undefined : { value: '⚠ 資金不足', position: 'insideTop', fill: INK.critical, fontSize: 12 }} />
          ))}
          {!small && [...new Set(events.map((e) => yearOf(e.month)))].map((y) => <ReferenceLine key={`ev${y}`} x={y} stroke={INK.secondary} strokeDasharray="3 3" />)}
          {kinds.map((k) => (
            <Area key={k} type="linear" dataKey={k} name={SERIES[k].label} stackId="s" stroke="#fcfcfb" strokeWidth={1} fill={SERIES[k].color} fillOpacity={0.85} isAnimationActive={false} />
          ))}
          <Line type="linear" dataKey="netWorth" name="純資産" stroke={INK.primary} strokeWidth={2} dot={false} isAnimationActive={false} />
          <ReferenceLine y={0} stroke={INK.secondary} />
          <Tooltip formatter={(v) => fmt(Number(v))} labelFormatter={(l) => rows.find((r) => r.year === l)?.label ?? String(l)} />
        </ComposedChart>
      </ResponsiveContainer>
      <HtmlLegend items={[...kinds.map((k) => ({ label: SERIES[k].label, color: SERIES[k].color, kind: 'box' as const })), { label: '純資産', color: INK.primary, kind: 'line' as const }]} />
    </div>
  );
}

/** 凡例（HTML）。色だけに頼らず名称を併記する */
export function HtmlLegend({ items }: { items: { label: string; color: string; kind: 'box' | 'line'; dash?: string }[] }) {
  return (
    <ul className="legend" aria-label="凡例">
      {items.map((i) => (
        <li key={i.label}>
          <svg width="18" height="10" aria-hidden="true">
            {i.kind === 'box' ? <rect x="1" y="1" width="16" height="8" rx="2" fill={i.color} /> : <line x1="0" y1="5" x2="18" y2="5" stroke={i.color} strokeWidth="2" strokeDasharray={i.dash} />}
          </svg>
          {i.label}
        </li>
      ))}
    </ul>
  );
}

/** 収入・支出（棒）と収支（線）。同じ円の軸 */
export function CashflowChart({ rows, unit }: { rows: CashflowRow[]; unit: DisplayUnit }) {
  const fmt = (v: number) => formatMoney(v, unit);
  return (
    <div className="chart" role="img" aria-label="収入と支出のグラフ（同じ値を表で確認できます）">
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={rows} margin={{ top: 10, right: 16, bottom: 0, left: 8 }} stackOffset="sign" barGap={2}>
          <CartesianGrid stroke={INK.grid} vertical={false} />
          <XAxis dataKey="label" {...axisProps} minTickGap={16} />
          <YAxis {...axisProps} tickFormatter={yenAxis} width={64} />
          {shortfallRanges(rows, (r) => r.label).map(([a, b]) => (
            <ReferenceArea key={`sf${a}`} x1={a} x2={b} fill={INK.critical} fillOpacity={0.12} />
          ))}
          <Bar dataKey="income" name="収入" fill={SERIES.cash.color} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          <Bar dataKey="expense" name="支出（下向き）" fill={SERIES.savings.color} radius={[0, 0, 4, 4]} isAnimationActive={false} />
          <Line type="linear" dataKey="net" name="収支" stroke={INK.primary} strokeWidth={2} dot={false} isAnimationActive={false} />
          <ReferenceLine y={0} stroke={INK.secondary} />
          <Tooltip formatter={(v) => fmt(Number(v))} />
        </ComposedChart>
      </ResponsiveContainer>
      <HtmlLegend
        items={[
          { label: '収入', color: SERIES.cash.color, kind: 'box' },
          { label: '支出（0 より下）', color: SERIES.savings.color, kind: 'box' },
          { label: '収支', color: INK.primary, kind: 'line' },
        ]}
      />
    </div>
  );
}

/** シナリオ比較: 指標の重ね合わせ（最大 4 本、凡例＋線の種類で区別） */
export function CompareChart({ rows, series, unit }: { rows: CompareRow[]; series: { id: string; name: string }[]; unit: DisplayUnit }) {
  const dashes = ['', '6 3', '2 3', '10 4 2 4'];
  return (
    <div className="chart" role="img" aria-label="シナリオ比較のグラフ（同じ値を表で確認できます）">
      <ResponsiveContainer width="100%" height={360}>
        <LineChart data={rows} margin={{ top: 10, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid stroke={INK.grid} vertical={false} />
          <XAxis dataKey="year" {...axisProps} minTickGap={24} />
          <YAxis {...axisProps} tickFormatter={yenAxis} width={64} />
          <ReferenceLine y={0} stroke={INK.secondary} />
          {series.map((s, i) => (
            <Line key={s.id} type="linear" dataKey={s.id} name={s.name} stroke={COMPARE_COLORS[i]} strokeWidth={2} strokeDasharray={dashes[i]} dot={false} connectNulls={false} isAnimationActive={false} />
          ))}
          <Tooltip formatter={(v) => formatMoney(Number(v), unit)} />
        </LineChart>
      </ResponsiveContainer>
      <HtmlLegend items={series.map((s, i) => ({ label: s.name, color: COMPARE_COLORS[i]!, kind: 'line' as const, dash: dashes[i] }))} />
    </div>
  );
}
