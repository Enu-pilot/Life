import { useState } from 'react';
import { categoryLabel as categoryName } from '../../domain/categories';
import { formatMoney, formatYmJa } from '../../domain/format';
import { ageAt, formatYm, yearOf } from '../../domain/time';
import { useActiveScenario, useUnit } from '../AppContext';
import { AssetChart, CashflowChart } from '../charts/LazyCharts';
import { monthlyCashflow, yearlyCashflow } from '../charts/chartData';
import { Banner, Disclaimer } from '../components/common';
import { Issues } from '../components/Issues';
import { YearDetail } from '../components/YearDetail';
import { YearTable } from '../components/YearTable';
import { Sensitivity } from '../components/Sensitivity';
import { buildYearlyCsv } from '../../app/csv';
import { downloadText } from '../download';
import { toReal } from '../../engine';
import { EVENT_META } from '../events/defaults';
import { useSimulation, type OkResult } from '../useSimulation';
import type { EventType } from '../../domain/schema';

export function EventTimeline({ result }: { result: OkResult }) {
  const b = result.births[result.selfId]!;
  const list = result.events.filter((e) => e.month >= result.start && e.month <= result.end);
  if (list.length === 0) return <p className="muted small">計算期間内のイベントはありません。</p>;
  return (
    <ul className="timeline" aria-label="イベントのタイムライン">
      {list.map((e) => (
        <li key={e.id} className={e.enabled && !e.skipped ? '' : 'off'}>
          <div>
            {formatYmJa(formatYm(e.month))}
            <div className="muted small">本人 {ageAt(b, e.month)}歳</div>
          </div>
          <div>
            <span className="badge">
              {EVENT_META[e.type as EventType]?.icon} {EVENT_META[e.type as EventType]?.label}
            </span>
            {e.name}
            {e.skipped && <span className="badge">{e.skipped}</span>}
          </div>
          <div />
        </li>
      ))}
    </ul>
  );
}

/** 資金不足の発生時期と原因（その年の明細へ） */
export function ShortfallCauses({ result, onYear }: { result: OkResult; onYear: (y: number) => void }) {
  const unit = useUnit();
  const sf = result.metrics.shortfall;
  if (sf.firstMonth === null) return <p>計算期間中に生活口座がマイナスになる月はありません（最低残高 {formatMoney(result.metrics.minCash.amount, unit)}、{formatYmJa(formatYm(result.metrics.minCash.month))}）。</p>;
  const years = result.yearly.filter((y) => y.shortfallMonths > 0);
  const first = result.yearly.find((y) => y.year === yearOf(sf.firstMonth!))!;
  // 不足が始まった年の主な支出（大きい順）
  const top = Object.entries(first.byCategory)
    .filter(([, v]) => v < 0)
    .sort((a, b) => a[1] - b[1])
    .slice(0, 3);
  return (
    <>
      <Banner kind="error">
        {formatYmJa(formatYm(sf.firstMonth))}（本人 {ageAt(result.births[result.selfId]!, sf.firstMonth)}歳）から生活口座がマイナスになります。最大不足額 {formatMoney(sf.maxAmount, unit)}、不足は計 {sf.months} か月。
      </Banner>
      <p>
        {first.year}年の収支: 収入 {formatMoney(first.income, unit)}／支出 {formatMoney(first.expense, unit)}
        {first.loanPrincipal > 0 && `／ローン元本返済 ${formatMoney(first.loanPrincipal, unit)}`}
        {first.assetPurchase > 0 && `／資産購入 ${formatMoney(first.assetPurchase, unit)}`}。主な支出:{' '}
        {top.map(([k, v]) => `${categoryName(k)} ${formatMoney(-v, unit)}`).join('、') || 'なし'}
      </p>
      <div className="actions">
        <span className="muted small">不足のある年の明細:</span>
        {years.slice(0, 12).map((y) => (
          <button key={y.year} type="button" className="btn btn--small" onClick={() => onYear(y.year)}>
            {y.year}年
          </button>
        ))}
        {years.length > 12 && <span className="muted small">ほか {years.length - 12} 年（年次表の赤い行）</span>}
      </div>
    </>
  );
}


export function ProjectionPage() {
  const scenario = useActiveScenario();
  const unit = useUnit();
  const result = useSimulation(scenario);
  const [year, setYear] = useState<number | null>(null);
  const [tab, setTab] = useState<'graph' | 'table'>('graph');
  const [flowMode, setFlowMode] = useState<'yearly' | 'monthly'>('yearly');
  const [flowYear, setFlowYear] = useState<number | null>(null);
  const [real, setReal] = useState(false);
  const shown = result.ok && real ? toReal(result, scenario.assumptions.inflationRate) : result;
  return (
    <div className="page">
      <h1>資産推移</h1>
      <Issues issues={result.issues} />
      {result.ok && (
        <>
          <p className="muted">
            シナリオ「{scenario.name}」／計算期間 {formatYmJa(formatYm(result.start))} 〜 {formatYmJa(formatYm(result.end))}（月次計算・暦年集計）／物価上昇率 {(scenario.assumptions.inflationRate * 100).toFixed(2)}%
          </p>
          <div className="actions" style={{ marginTop: 0 }}>
            <label className="small">
              表示:{' '}
              <select aria-label="名目・実質" value={real ? 'real' : 'nominal'} onChange={(e) => setReal(e.target.value === 'real')}>
                <option value="nominal">名目値（将来の金額そのまま）</option>
                <option value="real">実質値（{formatYmJa(formatYm(result.start))}時点の物価に換算）</option>
              </select>
            </label>
            <button
              type="button"
              className="btn btn--small"
              onClick={() => {
                if (!window.confirm('年次表を CSV ファイルとして保存します。ファイルには収入・資産などの個人情報が含まれます。よろしいですか？')) return;
                const now = new Date();
                const csv = buildYearlyCsv(scenario, shown.ok ? shown : result, { real, exportedAt: now });
                downloadText(`lifeplan-${scenario.name.replace(/[\\/:*?"<>|]/g, '_')}-${real ? 'real' : 'nominal'}.csv`, csv, 'text/csv');
              }}
            >
              CSV 出力（年次表）
            </button>
            {real && <span className="muted small">物価上昇率 {(scenario.assumptions.inflationRate * 100).toFixed(2)}% で割り引いた購買力の目安です（表示のみ。年次の値は各年の最終月の物価で換算）。</span>}
          </div>
          <div className="tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'graph'} className={`tab${tab === 'graph' ? ' tab--active' : ''}`} onClick={() => setTab('graph')}>
              グラフ
            </button>
            <button type="button" role="tab" aria-selected={tab === 'table'} className={`tab${tab === 'table' ? ' tab--active' : ''}`} onClick={() => setTab('table')}>
              年次表
            </button>
          </div>
          {tab === 'graph' && (
            <>
              <section className="card">
                <h2>資産・負債と純資産（年末）</h2>
                <AssetChart result={shown.ok ? shown : result} unit={unit} />
                <p className="legend-note">積み上げ面は資産の内訳（負債は 0 より下）、黒い線は純資産。点線はイベント、赤い帯は資金不足の年です。値は「年次表」タブでも確認できます。</p>
              </section>
              <section className="card">
                <div className="actions" style={{ marginTop: 0, justifyContent: 'space-between' }}>
                  <h2 style={{ margin: 0 }}>収入と支出</h2>
                  <div className="actions" style={{ marginTop: 0 }}>
                    <select aria-label="集計単位" value={flowMode} onChange={(e) => setFlowMode(e.target.value as 'yearly' | 'monthly')}>
                      <option value="yearly">年次</option>
                      <option value="monthly">月次（1 年分）</option>
                    </select>
                    {flowMode === 'monthly' && (
                      <select aria-label="表示する年" value={flowYear ?? result.yearly[0]!.year} onChange={(e) => setFlowYear(Number(e.target.value))}>
                        {result.yearly.map((y) => (
                          <option key={y.year} value={y.year}>
                            {y.year}年
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>
                <CashflowChart rows={flowMode === 'yearly' ? yearlyCashflow(shown.ok ? shown : result) : monthlyCashflow(shown.ok ? shown : result, flowYear ?? result.yearly[0]!.year)} unit={unit} />
                <p className="legend-note">支出は 0 より下に表示。収支 = 収入 − 支出（積立・ローン元本返済・資産購入は含みません）。</p>
                {flowMode === 'monthly' && (
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>月</th>
                          <th className="num">収入</th>
                          <th className="num">支出</th>
                          <th className="num">収支</th>
                        </tr>
                      </thead>
                      <tbody>
                        {monthlyCashflow(shown.ok ? shown : result, flowYear ?? result.yearly[0]!.year).map((r) => (
                          <tr key={r.key} className={r.shortfall ? 'row--alert' : ''}>
                            <td>{r.label}</td>
                            <td className="num">{formatMoney(r.income, unit)}</td>
                            <td className="num">{formatMoney(-r.expense, unit)}</td>
                            <td className={`num${r.net < 0 ? ' neg' : ''}`}>{formatMoney(r.net, unit)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
              <section className="card">
                <h2>楽観・標準・悲観（感度分析）</h2>
                <Sensitivity scenario={scenario} />
              </section>
              <section className="card">
                <h2>資金不足の確認</h2>
                <ShortfallCauses result={result} onYear={setYear} />
              </section>
              <section className="card">
                <h2>イベントのタイムライン</h2>
                <EventTimeline result={result} />
              </section>
            </>
          )}
          {tab === 'table' && (
            <section className="card">
              <h2>年次表</h2>
              <p className="muted small">{real ? '実質値で表示中です。明細（期首→期末の内訳）は名目値で確認できます。' : '行を選ぶと、その年の明細と期首→期末の内訳を表示します。'}</p>
              <YearTable result={shown.ok ? shown : result} unit={unit} {...(real ? {} : { onSelect: setYear })} />
            </section>
          )}
          {year !== null && <YearDetail result={result} year={year} unit={unit} onClose={() => setYear(null)} />}
        </>
      )}
      <Disclaimer />
    </div>
  );
}
