import { useMemo, useState } from 'react';
import { formatMoney, formatYmJa } from '../../domain/format';
import type { Scenario } from '../../domain/schema';
import { formatYm } from '../../domain/time';
import { simulate } from '../../engine';
import { useUnit } from '../AppContext';
import { CompareChart } from '../charts/Charts';
import { compareRows } from '../charts/chartData';
import type { OkResult } from '../useSimulation';
import { netWorthAtAge } from '../pages/DashboardPage';
import { PercentField } from './fields';

/** 楽観・標準・悲観（感度分析）。確率ではなく、前提を変えた場合の試算 */
export function Sensitivity({ scenario }: { scenario: Scenario }) {
  const unit = useUnit();
  const [ret, setRet] = useState(0.02);
  const [inf, setInf] = useState(0.005);
  const valid = Number.isFinite(ret) && Number.isFinite(inf) && Math.abs(ret) <= 0.1 && Math.abs(inf) <= 0.05;
  const cases = useMemo(() => {
    if (!valid) return null;
    const list = [
      { id: 'opt', name: `楽観（利回り＋${(ret * 100).toFixed(1)}%・物価−${(inf * 100).toFixed(1)}%）`, r: simulate(scenario, { returnShift: ret, inflationShift: -inf }) },
      { id: 'std', name: '標準（入力どおり）', r: simulate(scenario) },
      { id: 'pes', name: `悲観（利回り−${(ret * 100).toFixed(1)}%・物価＋${(inf * 100).toFixed(1)}%）`, r: simulate(scenario, { returnShift: -ret, inflationShift: inf }) },
    ];
    return list.every((c) => c.r.ok) ? (list as { id: string; name: string; r: OkResult }[]) : null;
  }, [scenario, ret, inf, valid]);
  return (
    <>
      <p className="muted small">
        運用利回り（投資口座）と物価上昇率を上下させた場合の試算です。<strong>起こる確率を示すものではありません。</strong>運用利回りは不確実であり、標準ケースも確定した将来収益ではありません。
      </p>
      <div className="grid2">
        <PercentField label="利回りの振れ幅（±）" value={ret} onChange={setRet} error={valid ? undefined : '利回り ±10%、物価 ±5% 以内で入力してください'} />
        <PercentField label="物価上昇率の振れ幅（±）" value={inf} onChange={setInf} />
      </div>
      {cases && (
        <>
          <div className="table-wrap">
            <table className="table" data-testid="sensitivity-table">
              <thead>
                <tr>
                  <th>ケース</th>
                  <th className="num">65歳の年末の純資産</th>
                  <th className="num">計算終了時の純資産</th>
                  <th>資金不足</th>
                </tr>
              </thead>
              <tbody>
                {cases.map((c) => (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td className="num">{netWorthAtAge(c.r, 65) ? formatMoney(netWorthAtAge(c.r, 65)!.value, unit) : '期間外'}</td>
                    <td className="num">{formatMoney(c.r.metrics.endNetWorth, unit)}</td>
                    <td>{c.r.metrics.shortfall.firstMonth === null ? 'なし' : `⚠ ${formatYmJa(formatYm(c.r.metrics.shortfall.firstMonth))}から`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <CompareChart rows={compareRows(cases.map((c) => ({ id: c.id, result: c.r })), 'netWorth')} series={cases.map((c) => ({ id: c.id, name: c.name }))} unit={unit} />
        </>
      )}
    </>
  );
}
