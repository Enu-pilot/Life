// ランダムシナリオを Python 独立参照実装と突き合わせる（test-strategy §9）
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { simulate } from '../../src/engine';
import { scenarioArb } from './arbitraries';

const SCRIPT = join(__dirname, '../../tools/verify/run_batch.py');

describe('独立実装とのクロスチェック（ランダム 40 シナリオ）', () => {
  it('年次の収入・支出・運用損益・評価損益・元本返済・残高が完全一致', () => {
    const scenarios = fc.sample(scenarioArb, { numRuns: 40, seed: 42 }).filter((s) => simulate(s).ok);
    expect(scenarios.length).toBeGreaterThan(20);
    const out = execFileSync('python3', ['-I', SCRIPT], { input: JSON.stringify(scenarios), maxBuffer: 64 * 1024 * 1024 }).toString();
    const expected = JSON.parse(out) as unknown[][];
    scenarios.forEach((s, i) => {
      const r = simulate(s);
      if (!r.ok) throw new Error('unreachable');
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
      expect(actual, `シナリオ ${i}: ${JSON.stringify(s)}`).toEqual(expected[i]);
    });
  }, 120_000);
});
