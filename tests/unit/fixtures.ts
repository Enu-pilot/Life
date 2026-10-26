// テスト用のシナリオ組み立て補助
import type { Account, AppData, FlowItem, Scenario } from '../../src/domain/schema';

export function scenario(over: Partial<Scenario> = {}): Scenario {
  return {
    id: 'sc1',
    name: 'テスト',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    assumptions: { startYm: '2027-01', endAge: 100, inflationRate: 0, defaultReturnRate: 0, autoLiquidate: false },
    members: [{ id: 'self', role: 'self', name: '本人', birthYm: '1990-01' }],
    accounts: [{ id: 'cash', kind: 'cash', name: '生活口座', openingBalance: 0, annualRate: 0 }],
    flows: [],
    transfers: [],
    events: [],
    ...over,
  };
}

export function appData(scenarios: Scenario[] = [scenario()]): AppData {
  return {
    app: 'lifeplan',
    schemaVersion: 2,
    savedAt: '2026-01-01T00:00:00.000Z',
    settings: { displayUnit: 'man' },
    activeScenarioId: scenarios[0]!.id,
    scenarios,
  };
}

export function flow(over: Partial<FlowItem> & Pick<FlowItem, 'id' | 'amount'>): FlowItem {
  return {
    direction: 'income',
    name: over.id,
    category: over.direction === 'expense' ? 'living' : 'salary',
    frequency: 'monthly',
    start: null,
    end: null,
    growth: { type: 'none' },
    growthBase: 'start',
    growthStepMonth: 1,
    ...over,
  };
}

export function account(over: Partial<Account> & Pick<Account, 'id' | 'kind'>): Account {
  return { name: over.id, openingBalance: 0, annualRate: 0, ...over };
}
