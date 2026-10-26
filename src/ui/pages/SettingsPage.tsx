import { CURRENT_SCHEMA_VERSION } from '../../domain/schema';
import { formatPercent } from '../../domain/format';
import { ENGINE_VERSION } from '../../engine/version';
import { useActiveScenario, useAppStore, useUnit } from '../AppContext';
import { Disclaimer } from '../components/common';
import { SelectField } from '../components/fields';

/** 計算前提の一覧（calculation-spec の要点）。実装済み・未実装を区別して表示する */
export const CALC_ASSUMPTIONS: { title: string; body: string }[] = [
  { title: '計算単位', body: '月ごとに計算し、暦年（1〜12月）で集計して表示します。日単位の計算は行いません。' },
  { title: '年齢', body: '生年月を基準とした満年齢です。誕生月に 1 歳加算します。年次表の年齢は各年 12 月時点です。' },
  { title: '学齢', body: '4月2日〜翌年4月1日生まれを同学年とします。生年「月」のみを扱うため、4月生まれは 4月2日以降生まれとみなします。' },
  { title: '期間', body: '収支の期間は開始月・終了月を含みます。「X歳まで」は「X歳になる前月まで」と「X歳の間も含む」を選べます。' },
  { title: '収入', body: '手取り額で入力します。所得税・住民税・社会保険料は計算しません。' },
  { title: '上昇率', body: '金額 ×（1＋年率）^経過年数。経過年数は指定した月（給与は既定 4 月）を迎えるごとに 1 増えます。' },
  { title: '運用', body: '税引後の期待利回りを入力します。月利は (1＋年率)^(1/12)−1。月初残高に対して運用損益を計上し、当月の入出金には当月の運用益を付けません。運用益への課税は計算しません。' },
  { title: '支出合計', body: '積立・ローン元本返済・資産購入（頭金）は支出に含めず別に表示します。ローン利息は支出に含めます。' },
  { title: 'ローン', body: '月利＝年率÷12。毎月返済額と利息は円未満切り捨て、最終回で残高を精算します。返済は毎月（ボーナス払いは未対応）。' },
  { title: '資金不足', body: '生活口座がマイナスになっても計算を続け、資金不足として警告します（マイナス残高に利息は付きません）。自動取り崩しを ON にすると預金→投資の順に補填します。' },
  { title: '丸め', body: '各収支を計上する時点で 1 円単位に四捨五入します（ローンは切り捨て）。残高は丸め済み金額の合計なので誤差は累積しません。' },
  { title: '未対応', body: '税・社会保険の計算、運用益課税、住宅ローン控除、繰上返済、不動産売却、年金の繰上げ・繰下げ増減額、確率的シミュレーションは未対応です（requirements.md 参照）。' },
];

export function SettingsPage() {
  const store = useAppStore();
  const unit = useUnit();
  const s = useActiveScenario();
  return (
    <div className="page">
      <h1>設定・計算前提</h1>
      <section className="card">
        <h2>表示</h2>
        <SelectField
          label="金額の表示単位"
          value={unit}
          onChange={(displayUnit) => store.getState().updateSettings({ displayUnit })}
          options={[
            { value: 'man', label: '万円（小数1位）' },
            { value: 'yen', label: '円' },
          ]}
        />
      </section>
      <section className="card">
        <h2>現在のシナリオの前提（{s.name}）</h2>
        <dl className="dl">
          <dt>開始年月</dt>
          <dd>{s.assumptions.startYm}</dd>
          <dt>終了年齢</dt>
          <dd>{s.assumptions.endAge}歳</dd>
          <dt>物価上昇率</dt>
          <dd>{formatPercent(s.assumptions.inflationRate)}</dd>
          <dt>既定の運用利回り</dt>
          <dd>{formatPercent(s.assumptions.defaultReturnRate)}</dd>
          <dt>資金不足時の自動取り崩し</dt>
          <dd>{s.assumptions.autoLiquidate ? 'ON' : 'OFF'}</dd>
        </dl>
      </section>
      <section className="card">
        <h2>計算前提</h2>
        <dl className="dl dl--wide">
          {CALC_ASSUMPTIONS.map((a) => (
            <div key={a.title}>
              <dt>{a.title}</dt>
              <dd>{a.body}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="card">
        <h2>免責事項</h2>
        <Disclaimer />
      </section>
      <section className="card">
        <h2>バージョン</h2>
        <dl className="dl">
          <dt>計算エンジン</dt>
          <dd>{ENGINE_VERSION}</dd>
          <dt>データ形式</dt>
          <dd>v{CURRENT_SCHEMA_VERSION}</dd>
        </dl>
      </section>
    </div>
  );
}
