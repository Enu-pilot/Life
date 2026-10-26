import { useMemo, useState } from 'react';
import { formatMoney, formatYmJa } from '../../domain/format';
import { findReferences } from '../../domain/refs';
import type { EventType, LifeEvent, Scenario } from '../../domain/schema';
import { ageAt, formatYm } from '../../domain/time';
import { simulate } from '../../engine';
import { useActiveScenario, useAppStore, useUnit } from '../AppContext';
import { Banner, Dialog, EmptyState } from '../components/common';
import { CheckboxField, FormErrors, TextField } from '../components/fields';
import { TriggerField } from '../components/TriggerField';
import { describeTrigger } from '../describe';
import { EVENT_META, EVENT_ORDER, newEvent } from '../events/defaults';
import { EventParamsForm, eventTitle } from '../events/EventForm';
import { validateEvent } from '../events/validateEvent';
import { memberOptions } from '../scenarioView';
import { useSimulation, type OkResult } from '../useSimulation';
import { netWorthAtAge } from './DashboardPage';

/** 変更前後の差分（イベント適用前後の説明） */
function DiffPreview({ before, after }: { before: Scenario; after: Scenario }) {
  const unit = useUnit();
  const [a, b] = useMemo(() => [simulate(before), simulate(after)], [before, after]);
  if (!a.ok || !b.ok) return <p className="muted small">差分を計算できません（入力を確認してください）。</p>;
  const row = (label: string, x: number | null, y: number | null) => {
    if (x === null || y === null) return null;
    const d = y - x;
    return (
      <tr>
        <td>{label}</td>
        <td className="num">{formatMoney(x, unit)}</td>
        <td className="num">{formatMoney(y, unit)}</td>
        <td className={`num${d < 0 ? ' neg' : ''}`}>
          {d >= 0 ? '＋' : '−'}
          {formatMoney(Math.abs(d), unit)}
        </td>
      </tr>
    );
  };
  const n65 = (r: OkResult) => netWorthAtAge(r, 65)?.value ?? null;
  return (
    <section aria-label="この変更による差分">
      <h3>この変更による差分（予測）</h3>
      <table className="table">
        <thead>
          <tr>
            <th>指標</th>
            <th className="num">変更前</th>
            <th className="num">変更後</th>
            <th className="num">差</th>
          </tr>
        </thead>
        <tbody>
          {row('65歳の年末の純資産', n65(a), n65(b))}
          {row('計算終了時の純資産', a.metrics.endNetWorth, b.metrics.endNetWorth)}
          {row('計算終了時の金融資産', a.metrics.endFinancialAssets, b.metrics.endFinancialAssets)}
          {row('生涯の収入', a.metrics.lifetimeIncome, b.metrics.lifetimeIncome)}
          {row('生涯の支出', a.metrics.lifetimeExpense, b.metrics.lifetimeExpense)}
          {row('最低の生活口座残高', a.metrics.minCash.amount, b.metrics.minCash.amount)}
        </tbody>
      </table>
      {b.metrics.shortfall.firstMonth !== null && (
        <Banner kind="warn">
          変更後は {formatYmJa(formatYm(b.metrics.shortfall.firstMonth))} から資金不足になります（最大 {formatMoney(b.metrics.shortfall.maxAmount, unit)}）。
        </Banner>
      )}
    </section>
  );
}

function EndsPicker({ event, scenario, onChange }: { event: LifeEvent; scenario: Scenario; onChange: (ids: string[]) => void }) {
  const candidates = [
    ...scenario.flows.map((f) => ({ id: f.id, label: `${f.direction === 'income' ? '収入' : '支出'}「${f.name}」` })),
    ...scenario.events.filter((e) => e.id !== event.id && e.type !== 'education' && e.type !== 'pension').map((e) => ({ id: e.id, label: `イベント「${e.name}」の継続的な収支` })),
  ];
  if (candidates.length === 0) return null;
  return (
    <fieldset className="field">
      <legend>この時点で終了する収支（前月で終了）</legend>
      {candidates.map((c) => (
        <CheckboxField
          key={c.id}
          label={c.label}
          checked={event.endsIds.includes(c.id)}
          onChange={(on) => onChange(on ? [...event.endsIds, c.id] : event.endsIds.filter((x) => x !== c.id))}
        />
      ))}
    </fieldset>
  );
}

function EventDialog({ initial, scenario, onClose }: { initial: LifeEvent; scenario: Scenario; onClose: () => void }) {
  const store = useAppStore();
  const [ev, setEv] = useState<LifeEvent>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const isNew = !scenario.events.some((x) => x.id === ev.id);
  const apply = (s: Scenario, e: LifeEvent): Scenario => ({ ...s, events: isNew ? [...s.events, e] : s.events.map((x) => (x.id === e.id ? e : x)) });
  const valid = Object.keys(validateEvent(ev, scenario)).length === 0;
  const save = () => {
    const e = validateEvent(ev, scenario);
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    store.getState().updateActiveScenario((s) => apply(s, ev));
    onClose();
  };
  const ownTrigger = ev.type === 'pension' || ev.type === 'education';
  return (
    <Dialog
      title={`${isNew ? '追加' : '編集'}: ${eventTitle(ev)}`}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            キャンセル
          </button>
          <button type="button" className="btn btn--primary" onClick={save}>
            保存
          </button>
        </>
      }
    >
      <FormErrors errors={Object.values(errors)} />
      <div className="grid2">
        <TextField label="名称" required value={ev.name} onChange={(name) => setEv({ ...ev, name })} error={errors.name} maxLength={40} />
        {!ownTrigger && (
          <TriggerField
            label="発生時期"
            mode="point"
            value={ev.trigger}
            onChange={(t) => t && setEv({ ...ev, trigger: t })}
            members={memberOptions(scenario).filter((m) => !(ev.type === 'birth' && m.id === `${ev.id}:child`) && !(ev.type === 'marriage' && m.id === `${ev.id}:spouse`))}
            error={errors.trigger ?? errors['trigger.ym']}
            defaultYm={scenario.assumptions.startYm}
          />
        )}
      </div>
      <EventParamsForm value={ev} onChange={setEv} errors={errors} scenario={scenario} />
      <EndsPicker event={ev} scenario={scenario} onChange={(endsIds) => setEv({ ...ev, endsIds })} />
      <CheckboxField label="このイベントを計算に含める（有効）" checked={ev.enabled} onChange={(enabled) => setEv({ ...ev, enabled })} />
      <label className="field">
        メモ
        <textarea value={ev.memo ?? ''} onChange={(x) => setEv({ ...ev, memo: x.target.value })} rows={2} maxLength={1000} />
      </label>
      {valid ? <DiffPreview before={scenario} after={apply(scenario, ev)} /> : <p className="muted small">入力が揃うと、この変更による差分を表示します。</p>}
    </Dialog>
  );
}

export function EventsPage() {
  const scenario = useActiveScenario();
  const store = useAppStore();
  const unit = useUnit();
  const result = useSimulation(scenario);
  const [editing, setEditing] = useState<LifeEvent | null>(null);
  const [picking, setPicking] = useState(false);
  const members = memberOptions(scenario);
  const monthOf = new Map(result.ok ? result.events.map((e) => [e.id, e] as const) : []);
  const selfBirth = result.ok ? result.births[result.selfId] : undefined;
  const sorted = [...scenario.events].sort((a, b) => (monthOf.get(a.id)?.month ?? Infinity) - (monthOf.get(b.id)?.month ?? Infinity));

  const remove = (e: LifeEvent) => {
    // 終了指定（endsIds）以外の参照（追加メンバーの参照など）
    const refs = findReferences({ ...scenario, events: scenario.events.map((x) => ({ ...x, endsIds: [] })) }, e.id);
    const msg =
      refs.length > 0
        ? `「${e.name}」を削除しますか？\n${refs.join('、')} がこのイベントで追加されるメンバーを参照しているため、それらは計算から外れます。\n（一時的に外すだけなら「無効」にしてください）`
        : `「${e.name}」を削除しますか？（一時的に外すだけなら「無効」にしてください）`;
    if (!window.confirm(msg)) return;
    // 他のイベントの終了指定からも外す
    store.getState().updateActiveScenario((s) => ({
      ...s,
      events: s.events.filter((x) => x.id !== e.id).map((x) => (x.endsIds.includes(e.id) ? { ...x, endsIds: x.endsIds.filter((id) => id !== e.id) } : x)),
    }));
  };
  const toggle = (e: LifeEvent) => store.getState().updateActiveScenario((s) => ({ ...s, events: s.events.map((x) => (x.id === e.id ? { ...x, enabled: !x.enabled } : x)) }));
  const add = (t: EventType) => {
    setPicking(false);
    setEditing(newEvent(t, scenario));
  };

  return (
    <div className="page">
      <h1>人生イベント</h1>
      {!scenario.members.some((m) => m.role === 'self') && <Banner kind="warn">先にプロフィールで本人を登録してください。</Banner>}
      {result.ok && result.issues.filter((i) => i.code.startsWith('EVENT') || i.code === 'RENT_OVERLAP' || i.code === 'MEMBER_UNRESOLVED' || i.code === 'INVALID_PARAMS').length > 0 && (
        <Banner kind="warn">
          <ul>
            {result.issues
              .filter((i) => i.code.startsWith('EVENT') || i.code === 'RENT_OVERLAP' || i.code === 'MEMBER_UNRESOLVED' || i.code === 'INVALID_PARAMS')
              .map((i, k) => (
                <li key={k}>{i.message}</li>
              ))}
          </ul>
        </Banner>
      )}
      <section className="card">
        <div className="actions" style={{ marginTop: 0, justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>タイムライン</h2>
          <button type="button" className="btn btn--primary" onClick={() => setPicking(true)}>
            イベントを追加
          </button>
        </div>
        {sorted.length === 0 ? (
          <EmptyState title="イベントがありません">
            <p>結婚・出産・住宅購入などを追加すると、将来の収支と資産推移に反映されます。</p>
          </EmptyState>
        ) : (
          <ul className="timeline" aria-label="イベント一覧">
            {sorted.map((e) => {
              const r = monthOf.get(e.id);
              return (
                <li key={e.id} className={e.enabled ? '' : 'off'}>
                  <div>
                    <div>{r ? formatYmJa(formatYm(r.month)) : '時期未確定'}</div>
                    <div className="muted small">{r && selfBirth !== undefined ? `本人 ${ageAt(selfBirth, r.month)}歳` : describeTrigger(e.trigger, members)}</div>
                  </div>
                  <div>
                    <span className="badge">{EVENT_META[e.type].icon} {EVENT_META[e.type].label}</span>
                    <strong>{e.name}</strong>
                    {!e.enabled && <span className="badge">無効</span>}
                    {r?.skipped && r.skipped !== '無効' && <span className="badge neg">計算対象外: {r.skipped}</span>}
                    {e.type === 'home_purchase' && Number.isFinite(e.params.price) && <div className="muted small">物件 {formatMoney(e.params.price, unit)}・借入 {formatMoney(e.params.price - e.params.downPayment, unit)}</div>}
                    {e.type === 'one_time' && <div className="muted small">{formatMoney(e.params.amount, unit)}</div>}
                  </div>
                  <div className="table__actions">
                    <button type="button" className="btn btn--small" onClick={() => toggle(e)} aria-pressed={e.enabled} aria-label={`${e.name}を${e.enabled ? '無効' : '有効'}にする`}>
                      {e.enabled ? '無効にする' : '有効にする'}
                    </button>
                    <button type="button" className="btn btn--small" onClick={() => setEditing(e)}>
                      編集
                    </button>
                    <button type="button" className="btn btn--small btn--danger" onClick={() => remove(e)}>
                      削除
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {picking && (
        <Dialog title="イベントの種類を選ぶ" onClose={() => setPicking(false)} wide>
          <div className="picker">
            {EVENT_ORDER.map((t) => (
              <button key={t} type="button" className="btn" onClick={() => add(t)}>
                {EVENT_META[t].icon} {EVENT_META[t].label}
                <small>{EVENT_META[t].desc}</small>
              </button>
            ))}
          </div>
        </Dialog>
      )}
      {editing && <EventDialog initial={editing} scenario={scenario} onClose={() => setEditing(null)} />}
    </div>
  );
}
