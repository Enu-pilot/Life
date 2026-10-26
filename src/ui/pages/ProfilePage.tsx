import { useState } from 'react';
import { newId } from '../../domain/factory';
import { formatYmJa } from '../../domain/format';
import { findReferences } from '../../domain/refs';
import { assumptionsSchema, memberSchema, type Assumptions, type Member, type Scenario } from '../../domain/schema';
import { ageAt, isYearMonth, parseYm } from '../../domain/time';
import { useActiveScenario, useAppStore } from '../AppContext';
import { Banner, collectErrors, Dialog, EmptyState } from '../components/common';
import { CheckboxField, FormErrors, IntField, PercentField, SelectField, TextField, YmField } from '../components/fields';

const ROLE_LABEL: Record<Member['role'], string> = { self: '本人', spouse: '配偶者', child: '子' };

/** 世帯メンバーの検証（calculation-spec §14）。子は将来の生年月（出産予定）も可 */
export function validateMember(m: Member, s: Scenario): Record<string, string> {
  const e = collectErrors(memberSchema, m);
  if (!e.birthYm && isYearMonth(m.birthYm)) {
    const b = parseYm(m.birthYm);
    if (b < parseYm('1900-01')) e.birthYm = '1900-01 以降を入力してください';
    else if (m.role !== 'child' && b > parseYm(s.assumptions.startYm)) e.birthYm = 'シミュレーション開始年月以前を入力してください';
  }
  if (m.role === 'self' && s.members.some((x) => x.role === 'self' && x.id !== m.id)) e.role = '本人は 1 人のみ登録できます';
  if (m.role === 'spouse' && s.members.some((x) => x.role === 'spouse' && x.id !== m.id)) e.role = '配偶者は 1 人のみ登録できます';
  return e;
}

export function validateAssumptions(a: Assumptions, s: Scenario): Record<string, string> {
  const e = collectErrors(assumptionsSchema, a);
  if (!e.startYm) {
    const start = parseYm(a.startYm);
    const late = s.members.find((m) => m.role !== 'child' && parseYm(m.birthYm) > start);
    if (late) e.startYm = `${late.name}の生年月より後にしてください`;
  }
  const self = s.members.find((m) => m.role === 'self');
  if (!e.endAge && !e.startYm && self && ageAt(parseYm(self.birthYm), parseYm(a.startYm)) >= a.endAge) {
    e.endAge = '開始時点の本人の年齢より大きくしてください';
  }
  return e;
}

function MemberDialog({ initial, scenario, onClose }: { initial: Member; scenario: Scenario; onClose: () => void }) {
  const store = useAppStore();
  const [m, setM] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const isNew = !scenario.members.some((x) => x.id === m.id);
  const save = () => {
    const e = validateMember(m, scenario);
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    store.getState().updateActiveScenario((s) => ({
      ...s,
      members: isNew ? [...s.members, m] : s.members.map((x) => (x.id === m.id ? m : x)),
    }));
    onClose();
  };
  return (
    <Dialog
      title={isNew ? 'メンバーを追加' : 'メンバーを編集'}
      onClose={onClose}
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
      <SelectField
        label="続柄"
        value={m.role}
        onChange={(role) => setM({ ...m, role })}
        error={errors.role}
        options={(['self', 'spouse', 'child'] as const).map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
      />
      <TextField label="呼び名" value={m.name} onChange={(name) => setM({ ...m, name })} error={errors.name} maxLength={40} />
      <YmField
        label="生年月"
        required
        value={m.birthYm}
        onChange={(birthYm) => setM({ ...m, birthYm })}
        error={errors.birthYm}
        hint={m.role === 'child' ? '例: 2020-04（出産予定の場合は将来の年月も可）' : '例: 1990-05'}
      />
    </Dialog>
  );
}

function AssumptionsForm({ scenario }: { scenario: Scenario }) {
  const store = useAppStore();
  const [a, setA] = useState<Assumptions>(scenario.assumptions);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const save = () => {
    const e = validateAssumptions(a, scenario);
    setErrors(e);
    setSaved(false);
    if (Object.keys(e).length > 0) return;
    store.getState().updateActiveScenario((s) => ({ ...s, assumptions: a }));
    setSaved(true);
  };
  const warn = [a.inflationRate, a.defaultReturnRate].some((r) => Number.isFinite(r) && Math.abs(r) > 0.15);
  return (
    <section className="card">
      <h2>シミュレーション前提条件</h2>
      <FormErrors errors={Object.values(errors)} />
      <div className="grid2">
        <YmField label="シミュレーション開始年月" required value={a.startYm} onChange={(startYm) => setA({ ...a, startYm })} error={errors.startYm} />
        <IntField
          label="終了年齢（本人）"
          unit="歳"
          value={a.endAge}
          onChange={(endAge) => setA({ ...a, endAge })}
          error={errors.endAge}
          hint="60〜110 歳。本人がこの年齢になる月の前月まで計算します"
        />
        <PercentField
          label="物価上昇率（年率）"
          value={a.inflationRate}
          onChange={(inflationRate) => setA({ ...a, inflationRate })}
          error={errors.inflationRate}
          hint="「物価連動」を選んだ収支に適用。既定 1.5%"
        />
        <PercentField
          label="既定の運用利回り（税引後・年率）"
          value={a.defaultReturnRate}
          onChange={(defaultReturnRate) => setA({ ...a, defaultReturnRate })}
          error={errors.defaultReturnRate}
          hint="投資口座を新規作成するときの初期値。既定 3.0%"
        />
      </div>
      <CheckboxField
        label="資金不足時に預金・投資から自動で取り崩す"
        checked={a.autoLiquidate}
        onChange={(autoLiquidate) => setA({ ...a, autoLiquidate })}
        hint="OFF（既定）の場合、生活口座がマイナスになっても計算を続け、資金不足として警告します"
      />
      {warn && <Banner kind="warn">年率 ±15% を超える値が設定されています。意図した値か確認してください。</Banner>}
      <div className="actions">
        <button type="button" className="btn btn--primary" onClick={save}>
          前提条件を保存
        </button>
        {saved && <span className="muted">反映しました</span>}
      </div>
    </section>
  );
}

export function ProfilePage() {
  const scenario = useActiveScenario();
  const store = useAppStore();
  const [editing, setEditing] = useState<Member | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const hasSelf = scenario.members.some((m) => m.role === 'self');
  const add = (role: Member['role']) =>
    setEditing({ id: newId(), role, name: role === 'self' ? '本人' : role === 'spouse' ? '配偶者' : '子', birthYm: '' });
  const remove = (m: Member) => {
    const refs = findReferences(scenario, m.id);
    if (refs.length > 0) {
      setBlocked(`「${m.name}」は ${refs.join('、')} で参照されているため削除できません。先に参照を外してください。`);
      return;
    }
    if (!window.confirm(`「${m.name}」を削除しますか？`)) return;
    store.getState().updateActiveScenario((s) => ({ ...s, members: s.members.filter((x) => x.id !== m.id) }));
  };
  return (
    <div className="page">
      <h1>プロフィール・前提条件</h1>
      <p className="muted">シナリオ「{scenario.name}」の設定です。シナリオごとに別々に保存されます。</p>
      <section className="card">
        <h2>世帯メンバー</h2>
        {blocked && <Banner kind="error">{blocked}</Banner>}
        {scenario.members.length === 0 ? (
          <EmptyState title="まだ本人が登録されていません">
            <p>生年月を入力すると、年齢に応じた計算ができるようになります。</p>
          </EmptyState>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>続柄</th>
                <th>呼び名</th>
                <th>生年月</th>
                <th>開始時の年齢</th>
                <th>
                  <span className="visually-hidden">操作</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {scenario.members.map((m) => {
                const age = ageAt(parseYm(m.birthYm), parseYm(scenario.assumptions.startYm));
                return (
                  <tr key={m.id}>
                    <td>{ROLE_LABEL[m.role]}</td>
                    <td>{m.name}</td>
                    <td>{formatYmJa(m.birthYm)}</td>
                    <td>{age >= 0 ? `${age}歳` : '（出生前）'}</td>
                    <td className="table__actions">
                      <button type="button" className="btn btn--small" onClick={() => setEditing(m)}>
                        編集
                      </button>
                      <button type="button" className="btn btn--small btn--danger" onClick={() => remove(m)}>
                        削除
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <div className="actions">
          {!hasSelf && (
            <button type="button" className="btn btn--primary" onClick={() => add('self')}>
              本人を登録
            </button>
          )}
          {!scenario.members.some((m) => m.role === 'spouse') && (
            <button type="button" className="btn" onClick={() => add('spouse')}>
              配偶者を追加
            </button>
          )}
          <button type="button" className="btn" onClick={() => add('child')}>
            子を追加
          </button>
        </div>
        <p className="muted small">結婚・出産を将来のイベントとして扱う場合は「人生イベント」から追加できます。</p>
      </section>
      <AssumptionsForm key={scenario.id} scenario={scenario} />
      {editing && <MemberDialog initial={editing} scenario={scenario} onClose={() => setEditing(null)} />}
    </div>
  );
}

