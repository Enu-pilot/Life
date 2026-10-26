import { formatMoney, type DisplayUnit } from '../../domain/format';
import type { OkResult } from '../useSimulation';

/** 年次表。グラフと同じ結果オブジェクト（result.yearly）から描画する */
export function YearTable({ result, unit, onSelect }: { result: OkResult; unit: DisplayUnit; onSelect?: (year: number) => void }) {
  const m = (v: number) => formatMoney(v, unit);
  return (
    <div className="table-wrap">
      <table className="table" data-testid="year-table">
        <caption className="visually-hidden">年次の収支と資産</caption>
        <thead>
          <tr>
            <th>年</th>
            <th>本人年齢</th>
            <th className="num">収入</th>
            <th className="num">支出</th>
            <th className="num">収支</th>
            <th className="num">ローン元本返済</th>
            <th className="num">運用損益</th>
            <th className="num">生活口座</th>
            <th className="num">金融資産</th>
            <th className="num">実物資産</th>
            <th className="num">負債</th>
            <th className="num">純資産</th>
          </tr>
        </thead>
        <tbody>
          {result.yearly.map((y) => (
            <tr
              key={y.year}
              className={`${y.shortfallMonths > 0 ? 'row--alert ' : ''}${onSelect ? 'row--click' : ''}`}
              onClick={onSelect ? () => onSelect(y.year) : undefined}
              tabIndex={onSelect ? 0 : undefined}
              onKeyDown={onSelect ? (e) => (e.key === 'Enter' || e.key === ' ') && onSelect(y.year) : undefined}
              data-year={y.year}
            >
              <td>
                {y.year}
                {y.shortfallMonths > 0 && <span className="neg"> ⚠ 不足</span>}
              </td>
              <td>{y.ages[result.selfId] ?? ''}</td>
              <td className="num">{m(y.income)}</td>
              <td className="num">{m(y.expense)}</td>
              <td className={`num${y.netIncome < 0 ? ' neg' : ''}`}>{m(y.netIncome)}</td>
              <td className="num">{m(y.loanPrincipal)}</td>
              <td className={`num${y.investmentReturn < 0 ? ' neg' : ''}`}>{m(y.investmentReturn)}</td>
              <td className={`num${y.cash < 0 ? ' neg' : ''}`}>{m(y.cash)}</td>
              <td className="num">{m(y.financialAssets)}</td>
              <td className="num">{m(y.realAssets)}</td>
              <td className="num">{m(y.liabilities)}</td>
              <td className={`num${y.netWorth < 0 ? ' neg' : ''}`} data-testid={`nw-${y.year}`}>
                {m(y.netWorth)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
