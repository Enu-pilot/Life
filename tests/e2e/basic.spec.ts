import { expect, test } from '@playwright/test';

test('入力 → 自動保存 → 再読み込みでデータが保持される（IndexedDB）', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'はじめに' })).toBeVisible();

  await page.getByRole('link', { name: 'プロフィール・前提' }).click();
  await page.getByRole('button', { name: '本人を登録' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/生年月/).fill('1990-05');
  await dialog.getByRole('button', { name: '保存' }).click();
  await expect(page.getByText('1990年5月')).toBeVisible();

  await page.getByRole('link', { name: '収入・支出・資産' }).click();
  await page.getByRole('button', { name: '収入を追加' }).click();
  await page.getByRole('dialog').getByLabel(/名称/).fill('月給');
  await page.getByRole('dialog').getByLabel(/金額/).fill('30万');
  await page.getByRole('dialog').getByRole('button', { name: '保存' }).click();
  await expect(page.getByRole('cell', { name: '月給' })).toBeVisible();

  await expect(page.getByTestId('save-status')).toHaveText('保存済み ✓');
  await page.reload();
  await page.getByRole('link', { name: '収入・支出・資産' }).click();
  await expect(page.getByRole('cell', { name: '月給' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '30.0万円' }).first()).toBeVisible();
});

test('外部への通信を行わない', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.hostname !== 'localhost' && u.protocol !== 'data:' && u.protocol !== 'blob:') external.push(r.url());
  });
  await page.goto('/');
  await page.getByRole('link', { name: 'プロフィール・前提' }).click();
  await page.getByRole('link', { name: 'ダッシュボード' }).click();
  expect(external).toEqual([]);
});
