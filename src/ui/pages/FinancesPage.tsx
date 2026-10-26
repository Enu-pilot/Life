import { useState } from 'react';
import { categoryLabel } from '../../domain/categories';
import { newId } from '../../domain/factory';
import { formatMoney, formatPercent } from '../../domain/format';
import { findReferences } from '../../domain/refs';
import type { Account, FlowItem, Scenario, TransferRule, Trigger } from '../../domain/schema';
import { useActiveScenario, useAppStore, useUnit } from '../AppContext';
import { Banner, Dialog, EmptyState } from '../components/common';
import { FormErrors, IntField, MonthsField, PercentField, SelectField, TextField, YenField } from '../components/fields';
import { emptyFlowCore, FlowFields } from '../components/FlowFields';
import { TriggerField } from '../components/TriggerField';
import { ACCOUNT_KIND_LABEL, memberOptions, monthlyEquivalent, RATE_LABEL } from '../scenarioView';
import { transferableAccounts, validateAccount, validateFlow, validateTransfer } from '../validators';
import { describeTrigger } from '../describe';

type Tab = 'income' | 'expense' | 'accounts' | 'transfers';

function DialogFooter({ onClose, onSave }: { onClose: () => void; onSave: () => void }) {
  return (
    <>
      <button type="button" className="btn" onClick={onClose}>
        キャンセル
      </button>
      <button type="button" className="btn btn--primary" onClick={onSave}>
        保存
      </button>
    </>
  );
}

function FlowDialog({ initial, scenario, onClose }: { initial: FlowItem; scenario: Scenario; onClose: () => void }) {
  const store = useAppStore();
  const [f, setF] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const isNew = !scenario.flows.some((x) => x.id === f.id);
  const members = memberOptions(scenario);
  const save = () => {
    const e = validateFlow(f, scenario);
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    const clean: FlowItem = f.frequency === 'monthly' ? (({ months: _m, ...r }) => (void _m, r))(f) : f;
    store.getState().updateActiveScenario((s) => ({
      ...s,
      flows: isNew ? [...s.flows, clean] : s.flows.map((x) => (x.id === f.id ? clean : x)),
    }));
    onClose();
  };
  const dirLabel = f.direction === 'income' ? '収入' : '支出';
  return (
    <Dialog title={isNew ? `${dirLabel}を追加` : `${dirLabel}を編集`} onClose={onClose} wide footer={<DialogFooter onClose={onClose} onSave={save} />}>
      <FormErrors errors={Object.values(errors)} />
      <FlowFields
        value={f}
        onChange={(core) => setF({ ...core, id: f.id, start: f.start })}
        errors={errors}
        members={members}
        defaultYm={scenario.assumptions.startYm}
        startSlot={
          <TriggerField
            label="開始"
            mode="start"
            value={f.start}
            onChange={(start: Trigger | null) => setF({ ...f, start })}
            members={members}
            nullLabel="シミュレーション開始から"
            error={errors.start}
            defaultYm={scenario.assumptions.startYm}
          />
        }
      />
    </Dialog>
  );
}

function AccountDialog({ initial, scenario, onClose }: { initial: Account; scenario: Scenario; onClose: () => void }) {
  const store = useAppStore();
  const [a, setA] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const isNew = !scenario.accounts.some((x) => x.id === a.id);
  const save = () => {
    const e = validateAccount(a, scenario);
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    const noLoan: Account = a.kind === 'loan' ? a : (({ loan: _l, ...r }) => (void _l, r))(a);
    const clean: Account = a.kind === 'investment' ? noLoan : (({ feeRate: _f, ...r }) => (void _f, r))(noLoan);
    store.getState().updateActiveScenario((s) => ({
      ...s,
      accounts: isNew ? [...s.accounts, clean] : s.accounts.map((x) => (x.id === a.id ? clean : x)),
    }));
    onClose();
  };
  const kinds = (Object.keys(ACCOUNT_KIND_LABEL) as Account['kind'][]).filter((k) => k !== 'cash' || a.kind === 'cash');
  return (
    <Dialog title={isNew ? '口座を追加' : '口座を編集'} onClose={onClose} footer={<DialogFooter onClose={onClose} onSave={save} />}>
      <FormErrors errors={Object.values(errors)} />
      {a.kind !== 'cash' && (
        <SelectField
          label="種別"
          value={a.kind}
          onChange={(kind) =>
            setA({
              ...a,
              kind,
              annualRate: kind === 'investment' ? scenario.assumptions.defaultReturnRate : 0,
              ...(kind === 'loan' ? { loan: { remainingMonths: 120, method: 'equal_payment' as const } } : {}),
            })
          }
          options={kinds.map((k) => ({ value: k, label: ACCOUNT_KIND_LABEL[k] }))}
          error={errors.kind}
        />
      )}
      <TextField label="名称" required value={a.name} onChange={(name) => setA({ ...a, name })} error={errors.name} maxLength={40} />
      <YenField
        label={a.kind === 'loan' ? '開始時点の借入残高' : '開始時点の残高・評価額'}
        required
        value={a.openingBalance}
        onChange={(openingBalance) => setA({ ...a, openingBalance })}
        error={errors.openingBalance}
      />
      <PercentField label={RATE_LABEL[a.kind]} value={a.annualRate} onChange={(annualRate) => setA({ ...a, annualRate })} error={errors.annualRate} />
      {a.kind === 'investment' && (
        <PercentField
          label="年間手数料（信託報酬など）"
          value={a.feeRate ?? 0}
          onChange={(feeRate) => {
            const { feeRate: _f, ...rest } = a;
            void _f;
            setA(feeRate === 0 ? rest : { ...rest, feeRate });
          }}
          error={errors.feeRate}
          hint="実質利回り = 期待利回り − 手数料（簡易）。期待利回りが手数料控除後の場合は 0% のまま"
        />
      )}
      {a.kind === 'loan' && a.loan && (
        <>
          <IntField
            label="残り返済回数（月）"
            unit="回"
            value={a.loan.remainingMonths}
            onChange={(remainingMonths) => setA({ ...a, loan: { ...a.loan!, remainingMonths } })}
            error={errors['loan.remainingMonths']}
          />
          <SelectField
            label="返済方式"
            value={a.loan.method}
            onChange={(method) => setA({ ...a, loan: { ...a.loan!, method } })}
            options={[
              { value: 'equal_payment', label: '元利均等返済' },
              { value: 'equal_principal', label: '元金均等返済' },
            ]}
          />
          <p className="muted small">開始月から毎月返済します（ボーナス払いは未対応）。</p>
        </>
      )}
    </Dialog>
  );
}

function TransferDialog({ initial, scenario, onClose }: { initial: TransferRule; scenario: Scenario; onClose: () => void }) {
  const store = useAppStore();
  const [t, setT] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const isNew = !scenario.transfers.some((x) => x.id === t.id);
  const members = memberOptions(scenario);
  const accts = transferableAccounts(scenario).map((a) => ({ value: a.id, label: a.name }));
  const save = () => {
    const e = validateTransfer(t, scenario);
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    store.getState().updateActiveScenario((s) => ({
      ...s,
      transfers: isNew ? [...s.transfers, t] : s.transfers.map((x) => (x.id === t.id ? t : x)),
    }));
    onClose();
  };
  return (
    <Dialog title={isNew ? '積立・取崩を追加' : '積立・取崩を編集'} onClose={onClose} wide footer={<DialogFooter onClose={onClose} onSave={save} />}>
      <FormErrors errors={Object.values(errors)} />
      <p className="muted small">口座間の資金移動です。支出・収入には含まれません。振替元の残高を超える取り崩しは残高までに制限されます（生活口座からの積立は制限しません）。</p>
      <div className="grid2">
        <TextField label="名称" required value={t.name} onChange={(name) => setT({ ...t, name })} error={errors.name} />
        <YenField label="金額（1回あたり）" required value={t.amount} onChange={(amount) => setT({ ...t, amount })} error={errors.amount} />
        <SelectField label="振替元" value={t.fromId} onChange={(fromId) => setT({ ...t, fromId })} options={[{ value: '', label: '選択してください' }, ...accts]} error={errors.fromId} />
        <SelectField label="振替先" value={t.toId} onChange={(toId) => setT({ ...t, toId })} options={[{ value: '', label: '選択してください' }, ...accts]} error={errors.toId} />
        <SelectField
          label="頻度"
          value={t.frequency}
          onChange={(frequency) => setT({ ...t, frequency, months: frequency === 'months' ? [12] : undefined })}
          options={[
            { value: 'monthly', label: '毎月' },
            { value: 'months', label: '毎年、指定した月' },
          ]}
        />
      </div>
      {t.frequency === 'months' && <MonthsField label="実行月" value={t.months ?? []} onChange={(months) => setT({ ...t, months })} error={errors.months} />}
      <div className="grid2">
        <TriggerField label="開始" mode="start" value={t.start} onChange={(start) => setT({ ...t, start })} members={members} nullLabel="シミュレーション開始から" defaultYm={scenario.assumptions.startYm} />
        <TriggerField label="終了" mode="end" value={t.end} onChange={(end) => setT({ ...t, end })} members={members} nullLabel="終了しない" error={errors.end} defaultYm={scenario.assumptions.startYm} />
      </div>
    </Dialog>
  );
}

export function FinancesPage({ initialTab = 'income' }: { initialTab?: Tab }) {
  const scenario = useActiveScenario();
  const store = useAppStore();
  const unit = useUnit();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [flow, setFlow] = useState<FlowItem | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [transfer, setTransfer] = useState<TransferRule | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const members = memberOptions(scenario);
  const memberName = (id?: string) => members.find((m) => m.id === id)?.label ?? '世帯';

  const removeWithCheck = (id: string, name: string, apply: (s: Scenario) => Scenario) => {
    // イベントの「終了指定」からの参照は削除時に一緒に外す。それ以外の参照があれば削除しない
    const refs = findReferences({ ...scenario, events: scenario.events.map((x) => ({ ...x, endsIds: [] })) }, id);
    if (refs.length > 0) {
      setBlocked(`「${name}」は ${refs.join('、')} で参照されているため削除できません。`);
      return;
    }
    if (!window.confirm(`「${name}」を削除しますか？`)) return;
    setBlocked(null);
    store.getState().updateActiveScenario((s) => {
      const next = apply(s);
      return { ...next, events: next.events.map((x) => (x.endsIds.includes(id) ? { ...x, endsIds: x.endsIds.filter((y) => y !== id) } : x)) };
    });
  };

  const flowsOf = (dir: 'income' | 'expense') => scenario.flows.filter((f) => f.direction === dir);
  const tabs: { id: Tab; label: string }[] = [
    { id: 'income', label: `収入（${flowsOf('income').length}）` },
    { id: 'expense', label: `支出（${flowsOf('expense').length}）` },
    { id: 'accounts', label: `資産・負債（${scenario.accounts.length}）` },
    { id: 'transfers', label: `積立・取崩（${scenario.transfers.length}）` },
  ];

  const flowTable = (dir: 'income' | 'expense') => {
    const list = flowsOf(dir);
    const label = dir === 'income' ? '収入' : '支出';
    return (
      <>
        {dir === 'income' && <Banner kind="info">収入は手取り額（税・社会保険料を差し引いた額）で入力してください。</Banner>}
        {list.length === 0 ? (
          <EmptyState title={`まだ${label}が登録されていません`}>
            <p>{dir === 'income' ? '例: 給与 手取り月 30 万円、賞与 6 月・12 月に各 40 万円' : '例: 基本生活費 月 20 万円（物価連動）、保険 月 2 万円'}</p>
          </EmptyState>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>名称</th>
                <th>カテゴリ</th>
                <th>対象者</th>
                <th className="num">金額</th>
                <th className="num">月額換算</th>
                <th className="num">年額換算</th>
                <th>期間</th>
                <th>上昇</th>
                <th>
                  <span className="visually-hidden">操作</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((f) => (
                <tr key={f.id}>
                  <td>{f.name}</td>
                  <td>{categoryLabel(f.category)}</td>
                  <td>{memberName(f.ownerId)}</td>
                  <td className="num">
                    {formatMoney(f.amount, unit)}
                    {f.frequency === 'months' && <div className="muted small">{f.months?.join('・')}月</div>}
                  </td>
                  <td className="num">{formatMoney(Math.round(monthlyEquivalent(f)), unit)}</td>
                  <td className="num">{formatMoney(Math.round(monthlyEquivalent(f) * 12), unit)}</td>
                  <td className="small">
                    {f.start ? describeTrigger(f.start, members) : '開始時'} 〜 {f.end ? describeTrigger(f.end, members, true) : '終了まで'}
                  </td>
                  <td className="small">{f.growth.type === 'none' ? '—' : f.growth.type === 'inflation' ? '物価連動' : formatPercent(f.growth.rate)}</td>
                  <td className="table__actions">
                    <button type="button" className="btn btn--small" onClick={() => setFlow(f)}>
                      編集
                    </button>
                    <button
                      type="button"
                      className="btn btn--small btn--danger"
                      onClick={() => removeWithCheck(f.id, f.name, (s) => ({ ...s, flows: s.flows.filter((x) => x.id !== f.id) }))}
                    >
                      削除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="actions">
          <button type="button" className="btn btn--primary" onClick={() => setFlow({ ...emptyFlowCore(dir), id: newId(), start: null })}>
            {label}を追加
          </button>
        </div>
      </>
    );
  };

  return (
    <div className="page">
      <h1>収入・支出・資産</h1>
      <div className="tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`tab${tab === t.id ? ' tab--active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {blocked && <Banner kind="error">{blocked}</Banner>}
      <section className="card" role="tabpanel">
        {tab === 'income' && flowTable('income')}
        {tab === 'expense' && flowTable('expense')}
        {tab === 'accounts' && (
          <>
            <table className="table">
              <thead>
                <tr>
                  <th>名称</th>
                  <th>種別</th>
                  <th className="num">開始時点残高</th>
                  <th className="num">年率</th>
                  <th>
                    <span className="visually-hidden">操作</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {scenario.accounts.map((a) => (
                  <tr key={a.id}>
                    <td>{a.name}</td>
                    <td>{ACCOUNT_KIND_LABEL[a.kind]}</td>
                    <td className="num">{a.kind === 'loan' ? '−' : ''}{formatMoney(a.openingBalance, unit)}</td>
                    <td className="num">
                      {formatPercent(a.annualRate)}
                      {a.feeRate ? <div className="muted small">手数料 {formatPercent(a.feeRate)}</div> : null}
                    </td>
                    <td className="table__actions">
                      <button type="button" className="btn btn--small" onClick={() => setAccount(a)}>
                        編集
                      </button>
                      {a.kind !== 'cash' && (
                        <button
                          type="button"
                          className="btn btn--small btn--danger"
                          onClick={() => removeWithCheck(a.id, a.name, (s) => ({ ...s, accounts: s.accounts.filter((x) => x.id !== a.id) }))}
                        >
                          削除
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted small">生活口座はすべての収入・支出の入出金先です（世帯で 1 つ）。不動産・車両の購入やローンの借入は「人生イベント」から追加できます。</p>
            <div className="actions">
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => setAccount({ id: newId(), kind: 'investment', name: '', openingBalance: 0, annualRate: scenario.assumptions.defaultReturnRate })}
              >
                口座を追加
              </button>
            </div>
          </>
        )}
        {tab === 'transfers' && (
          <>
            {scenario.transfers.length === 0 ? (
              <EmptyState title="積立・取崩はありません">
                <p>例: 生活口座から投資口座へ毎月 3 万円の積立</p>
              </EmptyState>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>名称</th>
                    <th>振替元 → 振替先</th>
                    <th className="num">金額</th>
                    <th>期間</th>
                    <th>
                      <span className="visually-hidden">操作</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {scenario.transfers.map((t) => (
                    <tr key={t.id}>
                      <td>{t.name}</td>
                      <td>
                        {scenario.accounts.find((a) => a.id === t.fromId)?.name ?? '（不明）'} → {scenario.accounts.find((a) => a.id === t.toId)?.name ?? '（不明）'}
                      </td>
                      <td className="num">
                        {formatMoney(t.amount, unit)}
                        {t.frequency === 'months' && <div className="muted small">{t.months?.join('・')}月</div>}
                      </td>
                      <td className="small">
                        {t.start ? describeTrigger(t.start, members) : '開始時'} 〜 {t.end ? describeTrigger(t.end, members, true) : '終了まで'}
                      </td>
                      <td className="table__actions">
                        <button type="button" className="btn btn--small" onClick={() => setTransfer(t)}>
                          編集
                        </button>
                        <button
                          type="button"
                          className="btn btn--small btn--danger"
                          onClick={() => removeWithCheck(t.id, t.name, (s) => ({ ...s, transfers: s.transfers.filter((x) => x.id !== t.id) }))}
                        >
                          削除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="actions">
              <button
                type="button"
                className="btn btn--primary"
                disabled={transferableAccounts(scenario).length < 2}
                onClick={() =>
                  setTransfer({
                    id: newId(),
                    name: '積立',
                    fromId: scenario.accounts.find((a) => a.kind === 'cash')?.id ?? '',
                    toId: '',
                    amount: NaN,
                    frequency: 'monthly',
                    start: null,
                    end: null,
                    growth: { type: 'none' },
                    growthBase: 'start',
                    growthStepMonth: 1,
                  })
                }
              >
                積立・取崩を追加
              </button>
              {transferableAccounts(scenario).length < 2 && <span className="muted small">先に預金または投資の口座を追加してください。</span>}
            </div>
          </>
        )}
      </section>
      {flow && <FlowDialog initial={flow} scenario={scenario} onClose={() => setFlow(null)} />}
      {account && <AccountDialog initial={account} scenario={scenario} onClose={() => setAccount(null)} />}
      {transfer && <TransferDialog initial={transfer} scenario={scenario} onClose={() => setTransfer(null)} />}
    </div>
  );
}
