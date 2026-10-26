// 不変条件のプロパティテスト（test-strategy §9, calculation-spec §5.2）
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { simulate } from '../../src/engine';
import { checkInvariants, scenarioArb } from './arbitraries';

describe('プロパティテスト（ランダムシナリオで不変条件を検査）', () => {
  it('全月で残高恒等式・純資産恒等式・集計の整合・非負制約が成立', () => {
    fc.assert(
      fc.property(scenarioArb, (s) => {
        const r = simulate(s);
        if (!r.ok) return true; // 検証エラーは別テストで扱う
        const errs = checkInvariants(r);
        if (errs.length > 0) throw new Error(errs.slice(0, 5).join('\n'));
        return true;
      }),
      { numRuns: 150, seed: 20261026 },
    );
  });
  it('決定性: 同じシナリオを 2 回計算すると完全一致', () => {
    fc.assert(
      fc.property(scenarioArb, (s) => {
        expect(simulate(s)).toEqual(simulate(structuredClone(s)));
      }),
      { numRuns: 30, seed: 7 },
    );
  });
});
