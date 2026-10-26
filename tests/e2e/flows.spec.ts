// 主要操作フロー（ui-design.md §6）の E2E テスト
import { expect, test, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';

/** ファイルを内容で渡す（テスト結果フォルダのパスに日本語が含まれると setInputFiles(path) が反映されないため） */
const asUpload = (path: string, name = 'backup.json') => ({ name, mimeType: 'application/json', buffer: readFileSync(path) });

const nav = (page: Page, name: string) => page.getByRole('navigation').getByRole('link', { name, exact: true }).click();

async function setupSelf(page: Page) {
  await page.goto('/');
  await nav(page, 'プロフィール・前提');
  await page.getByRole('button', { name: '本人を登録' }).click();
  await page.getByRole('dialog').getByLabel(/生年月/).fill('1990-05');
  await page.getByRole('dialog').getByRole('button', { name: '保存' }).click();
  await expect(page.getByText('1990年5月')).toBeVisible();
}

async function metric(page: Page, label: string): Promise<string> {
  await nav(page, 'ダッシュボード');
  const card = page.locator('.stat').filter({ hasText: label });
  return (await card.locator('.stat__value').textContent()) ?? '';
}

test('フロー2: 賃貸 → 住宅購入（家賃を終了）で負債・不動産が現れ、家賃の重複警告が出ない', async ({ page }) => {
  await setupSelf(page);
  await nav(page, '人生イベント');
  await page.getByRole('button', { name: 'イベントを追加' }).click();
  await page.getByRole('button', { name: /賃貸・引っ越し/ }).click();
  let d = page.getByRole('dialog');
  await d.getByLabel(/家賃（月額）/).fill('10万');
  await d.getByRole('button', { name: '保存' }).click();
  await expect(page.getByText('賃貸・引っ越し').first()).toBeVisible();

  await page.getByRole('button', { name: 'イベントを追加' }).click();
  await page.getByRole('button', { name: /住宅購入/ }).click();
  d = page.getByRole('dialog');
  await d.getByLabel(/^物件価格/).fill('3000万');
  await d.getByLabel(/^頭金/).fill('500万');
  await d.getByLabel(/イベント「賃貸・引っ越し」の継続的な収支/).check();
  // 差分プレビューが出る
  await expect(d.getByRole('region', { name: 'この変更による差分' })).toBeVisible();
  await d.getByRole('button', { name: '保存' }).click();
  await expect(page.getByText(/物件 3,000.0万円・借入 2,500.0万円/)).toBeVisible();
  await expect(page.getByText(/重複しています/)).toHaveCount(0);

  await nav(page, '資産推移');
  await page.getByRole('tab', { name: '年次表' }).click();
  const table = page.getByTestId('year-table');
  // 購入年（開始の翌年）の行: 負債が 0 より大きい
  const rows = table.locator('tbody tr');
  await expect(rows.nth(1)).toContainText('万円');
  const liab = await rows.nth(1).locator('td').nth(10).textContent();
  expect(liab).not.toBe('0.0万円');
});

test('フロー3: 複製 → 利回り変更 → 比較画面に 2 本の推移と差分', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'サンプルデータで試す' }).click();
  await nav(page, 'シナリオ');
  page.once('dialog', (dlg) => dlg.accept('利回り5%'));
  await page.getByRole('button', { name: '表示中のシナリオを複製' }).click();
  await nav(page, '収入・支出・資産');
  await page.getByRole('tab', { name: /資産・負債/ }).click();
  await page.getByRole('row', { name: /NISA/ }).getByRole('button', { name: '編集' }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel(/期待利回り/).fill('5');
  await d.getByRole('button', { name: '保存' }).click();
  await nav(page, 'シナリオ');
  await page.getByLabel('比較する').nth(1).check();
  await page.getByLabel('比較する').nth(2).check();
  await page.getByRole('button', { name: /件を比較/ }).click();
  await expect(page.getByRole('heading', { name: 'シナリオ比較' })).toBeVisible();
  const last = page.getByTestId('compare-table').locator('tbody tr').last();
  await expect(last).toContainText('＋');
  await expect(page.getByTestId('compare-metrics')).toContainText('利回り5%');
});

test('フロー4: エクスポート → 全削除 → インポートで元と同じ結果', async ({ page }, info) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'サンプルデータで試す' }).click();
  const before = await metric(page, '65歳の年末の純資産');
  expect(before).toMatch(/万円/);

  await nav(page, 'データ管理');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'エクスポート' }).click()]);
  const file = info.outputPath('backup.json');
  await download.saveAs(file);
  expect(download.suggestedFilename()).toMatch(/^lifeplan-backup-\d{8}-\d{4}\.json$/);
  const json = JSON.parse(readFileSync(file, 'utf8'));
  expect(json.kind).toBe('lifeplan-backup');
  expect(json.notice).toContain('個人情報');

  await page.getByLabel('削除の確認入力').fill('削除');
  await page.getByRole('button', { name: '全データを削除' }).click();
  await expect(page.getByText('全データを削除しました')).toBeVisible();
  // 初期状態に戻っている（本人未登録の「はじめに」）
  await nav(page, 'ダッシュボード');
  await expect(page.getByRole('heading', { name: 'はじめに' })).toBeVisible();

  await nav(page, 'データ管理');
  await page.getByLabel('インポートするファイル').setInputFiles(asUpload(file, 'バックアップ.json'));
  const dlg = page.getByRole('dialog', { name: 'インポートの確認' });
  await expect(dlg).toContainText('サンプル（架空の世帯）');
  await dlg.getByRole('button', { name: '現在のデータを置き換える' }).click();
  await expect(page.getByText('インポートしました')).toBeVisible();
  // 表示中のシナリオをサンプルにして比較
  await page.locator('header select').selectOption({ label: 'サンプル（架空の世帯）' });
  expect(await metric(page, '65歳の年末の純資産')).toBe(before);
  // 再読み込み後も保持
  await page.reload();
  expect(await metric(page, '65歳の年末の純資産')).toBe(before);
});

test('不正・破損ファイルは拒否し、既存データを変更しない', async ({ page }, info) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'サンプルデータで試す' }).click();
  const before = await metric(page, '65歳の年末の純資産');
  await nav(page, 'データ管理');
  const broken = info.outputPath('broken.json');
  writeFileSync(broken, '{"kind":"lifeplan-backup","fileVersion":1,"data":{"app":"lifeplan","schemaVersion":2,"scenarios":[{"id":1}]}}');
  await page.getByLabel('インポートするファイル').setInputFiles(asUpload(broken));
  await expect(page.getByText(/読み込めませんでした（項目の検証）/)).toBeVisible();
  await expect(page.getByText('現在のデータは変更されていません。')).toBeVisible();
  const notJson = info.outputPath('x.json');
  writeFileSync(notJson, 'not json');
  await page.getByLabel('インポートするファイル').setInputFiles(asUpload(notJson));
  await expect(page.getByText(/読み込めませんでした（ファイル形式）/)).toBeVisible();
  expect(await metric(page, '65歳の年末の純資産')).toBe(before);
});

test('フロー5: イベントを無効化すると結果が変わり、再度有効化すると元に戻る', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'サンプルデータで試す' }).click();
  const before = await metric(page, '計算終了時の純資産');
  await nav(page, '人生イベント');
  await page.getByRole('button', { name: '家族旅行を無効にする' }).click();
  const off = await metric(page, '計算終了時の純資産');
  expect(off).not.toBe(before);
  await nav(page, '人生イベント');
  await page.getByRole('button', { name: '家族旅行を有効にする' }).click();
  expect(await metric(page, '計算終了時の純資産')).toBe(before);
});

test('入力エラーの表示と、グラフ・年次表の表示', async ({ page }) => {
  await setupSelf(page);
  await nav(page, '収入・支出・資産');
  await page.getByRole('button', { name: '収入を追加' }).click();
  const d = page.getByRole('dialog');
  await d.getByRole('button', { name: '保存' }).click();
  await expect(d.getByText('名称を入力してください').first()).toBeVisible();
  await expect(d.getByText('数値を入力してください').first()).toBeVisible();
  await d.getByRole('button', { name: 'キャンセル' }).click();
  await nav(page, 'ダッシュボード');
  await nav(page, '資産推移');
  await expect(page.getByRole('img', { name: /資産推移のグラフ/ })).toBeVisible();
  await expect(page.locator('.recharts-surface').first()).toBeVisible();
});
