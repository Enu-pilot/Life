// 収支カテゴリ。ID は保存データに入るため変更しないこと（変更する場合はマイグレーションが必要）。

export const INCOME_CATEGORIES = {
  salary: '給与',
  bonus: '賞与',
  business: '事業・副業',
  pension: '年金',
  severance: '退職金',
  allowance: '手当・給付',
  other_income: 'その他収入',
} as const;

export const EXPENSE_CATEGORIES = {
  living: '基本生活費',
  rent: '住居費（家賃）',
  housing: '住居費（管理・税・修繕）',
  utilities: '水道光熱・通信',
  insurance: '保険',
  education: '教育費',
  childcare: '子育て費',
  car: '自動車',
  leisure: '娯楽・旅行',
  medical: '医療・介護',
  event_cost: 'イベント費用',
  loan_interest: 'ローン利息',
  other_expense: 'その他支出',
} as const;

export type IncomeCategory = keyof typeof INCOME_CATEGORIES;
export type ExpenseCategory = keyof typeof EXPENSE_CATEGORIES;
export type Category = IncomeCategory | ExpenseCategory;

export const INCOME_CATEGORY_IDS = Object.keys(INCOME_CATEGORIES) as IncomeCategory[];
export const EXPENSE_CATEGORY_IDS = Object.keys(EXPENSE_CATEGORIES) as ExpenseCategory[];

/** 表示用ラベル。仕訳由来の内部カテゴリも含む。 */
export function categoryLabel(id: string): string {
  return (
    (INCOME_CATEGORIES as Record<string, string>)[id] ??
    (EXPENSE_CATEGORIES as Record<string, string>)[id] ??
    INTERNAL_CATEGORY_LABELS[id] ??
    id
  );
}

export const INTERNAL_CATEGORY_LABELS: Record<string, string> = {
  investment_return: '運用損益',
  interest: '利息',
  revaluation: '評価損益',
  asset_purchase: '資産購入',
  asset_sale: '資産売却',
  loan_draw: '借入',
  loan_principal: 'ローン元本返済',
  transfer: '振替（積立・取崩）',
  auto_liquidation: '自動取り崩し',
};
