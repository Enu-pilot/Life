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
