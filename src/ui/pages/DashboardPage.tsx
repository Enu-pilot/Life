import { Link } from 'react-router';
import { formatMoney, formatYmJa } from '../../domain/format';
import { ageAt, formatYm, parseYm } from '../../domain/time';
import { useActiveScenario, useAppStore, useData, useUnit } from '../AppContext';
import { Banner, Disclaimer } from '../components/common';
import { Issues } from '../components/Issues';
import { useSimulation, type OkResult } from '../useSimulation';
import { AssetChart } from '../charts/Charts';

function GettingStarted() {
  const store = useAppStore();
  return (
    <section className="card">
      <h2>はじめに</h2>
      <ol className="steps">
        <li>
          <Link to="/profile">プロフィールを入力</Link>（本人の生年月・家族・前提条件）
        </li>
        <li>
          <Link to="/finances">収入・支出・資産を入力</Link>（収入は手取り額）
        </li>
        <li>
          <Link to="/events">人生イベントを追加</Link>（結婚・出産・住宅購入など）
        </li>
      </ol>
      <div className="actions">
        <button type="button" className="btn" onClick={() => store.getState().addSampleScenario()}>
          サンプルデータで試す
        </button>
        <span className="muted small">架空の世帯のシナリオを追加します（いつでも削除できます）。</span>
      </div>
      <p className="muted small">データはこのブラウザ内にのみ保存され、外部に送信されません。</p>
    </section>
  );
}

/** 本人が指定年齢の年の年末時点の純資産 */
export function netWorthAtAge(r: OkResult, age: number): { value: number; year: number } | null {
  const y = r.yearly.find((x) => x.ages[r.selfId] === age);
  return y ? { value: y.netWorth, year: y.year } : null;
}

function ageLabel(r: OkResult, m: number): string {
  const b = r.births[r.selfId];
  return b === undefined ? '' : `（本人 ${ageAt(b, m)}歳）`;
}

export function SummaryCards({ result, unit }: { result: OkResult; unit: 'yen' | 'man' }) {
  const at65 = netWorthAtAge(result, 65);
  const sf = result.metrics.shortfall;
  return (
    <section className="cards" aria-label="主要指標">
      <div className="stat">
        <div className="stat__label">開始時点の純資産</div>
        <div className="stat__value">{formatMoney(result.metrics.startNetWorth, unit)}</div>
      </div>
      <div className="stat">
        <div className="stat__label">65歳の年末の純資産（予測）</div>
        <div className="stat__value">{at65 ? formatMoney(at65.value, unit) : '—'}</div>
        <div className="stat__sub">{at65 ? `${at65.year}年` : '計算期間外'}</div>
      </div>
      <div className="stat">
        <div className="stat__label">計算終了時の純資産（予測）</div>
        <div className="stat__value">{formatMoney(result.metrics.endNetWorth, unit)}</div>
        <div className="stat__sub">
          {formatYmJa(formatYm(result.end))}
          {ageLabel(result, result.end)}／うち金融資産 {formatMoney(result.metrics.endFinancialAssets, unit)}
        </div>
      </div>
      <div className={`stat${sf.firstMonth !== null ? ' stat--alert' : ''}`}>
        <div className="stat__label">資金不足</div>
        <div className="stat__value">{sf.firstMonth === null ? 'なし' : `${formatYmJa(formatYm(sf.firstMonth))}〜`}</div>
        <div className="stat__sub">
          {sf.firstMonth === null
            ? `最低残高 ${formatMoney(result.metrics.minCash.amount, unit)}${ageLabel(result, result.metrics.minCash.month)}`
            : `${ageLabel(result, sf.firstMonth)} 最大不足 ${formatMoney(sf.maxAmount, unit)}・${sf.months}か月`}
        </div>
      </div>
    </section>
  );
}

export function DashboardPage() {
  const data = useData();
  const scenario = useActiveScenario();
  const unit = useUnit();
  const result = useSimulation(scenario);
  const self = scenario.members.find((m) => m.role === 'self');

  return (
    <div className="page">
      <h1>ダッシュボード</h1>
      {!self && <GettingStarted />}
      {!data.settings.lastExportedAt && (
        <Banner kind="info">
          まだバックアップ（エクスポート）が作成されていません。ブラウザのデータ消去に備えて <Link to="/data">データ管理</Link> から定期的にエクスポートしてください。
        </Banner>
      )}
      {self && <Issues issues={result.issues} compact />}
      {result.ok && (
        <>
          <p className="muted">
            シナリオ「{scenario.name}」／本人 {ageAt(parseYm(self!.birthYm), result.start)}歳（{formatYmJa(scenario.assumptions.startYm)}）から計算
          </p>
          <SummaryCards result={result} unit={unit} />
          <section className="card">
            <h2>資産推移（予測）</h2>
            <AssetChart result={result} unit={unit} small />
            <p className="legend-note">
              詳しいグラフ・年次表・明細は <Link to="/projection">資産推移</Link> で確認できます。
            </p>
          </section>
          {result.metrics.shortfall.firstMonth !== null && (
            <Banner kind="error">
              {formatYmJa(formatYm(result.metrics.shortfall.firstMonth))}から生活口座がマイナスになる見込みです。<Link to="/projection">資産推移</Link>
              の年次明細で原因を確認できます。
            </Banner>
          )}
        </>
      )}
      <Disclaimer />
    </div>
  );
}
