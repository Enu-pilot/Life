// ゴールデンテスト: エンジンの年次結果を独立参照実装（tools/verify/lifeplan_ref.py）の出力と完全一致比較する。
// 期待値はテストを通すために変更しない（test-strategy §1, §10）。
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Scenario } from '../../src/domain/schema';
import { migrate } from '../../src/storage/migrations';
import { simulate } from '../../src/engine';

const DIR = join(__dirname, '../golden');
const cases = readdirSync(DIR)
  .filter((f) => f.endsWith('.scenario.json'))
  .sort();

describe('ゴールデンテスト（独立実装との完全一致）', () => {
  it('ケースが存在する', () => expect(cases.length).toBeGreaterThanOrEqual(4));

  for (const file of cases) {
    it(file.replace('.scenario.json', ''), () => {
      const v1 = JSON.parse(readFileSync(join(DIR, file), 'utf8'));
      // ゴールデンの入力は v1 形式のまま保管し、現行形式へのマイグレーションを通してから計算する
      // （移行後も計算結果が変わらないことの確認を兼ねる）
      const migrated = migrate({ app: 'lifeplan', schemaVersion: 1, savedAt: '', settings: { displayUnit: 'yen' }, activeScenarioId: v1.id, scenarios: [v1] });
      expect(migrated.ok, JSON.stringify(!migrated.ok && migrated)).toBe(true);
      if (!migrated.ok) return;
      const scenario: Scenario = migrated.data.scenarios[0]!;
      const expected = JSON.parse(readFileSync(join(DIR, file.replace('.scenario.json', '.expected.json')), 'utf8'));
      const r = simulate(scenario);
      expect(r.ok, JSON.stringify(r.issues)).toBe(true);
      if (!r.ok) return;
      const actual = r.yearly.map((y) => ({
        year: y.year,
        income: y.income,
        expense: y.expense,
        investmentReturn: y.investmentReturn,
        revaluation: y.revaluation,
        loanPrincipal: y.loanPrincipal,
        cash: y.cash,
        financialAssets: y.financialAssets,
        realAssets: y.realAssets,
        liabilities: y.liabilities,
        netWorth: y.netWorth,
      }));
      expect(actual).toEqual(expected.years);
    });
  }
});
