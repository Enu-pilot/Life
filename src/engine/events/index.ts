// 人生イベントの展開器（calculation-spec §17）。
// 生成物はイベント ID を接頭辞とする決定的な ID を持ち、計算のたびに作り直す（保存データには書き戻さない）。

import { EDUCATION_DEFAULTS, UNIVERSITY_ENTRANCE_DEFAULTS } from '../../domain/education';
import { roundYen } from '../../domain/money';
import type { Growth, LoanTerms } from '../../domain/schema';
import { monthIndexOf, STAGE_YEARS, stageEntry, yearOf, type MonthIndex, type SchoolStage } from '../../domain/time';
import { amountAt } from '../growth';
import { EXTERNAL } from '../types';
import { registerExpander, type ExpandApi } from './registry';

/** 開始時点の価格で入力された一時金の、発生月の金額（物価連動時） */
function priceAt(api: ExpandApi, amount: number, growth: Growth, m: MonthIndex): number {
  return roundYen(amountAt({ amount, growth, growthBase: api.ctx.start, growthStepMonth: 1 }, m, api.ctx.inflationRate));
}

function oneTimeCash(api: ExpandApi, key: string, direction: 'income' | 'expense', amount: number, category: string, name: string, month = api.month, endable = false) {
  if (amount <= 0) return;
  api.addOneTime({
    ...(endable ? { endable: true } : {}),
    kind: 'post',
    key,
    month,
    type: direction,
    from: direction === 'income' ? EXTERNAL : api.cashId,
    to: direction === 'income' ? api.cashId : EXTERNAL,
    amount,
    category,
    name,
  });
}

function addLoan(api: ExpandApi, accountId: string, name: string, amount: number, toAccount: string, drawMonth: MonthIndex, terms: LoanTerms, key: string) {
  if (amount <= 0) return;
  api.addAccount({ id: accountId, kind: 'loan', name, opening: 0, annualRate: terms.annualRate });
  api.addOneTime({ kind: 'post', key, month: drawMonth, type: 'loan_draw', from: accountId, to: toAccount, amount, category: 'loan_draw', name });
  const firstPayment = drawMonth + 1; // 借入の翌月から返済
  api.addLoan({
    accountId,
    name,
    firstPayment,
    termMonths: terms.termMonths,
    method: terms.method,
    annualRate: terms.annualRate,
    rateChanges: terms.rateChanges.map((c) => ({ month: firstPayment + c.afterMonths, annualRate: c.annualRate })).sort((a, b) => a.month - b.month),
  });
}

registerExpander('one_time', (e, api) => {
  const p = e.params;
  oneTimeCash(api, 'main', p.direction, priceAt(api, p.amount, p.growth, api.month), p.category, e.name);
});

registerExpander('flow_change', (e, api) => {
  e.params.flows.forEach((f) => api.addTemplate(f));
});

registerExpander('job', (e, api) => {
  oneTimeCash(api, 'cost', 'expense', e.params.cost, 'event_cost', `${e.name}（費用）`);
  e.params.flows.forEach((f) => api.addTemplate(f));
});

registerExpander('retirement', (e, api) => {
  oneTimeCash(api, 'severance', 'income', e.params.severance, 'severance', `${e.name}（退職金）`);
  e.params.flows.forEach((f) => api.addTemplate(f));
});

registerExpander('marriage', (e, api) => {
  oneTimeCash(api, 'cost', 'expense', e.params.cost, 'event_cost', `${e.name}（費用）`);
  e.params.flows.forEach((f) => api.addTemplate(f));
});

registerExpander('birth', (e, api) => {
  oneTimeCash(api, 'cost', 'expense', e.params.cost, 'event_cost', `${e.name}（出産費用）`);
  e.params.flows.forEach((f) => api.addTemplate(f));
});

registerExpander('education', (e, api) => {
  const p = e.params;
  const birth = api.ctx.births.get(p.memberId);
  if (birth === undefined) {
    api.warn('MEMBER_UNRESOLVED', '対象の子が見つかりません');
    return;
  }
  const stages: [SchoolStage, string][] = [
    ['kindergarten', p.kindergarten],
    ['elementary', p.elementary],
    ['junior', p.junior],
    ['high', p.high],
    ['university', p.university],
  ];
  for (const [stage, course] of stages) {
    if (course === 'none') continue;
    const key = `${stage}:${course}`;
    const annual = p.overrides[key] ?? EDUCATION_DEFAULTS[key]?.annual;
    if (annual === undefined) continue;
    const entry = stageEntry(birth, stage);
    api.addFlow({
      key,
      name: `${e.name}（${stage === 'kindergarten' ? '幼稚園' : stage === 'elementary' ? '小学校' : stage === 'junior' ? '中学校' : stage === 'high' ? '高校' : '大学'}）`,
      direction: 'expense',
      category: 'education',
      from: entry,
      to: entry + STAGE_YEARS[stage] * 12 - 1,
      amount: annual / 12, // 年額を月割り（丸めは計上時）
      months: null,
      growth: p.growth,
      growthBase: api.ctx.start,
      growthStepMonth: 1,
    });
    if (stage === 'university') {
      const ekey = `university_entrance:${course}`;
      const entrance = p.overrides[ekey] ?? UNIVERSITY_ENTRANCE_DEFAULTS[course]?.amount ?? 0;
      oneTimeCash(api, 'entrance', 'expense', priceAt(api, entrance, p.growth, entry), 'education', `${e.name}（大学入学費用）`, entry);
    }
  }
});

registerExpander('rent', (e, api) => {
  const p = e.params;
  const to = p.end ? api.resolveEnd(p.end) : api.ctx.end;
  const rule = { amount: p.monthlyRent, growth: p.growth, growthBase: api.ctx.start, growthStepMonth: 1 };
  api.addFlow({ key: 'rent', name: `${e.name}（家賃）`, direction: 'expense', category: 'rent', from: api.month, to, months: null, ...rule });
  oneTimeCash(api, 'initial', 'expense', p.initialCost, 'event_cost', `${e.name}（入居時費用）`);
  if (p.renewalFee > 0 && p.renewalIntervalYears > 0) {
    for (let k = 1, m = api.month + 12 * p.renewalIntervalYears; m <= to; k++, m += 12 * p.renewalIntervalYears) {
      const fee = roundYen(amountAt({ ...rule, amount: p.renewalFee }, m, api.ctx.inflationRate));
      oneTimeCash(api, `renewal${String(k).padStart(2, '0')}`, 'expense', fee, 'rent', `${e.name}（更新料）`, m, true);
    }
  }
});

registerExpander('home_purchase', (e, api) => {
  const p = e.params;
  if (p.downPayment > p.price) {
    api.warn('INVALID_PARAMS', '頭金が物件価格を超えているため計算に含めません');
    return;
  }
  const propId = `${e.id}:property`;
  api.addAccount({ id: propId, kind: 'property', name: `${e.name}（不動産）`, opening: 0, annualRate: p.revaluationRate });
  // 頭金（現金 → 不動産）、借入（ローン → 不動産）、諸費用（支出）。物件価格 = 頭金 + 借入額
  api.addOneTime({ kind: 'post', key: 'a-down', month: api.month, type: 'asset_purchase', from: api.cashId, to: propId, amount: p.downPayment, category: 'asset_purchase', name: `${e.name}（頭金）` });
  addLoan(api, `${e.id}:loan`, `${e.name}（住宅ローン）`, p.price - p.downPayment, propId, api.month, p.loan, 'b-draw');
  oneTimeCash(api, 'c-costs', 'expense', p.closingCosts, 'housing', `${e.name}（諸費用）`);
  if (p.maintenanceMonthly > 0) {
    api.addFlow({
      key: 'maintenance',
      name: `${e.name}（管理費・修繕積立金）`,
      direction: 'expense',
      category: 'housing',
      from: api.month,
      to: api.ctx.end,
      amount: p.maintenanceMonthly,
      months: null,
      growth: p.maintenanceGrowth,
      growthBase: api.ctx.start,
      growthStepMonth: 1,
    });
  }
  if (p.propertyTaxYearly > 0) {
    // 1 月 1 日時点の所有者に課税されるため、購入翌年の 4 月から毎年 4 月に計上
    api.addFlow({
      key: 'property_tax',
      name: `${e.name}（固定資産税等）`,
      direction: 'expense',
      category: 'housing',
      from: monthIndexOf(yearOf(api.month) + 1, 4),
      to: api.ctx.end,
      amount: p.propertyTaxYearly,
      months: [4],
      growth: { type: 'none' },
      growthBase: api.ctx.start,
      growthStepMonth: 1,
    });
  }
});

registerExpander('car', (e, api) => {
  const p = e.params;
  const vehId = `${e.id}:vehicle`;
  const saleMonth = p.holdUntil ? api.resolveStart(p.holdUntil) : null;
  const lastMonth = saleMonth !== null ? Math.min(saleMonth - 1, api.ctx.end) : api.ctx.end;
  api.addAccount({ id: vehId, kind: 'vehicle', name: `${e.name}（車両）`, opening: 0, annualRate: p.depreciationRate });
  const count = p.cycleYears > 0 ? p.purchaseCount : 1;
  for (let k = 0; k < count; k++) {
    const m = api.month + k * p.cycleYears * 12;
    if (m > lastMonth) break;
    const tag = `k${String(k).padStart(2, '0')}`;
    const price = priceAt(api, p.price, p.priceGrowth, m);
    if (k > 0) {
      // 買い替え: 前の車両を評価額で売却してから購入する
      api.addOneTime({ kind: 'sellAll', key: `${tag}-1sell`, month: m, accountId: vehId, to: api.cashId, category: 'asset_sale', name: `${e.name}（売却）` });
    }
    if (p.loan) {
      const down = Math.min(p.downPayment, price);
      api.addOneTime({ kind: 'post', key: `${tag}-2down`, month: m, type: 'asset_purchase', from: api.cashId, to: vehId, amount: down, category: 'asset_purchase', name: `${e.name}（購入・頭金）` });
      addLoan(api, `${e.id}:loan${k}`, `${e.name}（自動車ローン${k + 1}台目）`, price - down, vehId, m, p.loan, `${tag}-3draw`);
    } else {
      api.addOneTime({ kind: 'post', key: `${tag}-2buy`, month: m, type: 'asset_purchase', from: api.cashId, to: vehId, amount: price, category: 'asset_purchase', name: `${e.name}（購入）` });
    }
  }
  if (p.maintenanceYearly > 0) {
    api.addFlow({
      key: 'maintenance',
      name: `${e.name}（維持費）`,
      direction: 'expense',
      category: 'car',
      from: api.month,
      to: lastMonth,
      amount: p.maintenanceYearly / 12,
      months: null,
      growth: p.maintenanceGrowth,
      growthBase: api.ctx.start,
      growthStepMonth: 1,
    });
  }
  if (saleMonth !== null && saleMonth <= api.ctx.end) {
    api.addOneTime({ kind: 'sellAll', key: 'z-final-sell', month: saleMonth, accountId: vehId, to: api.cashId, category: 'asset_sale', name: `${e.name}（売却）` });
  }
});

registerExpander('pension', (e, api) => {
  const p = e.params;
  if (!api.ctx.births.has(p.memberId)) {
    api.warn('MEMBER_UNRESOLVED', '受給者が見つかりません');
    return;
  }
  api.addFlow({
    key: 'pension',
    name: e.name,
    direction: 'income',
    category: 'pension',
    from: api.month,
    to: api.ctx.end,
    amount: p.annualAmount / 12, // 年額を月割り（丸めは計上時）
    months: null,
    growth: p.slideRate === 0 ? { type: 'none' } : { type: 'fixed', rate: p.slideRate },
    growthBase: api.ctx.start,
    growthStepMonth: 4,
  });
});
