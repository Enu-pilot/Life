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
