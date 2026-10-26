import { formatMoney, type DisplayUnit } from '../../domain/format';
import { explainYear } from '../../engine';
import type { OkResult } from '../useSimulation';
import { Dialog } from './common';

const SOURCE: Record<string, string> = { item: '収支項目', event: 'イベント', account: '口座', system: '自動' };

function Lines({ opening, lines, closing, unit, label }: { opening: number; lines: { label: string; amount: number }[]; closing: number; unit: DisplayUnit; label: string }) {
  return (
    <table className="table">
      <tbody>
        <tr>
          <th scope="row">期首の{label}</th>
          <td className="num">{formatMoney(opening, unit)}</td>
        </tr>
        {lines.map((l) => (
          <tr key={l.label}>
            <td>　{l.amount >= 0 ? '＋' : '−'} {l.label}</td>
            <td className={`num${l.amount < 0 ? ' neg' : ''}`}>{formatMoney(Math.abs(l.amount), unit)}</td>
          </tr>
        ))}
        <tr>
          <th scope="row">期末の{label}</th>
          <td className="num">
            <strong>{formatMoney(closing, unit)}</strong>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

/** 年次明細: その年の収支の出所と、期首 → 期末の関係を説明する */
export function YearDetail({ result, year, unit, onClose }: { result: OkResult; year: number; unit: DisplayUnit; onClose: () => void }) {
  const e = explainYear(result, year);
  if (!e) return null;
  const selfAge = e.row.ages[result.selfId];
  return (
    <Dialog title={`${year}年の明細${selfAge !== undefined ? `（本人 ${selfAge}歳）` : ''}`} onClose={onClose} wide>
      {e.row.shortfallMonths > 0 && (
        <div className="banner banner--error" role="alert">
          この年は {e.row.shortfallMonths} か月、生活口座がマイナス（資金不足）です。下の「生活口座の増減」と「収支の内訳」で原因を確認できます。
        </div>
      )}
      <div className="grid2">
        <section>
          <h3>純資産の増減</h3>
          <Lines opening={e.netWorth.opening} lines={e.netWorth.lines} closing={e.netWorth.closing} unit={unit} label="純資産" />
          <p className="muted small">積立・ローン元本返済・資産購入は資産の置き換えのため純資産を変えません。</p>
        </section>
        <section>
          <h3>生活口座の増減</h3>
          <Lines opening={e.cash.opening} lines={e.cash.lines} closing={e.cash.closing} unit={unit} label="生活口座残高" />
        </section>
      </div>
      <h3>収支の内訳（出所別）</h3>
      {e.bySource.length === 0 ? (
        <p className="muted">この年の収入・支出はありません。</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>名称</th>
                <th>出所</th>
                <th>カテゴリ</th>
                <th className="num">金額</th>
              </tr>
            </thead>
            <tbody>
              {e.bySource.map((s, i) => (
                <tr key={i}>
                  <td>{s.name}</td>
                  <td>{SOURCE[s.sourceKind] ?? s.sourceKind}</td>
                  <td>{s.category}</td>
                  <td className={`num${s.amount < 0 ? ' neg' : ''}`}>
                    {s.amount < 0 ? '−' : '＋'}
                    {formatMoney(Math.abs(s.amount), unit)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Dialog>
  );
}
