import { Link } from 'react-router';
import { formatMoney, formatYmJa } from '../../domain/format';
import { ageAt, parseYm } from '../../domain/time';
import { useActiveScenario, useAppStore, useData, useUnit } from '../AppContext';
import { Banner, Disclaimer } from '../components/common';
import { monthlyEquivalent } from '../scenarioView';

function GettingStarted() {
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
      <p className="muted small">データはこのブラウザ内にのみ保存され、外部に送信されません。</p>
    </section>
  );
}

export function DashboardPage() {
  const data = useData();
  const scenario = useActiveScenario();
  const unit = useUnit();
  useAppStore();
  const self = scenario.members.find((m) => m.role === 'self');
  const start = parseYm(scenario.assumptions.startYm);
  const income = scenario.flows.filter((f) => f.direction === 'income').reduce((s, f) => s + monthlyEquivalent(f), 0);
  const expense = scenario.flows.filter((f) => f.direction === 'expense').reduce((s, f) => s + monthlyEquivalent(f), 0);
  const assets = scenario.accounts.filter((a) => a.kind !== 'loan').reduce((s, a) => s + a.openingBalance, 0);
  const debts = scenario.accounts.filter((a) => a.kind === 'loan').reduce((s, a) => s + a.openingBalance, 0);

  return (
    <div className="page">
      <h1>ダッシュボード</h1>
      {!self && <GettingStarted />}
      {!data.settings.lastExportedAt && (
        <Banner kind="info">
          まだバックアップ（エクスポート）が作成されていません。ブラウザのデータ消去に備えて <Link to="/data">データ管理</Link> から定期的にエクスポートしてください。
        </Banner>
      )}
      <section className="cards">
        <div className="stat">
          <div className="stat__label">世帯</div>
          <div className="stat__value">{scenario.members.length}人</div>
          <div className="stat__sub">{self ? `本人 ${ageAt(parseYm(self.birthYm), start)}歳（${formatYmJa(scenario.assumptions.startYm)}時点）` : '本人未登録'}</div>
        </div>
        <div className="stat">
          <div className="stat__label">登録済みの収入（月額換算・入力値）</div>
          <div className="stat__value">{formatMoney(Math.round(income), unit)}</div>
        </div>
        <div className="stat">
          <div className="stat__label">登録済みの支出（月額換算・入力値）</div>
          <div className="stat__value">{formatMoney(Math.round(expense), unit)}</div>
        </div>
        <div className="stat">
          <div className="stat__label">開始時点の純資産</div>
          <div className="stat__value">{formatMoney(assets - debts, unit)}</div>
          <div className="stat__sub">
            資産 {formatMoney(assets, unit)} / 負債 {formatMoney(debts, unit)}
          </div>
        </div>
      </section>
      <Disclaimer />
    </div>
  );
}
