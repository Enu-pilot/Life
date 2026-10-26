import { useState } from 'react';
import { formatYm } from '../../domain/time';
import { useActiveScenario, useUnit } from '../AppContext';
import { Disclaimer } from '../components/common';
import { Issues } from '../components/Issues';
import { YearDetail } from '../components/YearDetail';
import { YearTable } from '../components/YearTable';
import { useSimulation } from '../useSimulation';

export function ProjectionPage() {
  const scenario = useActiveScenario();
  const unit = useUnit();
  const result = useSimulation(scenario);
  const [year, setYear] = useState<number | null>(null);
  return (
    <div className="page">
      <h1>資産推移</h1>
      <Issues issues={result.issues} />
      {result.ok && (
        <>
          <p className="muted">
            計算期間: {formatYm(result.start)} 〜 {formatYm(result.end)}（月次計算・暦年集計）。行を選ぶとその年の明細と期首→期末の内訳を表示します。
          </p>
          <section className="card">
            <h2>年次表</h2>
            <YearTable result={result} unit={unit} onSelect={setYear} />
          </section>
          {year !== null && <YearDetail result={result} year={year} unit={unit} onClose={() => setYear(null)} />}
        </>
      )}
      <Disclaimer />
    </div>
  );
}
