// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { createAppStore } from '../app/store';
import { Repository } from '../storage/repository';
import { App } from './App';

let seq = 0;
afterEach(() => cleanup());

async function boot(dbName = `ui-${++seq}`) {
  const repo = new Repository(dbName);
  const store = createAppStore(repo, { debounceMs: 0 });
  const view = render(<App store={store} repo={repo} />);
  await screen.findByTestId('save-status');
  return { repo, store, view, dbName };
}

describe('画面の基本操作', () => {
  it('初回は「はじめに」を表示し、ナビゲーションで各画面に移動できる', async () => {
    window.location.hash = '#/';
    await boot();
    expect(screen.getByRole('heading', { name: 'はじめに' })).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('link', { name: 'プロフィール・前提' }));
    expect(await screen.findByRole('heading', { name: 'プロフィール・前提条件' })).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: '設定・計算前提' }));
    expect(await screen.findByRole('heading', { name: '計算前提' })).toBeInTheDocument();
  });

  it('本人の生年月が未入力・不正ならエラーを表示して保存しない', async () => {
    window.location.hash = '#/profile';
    const { store } = await boot();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: '本人を登録' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: '保存' }));
    expect(within(dialog).getAllByText('YYYY-MM 形式で入力してください').length).toBeGreaterThan(0);
    await user.type(within(dialog).getByLabelText(/生年月/), '2099-01');
    await user.click(within(dialog).getByRole('button', { name: '保存' }));
    expect(within(dialog).getAllByText('シミュレーション開始年月以前を入力してください').length).toBeGreaterThan(0);
    expect(store.getState().data!.scenarios[0]!.members).toHaveLength(0);
  });

  it('入力 → 保存 → 再読み込みでデータが保持される', async () => {
    window.location.hash = '#/profile';
    const { store, view, dbName } = await boot();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: '本人を登録' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/生年月/), '1990-05');
    await user.click(within(dialog).getByRole('button', { name: '保存' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('1990年5月')).toBeInTheDocument();

    // 収入を追加（「30万」表記）
    await user.click(screen.getByRole('link', { name: '収入・支出・資産' }));
    await user.click(await screen.findByRole('button', { name: '収入を追加' }));
    const fd = screen.getByRole('dialog');
    await user.type(within(fd).getByLabelText(/名称/), '月給');
    await user.type(within(fd).getByLabelText(/金額/), '30万');
    await user.click(within(fd).getByRole('button', { name: '保存' }));
    expect(await screen.findByText('月給')).toBeInTheDocument();

    await store.getState().flush();
    await waitFor(() => expect(screen.getByTestId('save-status')).toHaveTextContent('保存済み'));
    view.unmount();

    // 再読み込み相当: 同じ DB から新しいストアを起動
    window.location.hash = '#/finances';
    const repo2 = new Repository(dbName);
    const store2 = createAppStore(repo2, { debounceMs: 0 });
    render(<App store={store2} repo={repo2} />);
    expect(await screen.findByText('月給')).toBeInTheDocument();
    expect(store2.getState().data!.scenarios[0]!.flows[0]!.amount).toBe(300000);
    expect(store2.getState().data!.scenarios[0]!.members[0]!.birthYm).toBe('1990-05');
  });

  it('金額に文字を入れるとエラー表示', async () => {
    window.location.hash = '#/finances';
    await boot();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: '収入を追加' }));
    const fd = screen.getByRole('dialog');
    await user.type(within(fd).getByLabelText(/名称/), '給与');
    await user.type(within(fd).getByLabelText(/金額/), 'abc');
    await user.click(within(fd).getByRole('button', { name: '保存' }));
    expect(within(fd).getAllByText('数値を入力してください').length).toBeGreaterThan(0);
  });

  it('前提条件の範囲外の値はエラー', async () => {
    window.location.hash = '#/profile';
    await boot();
    const user = userEvent.setup();
    const endAge = await screen.findByLabelText(/終了年齢/);
    await user.clear(endAge);
    await user.type(endAge, '200');
    await user.click(screen.getByRole('button', { name: '前提条件を保存' }));
    expect(screen.getAllByText(/110|以下/).length).toBeGreaterThan(0);
  });
});

describe('人生イベントの画面', () => {
  async function withSelf() {
    window.location.hash = '#/events';
    const ctx = await boot();
    ctx.store.getState().updateActiveScenario((s) => ({
      ...s,
      assumptions: { ...s.assumptions, startYm: '2027-01', endAge: 60 },
      members: [{ id: 'me', role: 'self', name: '本人', birthYm: '1990-01' }],
      accounts: s.accounts.map((a) => ({ ...a, openingBalance: 10000000 })),
    }));
    return ctx;
  }

  it('一時支出を追加 → タイムラインに表示 → 差分プレビュー → 無効化・削除が結果に反映される', async () => {
    const { store } = await withSelf();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'イベントを追加' }));
    await user.click(screen.getByRole('button', { name: /一時的な収支/ }));
    const dialog = screen.getByRole('dialog');
    // 金額未入力では保存できない
    await user.click(within(dialog).getByRole('button', { name: '保存' }));
    expect(within(dialog).getAllByText('数値を入力してください').length).toBeGreaterThan(0);
    await user.clear(within(dialog).getByLabelText(/^名称/));
    await user.type(within(dialog).getByLabelText(/^名称/), '海外旅行');
    await user.type(within(dialog).getByRole('textbox', { name: /^金額/ }), '50万');
    // 差分プレビュー: 生涯の支出が 50 万円増える
    const preview = await within(dialog).findByRole('region', { name: 'この変更による差分' });
    expect(within(preview).getByText('生涯の支出').closest('tr')).toHaveTextContent('＋50.0万円');
    await user.click(within(dialog).getByRole('button', { name: '保存' }));
    expect(await screen.findByText('海外旅行')).toBeInTheDocument();
    const ev = store.getState().data!.scenarios[0]!.events[0]!;
    expect(ev.type === 'one_time' && ev.params.amount).toBe(500000);

    await user.click(screen.getByRole('button', { name: '海外旅行を無効にする' }));
    expect(store.getState().data!.scenarios[0]!.events[0]!.enabled).toBe(false);
    await user.click(screen.getByRole('button', { name: '海外旅行を有効にする' }));
    expect(store.getState().data!.scenarios[0]!.events[0]!.enabled).toBe(true);

    const confirm = window.confirm;
    window.confirm = () => true;
    await user.click(screen.getByRole('button', { name: '削除' }));
    window.confirm = confirm;
    expect(store.getState().data!.scenarios[0]!.events).toHaveLength(0);
  });

  it('住宅購入: 頭金が物件価格を超えるとエラー', async () => {
    await withSelf();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'イベントを追加' }));
    await user.click(screen.getByRole('button', { name: /住宅購入/ }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^物件価格/), '3000万');
    await user.clear(within(dialog).getByLabelText(/^頭金/));
    await user.type(within(dialog).getByLabelText(/^頭金/), '4000万');
    await user.click(within(dialog).getByRole('button', { name: '保存' }));
    expect(within(dialog).getAllByText('頭金は物件価格以下にしてください').length).toBeGreaterThan(0);
  });
});

describe('シナリオの複製・切り替え・比較', () => {
  it('複製したシナリオを編集しても元は変わらず、比較画面に前提・指標・差分が表示される', async () => {
    window.location.hash = '#/scenarios';
    const { store } = await boot();
    store.getState().updateActiveScenario((s) => ({
      ...s,
      name: '基準',
      assumptions: { ...s.assumptions, startYm: '2027-01', endAge: 70 },
      members: [{ id: 'me', role: 'self', name: '本人', birthYm: '1990-01' }],
      flows: [
        { id: 'in', direction: 'income', name: '給与', category: 'salary', amount: 300000, frequency: 'monthly', start: null, end: null, growth: { type: 'none' }, growthBase: 'start', growthStepMonth: 4 },
        { id: 'out', direction: 'expense', name: '生活費', category: 'living', amount: 250000, frequency: 'monthly', start: null, end: null, growth: { type: 'none' }, growthBase: 'start', growthStepMonth: 1 },
      ],
    }));
    const baseId = store.getState().data!.activeScenarioId;
    const copyId = store.getState().duplicateScenario(baseId, '支出増');
    store.getState().updateScenario(copyId, (s) => ({ ...s, flows: s.flows.map((f) => (f.direction === 'expense' ? { ...f, amount: 280000 } : f)) }));
    const base = store.getState().data!.scenarios.find((s) => s.id === baseId)!;
    expect(base.flows.find((f) => f.direction === 'expense')!.amount).toBe(250000);

    // 切り替えで再計算される（ヘッダのシナリオ選択）
    const user = userEvent.setup();
    await user.selectOptions(screen.getByRole('combobox', { name: '表示中のシナリオ' }), baseId);
    expect(store.getState().data!.activeScenarioId).toBe(baseId);

    window.location.hash = `#/scenarios/compare?ids=${baseId},${copyId}`;
    expect(await screen.findByRole('heading', { name: 'シナリオ比較' })).toBeInTheDocument();
    const metrics = screen.getByTestId('compare-metrics');
    // 終了時の純資産: 月の差 30,000 円 × 計算月数（2027-01〜2060-01 = 397 か月）= 11,910,000 円の差
    // 生涯の支出: 基準 250,000 × 397 = 9,925.0 万円、支出増 280,000 × 397 = 11,116.0 万円
    const lifeRow = within(metrics).getByText('生涯の支出').closest('tr')!;
    expect(lifeRow).toHaveTextContent('9,925.0万円');
    expect(lifeRow).toHaveTextContent('11,116.0万円');
    const table = screen.getByTestId('compare-table');
    const last = within(table).getAllByRole('row').at(-1)!;
    expect(last).toHaveTextContent('−1,191.0万円');
    expect(screen.getByRole('heading', { name: '前提条件と計算期間' })).toBeInTheDocument();
  });

  it('前提条件が異なると警告、2 件未満なら比較しない', async () => {
    window.location.hash = '#/scenarios/compare?ids=nope';
    const { store } = await boot();
    expect(await screen.findByText(/2 件以上選んでください/)).toBeInTheDocument();
    store.getState().updateActiveScenario((s) => ({ ...s, members: [{ id: 'me', role: 'self', name: '本人', birthYm: '1990-01' }] }));
    const a = store.getState().data!.activeScenarioId;
    const b = store.getState().duplicateScenario(a, 'B');
    store.getState().updateScenario(b, (s) => ({ ...s, assumptions: { ...s.assumptions, inflationRate: 0.03 } }));
    window.location.hash = `#/scenarios/compare?ids=${a},${b}`;
    expect(await screen.findByText(/前提条件（物価上昇率）が異なります/)).toBeInTheDocument();
    expect(screen.getByText(/収入・支出が未入力のため/)).toBeInTheDocument();
  });
});

describe('高度な計算モデルの画面', () => {
  it('年金の繰下げ: 70 歳開始で増減率 ＋42% と年額を表示する', async () => {
    window.location.hash = '#/events';
    const { store } = await boot();
    store.getState().updateActiveScenario((s) => ({ ...s, members: [{ id: 'me', role: 'self', name: '本人', birthYm: '1990-01' }] }));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'イベントを追加' }));
    await user.click(screen.getByRole('button', { name: /年金受給/ }));
    const dialog = screen.getByRole('dialog');
    const age = within(dialog).getByLabelText(/受給開始年齢/);
    await user.clear(age);
    await user.type(age, '70');
    await user.type(within(dialog).getByLabelText(/年金額（年額/), '180万');
    expect(within(dialog).getByText(/増減率 ＋42%（60 か月繰下げ） → 年額 255.6万円/)).toBeInTheDocument();
  });

  it('名目・実質の切り替えで年次表の値が変わる（物価 2%）', async () => {
    window.location.hash = '#/projection';
    const { store } = await boot();
    store.getState().updateActiveScenario((s) => ({
      ...s,
      assumptions: { ...s.assumptions, startYm: '2027-01', endAge: 40, inflationRate: 0.02 },
      members: [{ id: 'me', role: 'self', name: '本人', birthYm: '1990-01' }],
      accounts: s.accounts.map((a) => ({ ...a, openingBalance: 10000000 })),
    }));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: '年次表' }));
    expect(screen.getByTestId('nw-2029')).toHaveTextContent('1,000.0万円');
    await user.selectOptions(screen.getByRole('combobox', { name: '名目・実質' }), 'real');
    // 2029-12 は開始から 35 か月後。10,000,000 ÷ 1.02^(35/12) = 9,438,786.56…（Python Decimal）→ 943.9万円
    expect(screen.getByTestId('nw-2029')).toHaveTextContent('943.9万円');
  });
});
