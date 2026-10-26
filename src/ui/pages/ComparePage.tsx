import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { formatMoney, formatPercent, formatYmJa, type DisplayUnit } from '../../domain/format';
import type { Scenario } from '../../domain/schema';
import { ageAt, formatYm } from '../../domain/time';
import { simulate } from '../../engine';
import { useData, useUnit } from '../AppContext';
import { CompareChart } from '../charts/LazyCharts';
import { COMPARE_COLORS, compareRows } from '../charts/chartData';
import { Banner, Disclaimer } from '../components/common';
import { YearDetail } from '../components/YearDetail';
import type { OkResult } from '../useSimulation';
import { netWorthAtAge } from './DashboardPage';
import { MAX_COMPARE } from './ScenariosPage';

type Item = { s: Scenario; r: OkResult; reference: boolean };
type Metric = 'netWorth' | 'financialAssets' | 'cash';
const METRIC_LABEL: Record<Metric, string> = { netWorth: '純資産', financialAssets: '金融資産', cash: '生活口座' };

/** 前提条件の比較。異なる項目を返す */
export function assumptionDiffs(items: Scenario[]): string[] {
  const diffs: string[] = [];
  const keys: [keyof Scenario['assumptions'], string][] = [
    ['startYm', '開始年月'],
    ['endAge', '終了年齢'],
    ['inflationRate', '物価上昇率'],
    ['autoLiquidate', '自動取り崩し'],
  ];
  for (const [k, label] of keys) if (new Set(items.map((s) => String(s.assumptions[k]))).size > 1) diffs.push(label);
  const births = new Set(items.map((s) => s.members.find((m) => m.role === 'self')?.birthYm));
  if (births.size > 1) diffs.push('本人の生年月');
  return diffs;
}

function MetricsTable({ items, unit, onYear }: { items: Item[]; unit: DisplayUnit; onYear: (id: string, y: number) => void }) {
  const age = (r: OkResult, m: number) => ageAt(r.births[r.selfId]!, m);
  const rows: { label: string; values: (number | null)[]; best: 'max' | 'min' | null; render?: (i: Item) => React.ReactNode }[] = [
    { label: '65歳の年末の純資産', values: items.map((i) => netWorthAtAge(i.r, 65)?.value ?? null), best: 'max' },
    { label: '計算終了時の純資産', values: items.map((i) => i.r.metrics.endNetWorth), best: 'max' },
    { label: '計算終了時の金融資産', values: items.map((i) => i.r.metrics.endFinancialAssets), best: 'max' },
    { label: '最低の生活口座残高', values: items.map((i) => i.r.metrics.minCash.amount), best: 'max' },
    { label: '資金不足の最大額', values: items.map((i) => i.r.metrics.shortfall.maxAmount), best: 'min' },
    { label: '生涯の収入', values: items.map((i) => i.r.metrics.lifetimeIncome), best: null },
    { label: '生涯の支出', values: items.map((i) => i.r.metrics.lifetimeExpense), best: null },
  ];
  return (
    <div className="table-wrap">
      <table className="table" data-testid="compare-metrics">
        <thead>
          <tr>
            <th>指標</th>
            {items.map((i, k) => (
              <th key={i.s.id} className="num">
                <span style={{ color: COMPARE_COLORS[k] }}>━</span> {i.s.name}
                {k === 0 && <span className="badge">基準</span>}
                {i.reference && <span className="badge">参考値</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const nums = row.values.filter((v): v is number => v !== null);
            const best = row.best && nums.length > 1 && new Set(nums).size > 1 ? (row.best === 'max' ? Math.max(...nums) : Math.min(...nums)) : null;
            return (
              <tr key={row.label}>
                <td>{row.label}</td>
                {row.values.map((v, k) => (
                  <td key={k} className={`num${v !== null && v < 0 ? ' neg' : ''}${v === best ? ' best' : ''}`}>
                    {v === null ? '期間外' : formatMoney(v, unit)}
                    {v === best && <span className="visually-hidden">（最良）</span>}
                  </td>
                ))}
              </tr>
            );
          })}
          <tr>
            <td>資金不足の発生</td>
            {items.map((i) => {
              const sf = i.r.metrics.shortfall;
              return (
                <td key={i.s.id} className="num">
                  {sf.firstMonth === null ? (
                    'なし'
                  ) : (
                    <button type="button" className="btn btn--small btn--danger" onClick={() => onYear(i.s.id, Math.floor(sf.firstMonth! / 12))}>
                      ⚠ {formatYmJa(formatYm(sf.firstMonth))}（{age(i.r, sf.firstMonth)}歳）・{sf.months}か月 — 原因を見る
                    </button>
                  )}
                </td>
              );
            })}
          </tr>
          <tr>
            <td>ローン完済</td>
            {items.map((i) => (
              <td key={i.s.id} className="num small">
                {i.r.metrics.loanPayoff.length === 0
                  ? 'ローンなし'
                  : i.r.metrics.loanPayoff.map((l) => `${l.name}: ${l.month === null ? '期間内に完済しない' : `${formatYmJa(formatYm(l.month))}（${age(i.r, l.month)}歳）`}`).join(' / ')}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function ComparePage() {
  const data = useData();
  const unit = useUnit();
  const [params] = useSearchParams();
  const [metric, setMetric] = useState<Metric>('netWorth');
  const [detail, setDetail] = useState<{ id: string; year: number } | null>(null);
  const idsKey = params.get('ids') ?? '';
  const scenarios = useMemo(
    () =>
      idsKey
        .split(',')
        .filter(Boolean)
        .slice(0, MAX_COMPARE)
        .map((id) => data.scenarios.find((s) => s.id === id))
        .filter((s): s is Scenario => !!s),
    [idsKey, data.scenarios],
  );
  // シナリオごとに独立して計算する（あるシナリオの結果が他に影響しない）
  const results = useMemo(() => scenarios.map((s) => ({ s, r: simulate(s) })), [scenarios]);
  const failed = results.filter((x) => !x.r.ok);
  const items: Item[] = results.filter((x): x is { s: Scenario; r: OkResult } => x.r.ok).map((x) => ({ ...x, reference: x.r.issues.some((i) => i.code === 'NO_FLOWS') }));

  if (scenarios.length < 2) {
    return (
      <div className="page">
        <h1>シナリオ比較</h1>
        <Banner kind="info">
          比較するシナリオを 2 件以上選んでください。<Link to="/scenarios">シナリオ一覧へ</Link>
        </Banner>
      </div>
    );
  }
  const diffs = assumptionDiffs(scenarios);
  const rows = compareRows(
    items.map((i) => ({ id: i.s.id, result: i.r })),
    metric,
  );
  const base = items[0];
  const detailItem = detail ? items.find((i) => i.s.id === detail.id) : null;

  return (
    <div className="page">
      <h1>シナリオ比較</h1>
      {failed.map((f) => (
        <Banner key={f.s.id} kind="error">
          「{f.s.name}」は計算できないため比較から除外しています: {f.r.issues.filter((i) => i.level === 'error').map((i) => i.message).join(' / ')}
        </Banner>
      ))}
      {items.some((i) => i.reference) && <Banner kind="warn">「参考値」のシナリオは収入・支出が未入力のため、結果を比較の根拠にしないでください。</Banner>}
      {diffs.length > 0 && <Banner kind="warn">シナリオ間で前提条件（{diffs.join('、')}）が異なります。差は人生の選択だけでなく前提の違いも含むため、単純比較できません。</Banner>}

      <section className="card">
        <h2>前提条件と計算期間</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>シナリオ</th>
                <th>計算期間</th>
                <th>本人の生年月</th>
                <th className="num">物価上昇率</th>
                <th>自動取り崩し</th>
                <th className="num">イベント</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.s.id}>
                  <td>{i.s.name}</td>
                  <td>
                    {formatYmJa(formatYm(i.r.start))} 〜 {formatYmJa(formatYm(i.r.end))}（{i.s.assumptions.endAge}歳まで）
                  </td>
                  <td>{formatYmJa(i.s.members.find((m) => m.role === 'self')!.birthYm)}</td>
                  <td className="num">{formatPercent(i.s.assumptions.inflationRate)}</td>
                  <td>{i.s.assumptions.autoLiquidate ? 'ON' : 'OFF'}</td>
                  <td className="num">{i.s.events.filter((e) => e.enabled).length} 件</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {items.length >= 1 && (
        <>
          <section className="card">
            <h2>主要指標</h2>
            <MetricsTable items={items} unit={unit} onYear={(id, year) => setDetail({ id, year })} />
          </section>
          <section className="card">
            <div className="actions" style={{ marginTop: 0, justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0 }}>{METRIC_LABEL[metric]}の推移（年末）</h2>
              <select aria-label="比較する指標" value={metric} onChange={(e) => setMetric(e.target.value as Metric)}>
                {(Object.keys(METRIC_LABEL) as Metric[]).map((m) => (
                  <option key={m} value={m}>
                    {METRIC_LABEL[m]}
                  </option>
                ))}
              </select>
            </div>
            <CompareChart rows={rows} series={items.map((i) => ({ id: i.s.id, name: i.s.name }))} unit={unit} />
            <h3>年ごとの値と基準（{base?.s.name}）との差</h3>
            <div className="table-wrap">
              <table className="table" data-testid="compare-table">
                <thead>
                  <tr>
                    <th>年</th>
                    <th>本人年齢（基準）</th>
                    {items.map((i) => (
                      <th key={i.s.id} className="num">
                        {i.s.name}
                      </th>
                    ))}
                    {items.slice(1).map((i) => (
                      <th key={`d${i.s.id}`} className="num">
                        差: {i.s.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const b = base ? row[base.s.id] : null;
                    const by = base?.r.yearly.find((y) => y.year === row.year);
                    return (
                      <tr key={row.year}>
                        <td>{row.year}</td>
                        <td>{by?.ages[base!.r.selfId] ?? ''}</td>
                        {items.map((i) => {
                          const v = row[i.s.id];
                          return (
                            <td key={i.s.id} className={`num${v !== null && v !== undefined && v < 0 ? ' neg' : ''}`}>
                              {v === null || v === undefined ? '—' : formatMoney(v, unit)}
                            </td>
                          );
                        })}
                        {items.slice(1).map((i) => {
                          const v = row[i.s.id];
                          const d = v !== null && v !== undefined && b !== null && b !== undefined ? v - b : null;
                          return (
                            <td key={`d${i.s.id}`} className={`num${d !== null && d < 0 ? ' neg' : ''}`}>
                              {d === null ? '—' : `${d >= 0 ? '＋' : '−'}${formatMoney(Math.abs(d), unit)}`}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
      {detail && detailItem && <YearDetail result={detailItem.r} year={detail.year} unit={unit} onClose={() => setDetail(null)} />}
      <Disclaimer />
    </div>
  );
}
