// イベント種別の表示名・説明・初期値（テンプレート）
import { newId } from '../../domain/factory';
import type { EventType, FlowTemplate, LifeEvent, Scenario, Trigger } from '../../domain/schema';
import { formatYm, parseYm } from '../../domain/time';

export const EVENT_META: Record<EventType, { label: string; icon: string; desc: string }> = {
  job: { label: '就職・転職・独立', icon: '💼', desc: '給与・事業収入の変更、開業費など' },
  retirement: { label: '退職', icon: '🎓', desc: '退職金、給与の終了、再雇用' },
  marriage: { label: '結婚', icon: '💍', desc: '配偶者の追加、結婚費用、収入・生活費の変化' },
  birth: { label: '出産', icon: '👶', desc: '子の追加、出産費用、子育て費・手当' },
  education: { label: '教育費', icon: '🏫', desc: '幼稚園〜大学の公立・私立コース' },
  rent: { label: '賃貸・引っ越し', icon: '🏢', desc: '家賃・更新料・入居時費用' },
  home_purchase: { label: '住宅購入', icon: '🏠', desc: '頭金・住宅ローン・諸費用・固定資産税' },
  car: { label: '自動車', icon: '🚗', desc: '購入・買い替え・維持費・自動車ローン' },
  pension: { label: '年金受給', icon: '🧓', desc: '受給開始年齢と年額' },
  one_time: { label: '一時的な収支', icon: '✈️', desc: '旅行・大型支出・臨時収入' },
  flow_change: { label: '収支の変更', icon: '📈', desc: '昇給・老後の生活費・その他の継続的な変化' },
};

export const EVENT_ORDER: EventType[] = ['job', 'marriage', 'birth', 'education', 'rent', 'home_purchase', 'car', 'retirement', 'pension', 'one_time', 'flow_change'];

export function newTemplate(direction: 'income' | 'expense', category: string, name: string, amount = NaN): FlowTemplate {
  return {
    key: newId().slice(0, 8),
    direction,
    name,
    category,
    amount,
    frequency: 'monthly',
    end: null,
    growth: { type: 'none' },
    growthBase: 'itemStart',
    growthStepMonth: category === 'salary' || category === 'bonus' ? 4 : 1,
  };
}

/** 既定の発生年月: 開始年月の 1 年後 */
function defaultYm(s: Scenario): string {
  return formatYm(parseYm(s.assumptions.startYm) + 12);
}

export function newEvent(type: EventType, s: Scenario): LifeEvent {
  const self = s.members.find((m) => m.role === 'self');
  const selfId = self?.id ?? '';
  const date: Trigger = { type: 'date', ym: defaultYm(s) };
  const base = { id: newId(), name: EVENT_META[type].label, enabled: true, endsIds: [] as string[] };
  switch (type) {
    case 'one_time':
      return { ...base, type, trigger: date, params: { direction: 'expense', amount: NaN, category: 'leisure', growth: { type: 'none' } } };
    case 'flow_change':
      return { ...base, type, trigger: date, params: { flows: [newTemplate('expense', 'living', '生活費の変化')] } };
    case 'job':
      return { ...base, type, trigger: date, params: { subtype: 'change', cost: 0, flows: [newTemplate('income', 'salary', '新しい給与')] } };
    case 'retirement':
      return { ...base, type, trigger: { type: 'age', memberId: selfId, age: 60 }, params: { severance: 0, flows: [] } };
    case 'marriage':
      return { ...base, type, trigger: date, params: { spouseName: '配偶者', spouseBirthYm: '', cost: 0, flows: [] } };
    case 'birth':
      return { ...base, type, name: '第一子の誕生', trigger: date, params: { childName: '子', cost: 0, flows: [] } };
    case 'education': {
      const child = s.members.find((m) => m.role === 'child')?.id ?? s.events.find((e) => e.type === 'birth')?.id;
      const memberId = child ? (s.members.some((m) => m.id === child) ? child : `${child}:child`) : '';
      return {
        ...base,
        type,
        trigger: { type: 'school', memberId, stage: 'kindergarten' },
        params: { memberId, kindergarten: 'public', elementary: 'public', junior: 'public', high: 'public', university: 'national', overrides: {}, growth: { type: 'none' } },
      };
    }
    case 'rent':
      return { ...base, type, trigger: { type: 'date', ym: s.assumptions.startYm }, params: { monthlyRent: NaN, renewalFee: 0, renewalIntervalYears: 2, initialCost: 0, growth: { type: 'none' }, end: null } };
    case 'home_purchase':
      return {
        ...base,
        type,
        trigger: date,
        params: {
          price: NaN,
          downPayment: 0,
          closingCosts: 0,
          loan: { annualRate: 0.01, termMonths: 420, method: 'equal_payment', rateChanges: [] },
          propertyTaxYearly: 0,
          maintenanceMonthly: 0,
          maintenanceGrowth: { type: 'none' },
          revaluationRate: 0,
        },
      };
    case 'car':
      return {
        ...base,
        type,
        trigger: date,
        params: {
          price: NaN,
          priceGrowth: { type: 'none' },
          downPayment: 0,
          loan: null,
          cycleYears: 0,
          purchaseCount: 1,
          maintenanceYearly: 0,
          maintenanceGrowth: { type: 'none' },
          depreciationRate: -0.15,
          holdUntil: null,
        },
      };
    case 'pension':
      return { ...base, type, trigger: { type: 'age', memberId: selfId, age: 65 }, params: { memberId: selfId, annualAmount: NaN, slideRate: 0 } };
  }
}
