import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { formatMoney, formatYmJa } from '../../domain/format';
import type { Scenario } from '../../domain/schema';
import { formatYm } from '../../domain/time';
import { simulate } from '../../engine';
import { useAppStore, useData, useUnit } from '../AppContext';
import { Dialog } from '../components/common';
import { FormErrors, TextField } from '../components/fields';
import { netWorthAtAge } from './DashboardPage';

export const MAX_COMPARE = 4;

function ScenarioCard({ s, active, checked, onCheck, canCheck }: { s: Scenario; active: boolean; checked: boolean; onCheck: (v: boolean) => void; canCheck: boolean }) {
  const store = useAppStore();
  const navigate = useNavigate();
  const unit = useUnit();
  const data = useData();
  const r = useMemo(() => simulate(s), [s]);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(s.name);
  const [desc, setDesc] = useState(s.description ?? '');
  const [err, setErr] = useState<string[]>([]);
  const at65 = r.ok ? netWorthAtAge(r, 65) : null;
  const dup = () => {
    const n = window.prompt('複製したシナリオの名前', `${s.name}のコピー`);
    if (n === null) return;
    if (!n.trim()) return;
    store.getState().duplicateScenario(s.id, n.trim().slice(0, 40));
  };
  const remove = () => {
    if (data.scenarios.length <= 1) return;
    if (window.confirm(`シナリオ「${s.name}」を削除しますか？（他のシナリオには影響しません）`)) store.getState().deleteScenario(s.id);
  };
  return (
    <article className={`stat${active ? ' stat--active' : ''}`} aria-label={`シナリオ ${s.name}`}>
      <div className="actions" style={{ marginTop: 0, justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0 }}>
          {s.name}
          {active && <span className="badge">表示中</span>}
        </h3>
        <label className="small">
          <input type="checkbox" checked={checked} disabled={!checked && !canCheck} onChange={(e) => onCheck(e.target.checked)} /> 比較する
        </label>
      </div>
      {s.description && <p className="muted small">{s.description}</p>}
      <p className="small">
        {r.ok ? (
          <>
            65歳の純資産 {at65 ? formatMoney(at65.value, unit) : '—'}／終了時 {formatMoney(r.metrics.endNetWorth, unit)}／
            {r.metrics.shortfall.firstMonth === null ? '資金不足なし' : <span className="neg">⚠ {formatYmJa(formatYm(r.metrics.shortfall.firstMonth))}から資金不足</span>}
          </>
        ) : (
          <span className="neg">計算できません: {r.issues[0]?.message}</span>
        )}
      </p>
      <p className="muted small">
        イベント {s.events.length} 件／更新 {new Date(s.updatedAt).toLocaleString('ja-JP')}
        {s.copiedFrom && data.scenarios.some((x) => x.id === s.copiedFrom) && `／「${data.scenarios.find((x) => x.id === s.copiedFrom)!.name}」から複製`}
      </p>
      <div className="actions">
        <button
          type="button"
          className="btn btn--small btn--primary"
          onClick={() => {
            store.getState().setActiveScenario(s.id);
            navigate('/');
          }}
        >
          開く
        </button>
        <button type="button" className="btn btn--small" onClick={dup}>
          複製
        </button>
        <button type="button" className="btn btn--small" onClick={() => setRenaming(true)}>
          名前・説明
        </button>
        <button type="button" className="btn btn--small btn--danger" onClick={remove} disabled={data.scenarios.length <= 1}>
          削除
        </button>
      </div>
      {renaming && (
        <Dialog
          title="シナリオの名前・説明"
          onClose={() => setRenaming(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setRenaming(false)}>
                キャンセル
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => {
                  if (!name.trim()) return setErr(['シナリオ名を入力してください']);
                  store.getState().updateScenario(s.id, (x) => ({ ...x, name: name.trim(), ...(desc.trim() ? { description: desc.trim() } : { description: undefined }) }));
                  setRenaming(false);
                }}
              >
                保存
              </button>
            </>
          }
        >
          <FormErrors errors={err} />
          <TextField label="名前" required value={name} onChange={setName} maxLength={40} />
          <label className="field">
            説明
            <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} maxLength={1000} />
          </label>
        </Dialog>
      )}
    </article>
  );
}

export function ScenariosPage() {
  const data = useData();
  const store = useAppStore();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<string[]>([]);
  const valid = selected.filter((id) => data.scenarios.some((s) => s.id === id));
  return (
    <div className="page">
      <h1>シナリオ</h1>
      <p className="muted">シナリオはそれぞれ独立したデータです。あるシナリオの編集は他のシナリオに影響しません。条件を変えて比べるには「複製」してから編集してください。</p>
      <div className="actions">
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => {
            const active = data.scenarios.find((s) => s.id === data.activeScenarioId)!;
            const n = window.prompt('複製したシナリオの名前', `${active.name}のコピー`);
            if (n?.trim()) store.getState().duplicateScenario(active.id, n.trim().slice(0, 40));
          }}
        >
          表示中のシナリオを複製
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            const n = window.prompt('新しいシナリオの名前', `シナリオ${data.scenarios.length + 1}`);
            if (n?.trim()) store.getState().createScenario(n.trim().slice(0, 40));
          }}
        >
          空のシナリオを作成
        </button>
        <button type="button" className="btn" onClick={() => store.getState().addSampleScenario()}>
          サンプルを追加
        </button>
        <button type="button" className="btn" disabled={valid.length < 2} onClick={() => navigate(`/scenarios/compare?ids=${valid.join(',')}`)}>
          選んだ {valid.length} 件を比較
        </button>
        <span className="muted small">比較は 2〜{MAX_COMPARE} 件。最初に選んだシナリオが基準になります。</span>
      </div>
      <div className="cards" style={{ marginTop: '1rem' }}>
        {data.scenarios.map((s) => (
          <ScenarioCard
            key={s.id}
            s={s}
            active={s.id === data.activeScenarioId}
            checked={valid.includes(s.id)}
            canCheck={valid.length < MAX_COMPARE}
            onCheck={(on) => setSelected(on ? [...valid, s.id] : valid.filter((x) => x !== s.id))}
          />
        ))}
      </div>
    </div>
  );
}
