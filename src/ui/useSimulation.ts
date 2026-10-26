import { useMemo } from 'react';
import type { Scenario } from '../domain/schema';
import { simulate, type SimOptions, type SimulationResult } from '../engine';

/** シナリオが変わったときだけ再計算する（シナリオのオブジェクト同一性でメモ化） */
export function useSimulation(s: Scenario, opts?: SimOptions): SimulationResult {
  const shiftR = opts?.returnShift ?? 0;
  const shiftI = opts?.inflationShift ?? 0;
  return useMemo(() => simulate(s, { returnShift: shiftR, inflationShift: shiftI }), [s, shiftR, shiftI]);
}

export type OkResult = Extract<SimulationResult, { ok: true }>;
