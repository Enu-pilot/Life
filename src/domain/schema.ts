// 保存データのスキーマ（architecture.md §5）。型はスキーマから導出する。
// スキーマを変更したら CURRENT_SCHEMA_VERSION を上げ、src/storage/migrations にマイグレーションを追加すること。

import { z } from 'zod';
import { EXPENSE_CATEGORY_IDS, INCOME_CATEGORY_IDS } from './categories';
import { isYearMonth } from './time';

export const CURRENT_SCHEMA_VERSION = 2;

export const LIMITS = {
  maxYen: 100_000_000_000, // 1,000 億円
  minRate: -0.5,
  maxRate: 0.5,
  warnRate: 0.15,
  minEndAge: 60,
  maxEndAge: 110,
  maxLoanMonths: 600,
  maxNameLength: 40,
  maxMemoLength: 1000,
} as const;

export const idSchema = z.string().min(1).max(200);
export const ymSchema = z.string().refine(isYearMonth, { message: 'YYYY-MM 形式で入力してください' });
export const yenSchema = z
  .number({ message: '数値を入力してください' })
  .int({ message: '円単位の整数で入力してください' })
  .min(0, { message: '0 以上で入力してください' })
  .max(LIMITS.maxYen, { message: '1,000 億円以下で入力してください' });
export const rateSchema = z
  .number({ message: '数値を入力してください' })
  .min(LIMITS.minRate, { message: '-50% 以上で入力してください' })
  .max(LIMITS.maxRate, { message: '50% 以下で入力してください' });
const nameSchema = z.string().max(LIMITS.maxNameLength, { message: `${LIMITS.maxNameLength} 文字以内で入力してください` });
const monthNumSchema = z.number().int().min(1).max(12);

// ---- トリガー（calculation-spec §2.4） ----

export const stageSchema = z.enum(['kindergarten', 'elementary', 'junior', 'high', 'university']);

export const triggerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('date'), ym: ymSchema }),
  z.object({
    type: z.literal('age'),
    memberId: idSchema,
    age: z.number().int().min(0).max(120),
    /** 指定時は「age 歳である期間中の指定月」 */
    month: monthNumSchema.optional(),
    /** 終了指定に使う場合の解釈（Q-04）。before = age 歳になる前月まで / through = age 歳の間も含む */
    endMode: z.enum(['before', 'through']).optional(),
  }),
  z.object({
    type: z.literal('school'),
    memberId: idSchema,
    stage: stageSchema,
  }),
]);
export type Trigger = z.infer<typeof triggerSchema>;

// ---- 成長率 ----

export const growthSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }),
  z.object({ type: z.literal('inflation') }),
  z.object({ type: z.literal('fixed'), rate: rateSchema }),
]);
export type Growth = z.infer<typeof growthSchema>;

const categorySchema = z.enum([...INCOME_CATEGORY_IDS, ...EXPENSE_CATEGORY_IDS] as [string, ...string[]]);

const flowCoreShape = {
  direction: z.enum(['income', 'expense']),
  name: nameSchema,
  category: categorySchema,
  ownerId: idSchema.optional(),
  amount: yenSchema,
  /** monthly: 毎月 / months: 指定月（毎年） */
  frequency: z.enum(['monthly', 'months']),
  months: z.array(monthNumSchema).max(12).optional(),
  end: triggerSchema.nullable(),
  growth: growthSchema,
  /** 金額がどの時点の価格か。start = シミュレーション開始時点 / itemStart = 項目の開始時点 */
  growthBase: z.enum(['start', 'itemStart']),
  growthStepMonth: monthNumSchema,
  /**
   * v2: 額面入力の簡易推計。指定時は amount を額面とみなし、amount × netRatio を手取りとして計上する（収入のみ）。
   * 税・社会保険の制度計算ではなく、利用者が入力した手取り率による簡易推計。
   */
  netRatio: z.number().gt(0, { message: '0% より大きくしてください' }).max(1, { message: '100% 以下にしてください' }).optional(),
};

/** 定常収支項目（calculation-spec §8.1）。start = null はシミュレーション開始から。 */
export const flowItemSchema = z.object({
  id: idSchema,
  ...flowCoreShape,
  start: triggerSchema.nullable(),
});
export type FlowItem = z.infer<typeof flowItemSchema>;

/** イベントが生成する収支のテンプレート（開始 = イベント発生月）。 */
export const flowTemplateSchema = z.object({
  key: idSchema,
  ...flowCoreShape,
});
export type FlowTemplate = z.infer<typeof flowTemplateSchema>;

// ---- 世帯・口座 ----

export const memberSchema = z.object({
  id: idSchema,
  role: z.enum(['self', 'spouse', 'child']),
  name: nameSchema,
  birthYm: ymSchema,
});
export type Member = z.infer<typeof memberSchema>;

export const accountKindSchema = z.enum(['cash', 'savings', 'investment', 'property', 'vehicle', 'other_asset', 'loan']);
export type AccountKind = z.infer<typeof accountKindSchema>;

export const loanMethodSchema = z.enum(['equal_payment', 'equal_principal']);

export const accountSchema = z.object({
  id: idSchema,
  kind: accountKindSchema,
  name: nameSchema,
  /** 開始時点残高（負債は正の残高） */
  openingBalance: yenSchema,
  /** 運用利回り（税引後）/ 預金金利 / 評価額変動率 / ローン金利（年率） */
  annualRate: rateSchema,
  /** v2: 投資の年間手数料率（信託報酬など）。実質利回り = annualRate − feeRate */
  feeRate: z.number().min(0).max(0.1, { message: '10% 以下にしてください' }).optional(),
  /** 負債のみ: 残り返済回数と返済方式 */
  loan: z
    .object({
      remainingMonths: z.number().int().min(1).max(LIMITS.maxLoanMonths),
      method: loanMethodSchema,
    })
    .optional(),
});
export type Account = z.infer<typeof accountSchema>;

export const transferRuleSchema = z.object({
  id: idSchema,
  name: nameSchema,
  fromId: idSchema,
  toId: idSchema,
  amount: yenSchema,
  frequency: z.enum(['monthly', 'months']),
  months: z.array(monthNumSchema).max(12).optional(),
  start: triggerSchema.nullable(),
  end: triggerSchema.nullable(),
  growth: growthSchema,
  growthBase: z.enum(['start', 'itemStart']),
  growthStepMonth: monthNumSchema,
});
export type TransferRule = z.infer<typeof transferRuleSchema>;

// ---- 人生イベント（calculation-spec §8、requirements §5.3） ----

const loanTermsSchema = z.object({
  annualRate: rateSchema,
  termMonths: z.number().int().min(1).max(LIMITS.maxLoanMonths),
  method: loanMethodSchema,
  /** 金利変更（変動金利の簡易表現）。afterMonths = 初回返済月からの経過月数 */
  rateChanges: z
    .array(z.object({ afterMonths: z.number().int().min(1).max(LIMITS.maxLoanMonths), annualRate: rateSchema }))
    .max(20),
});
export type LoanTerms = z.infer<typeof loanTermsSchema>;

const flowsSchema = z.array(flowTemplateSchema).max(30);

export const eventParamsSchemas = {
  one_time: z.object({
    direction: z.enum(['income', 'expense']),
    amount: yenSchema,
    category: categorySchema,
    growth: z.discriminatedUnion('type', [z.object({ type: z.literal('none') }), z.object({ type: z.literal('inflation') })]),
  }),
  flow_change: z.object({ flows: flowsSchema }),
  job: z.object({
    subtype: z.enum(['employment', 'change', 'independence']),
    /** 開業費・転職費用など（支出） */
    cost: yenSchema,
    flows: flowsSchema,
  }),
  retirement: z.object({
    /** 退職金（手取り） */
    severance: yenSchema,
    flows: flowsSchema,
  }),
  marriage: z.object({
    spouseName: nameSchema,
    spouseBirthYm: ymSchema,
    cost: yenSchema,
    flows: flowsSchema,
  }),
  birth: z.object({
    childName: nameSchema,
    /** 出産費用（給付金差引後） */
    cost: yenSchema,
    flows: flowsSchema,
  }),
  education: z.object({
    memberId: idSchema,
    kindergarten: z.enum(['none', 'public', 'private']),
    elementary: z.enum(['none', 'public', 'private']),
    junior: z.enum(['none', 'public', 'private']),
    high: z.enum(['none', 'public', 'private']),
    university: z.enum(['none', 'national', 'private_arts', 'private_science']),
    /** 年額の上書き（円）。キーは `${stage}:${course}`、大学入学費用は `university_entrance:${course}` */
    overrides: z.record(z.string(), yenSchema),
    growth: z.discriminatedUnion('type', [z.object({ type: z.literal('none') }), z.object({ type: z.literal('inflation') })]),
  }),
  rent: z.object({
    monthlyRent: yenSchema,
    /** 更新料（0 なら更新料なし） */
    renewalFee: yenSchema,
    renewalIntervalYears: z.number().int().min(0).max(10),
    /** 入居時費用（敷金・礼金・仲介手数料・引越し費用） */
    initialCost: yenSchema,
    growth: growthSchema,
    end: triggerSchema.nullable(),
  }),
  home_purchase: z.object({
    price: yenSchema,
    downPayment: yenSchema,
    /** 諸費用（登記・仲介手数料・融資手数料・保証料等）。購入月に支出計上 */
    closingCosts: yenSchema,
    loan: loanTermsSchema,
    /** 固定資産税・都市計画税（年額）。購入翌年から毎年 4 月に計上 */
    propertyTaxYearly: yenSchema,
    /** 管理費・修繕積立金等（月額）。購入月から計上 */
    maintenanceMonthly: yenSchema,
    maintenanceGrowth: growthSchema,
    /** 評価額の年率変動 */
    revaluationRate: rateSchema,
  }),
  car: z.object({
    price: yenSchema,
    priceGrowth: z.discriminatedUnion('type', [z.object({ type: z.literal('none') }), z.object({ type: z.literal('inflation') })]),
    /** 頭金（ローン利用時）。現金購入時は price 全額を現金で支払う */
    downPayment: yenSchema,
    loan: loanTermsSchema.nullable(),
    /** 買い替え周期（年）。0 は 1 台のみ */
    cycleYears: z.number().int().min(0).max(30),
    purchaseCount: z.number().int().min(1).max(20),
    /** 維持費（年額: 税・保険・車検・駐車場等）。月割りで計上 */
    maintenanceYearly: yenSchema,
    maintenanceGrowth: growthSchema,
    /** 車両評価額の年率変動（例: -0.15） */
    depreciationRate: rateSchema,
    /** 手放す時期（null = シミュレーション終了まで保有） */
    holdUntil: triggerSchema.nullable(),
  }),
  pension: z.object({
    memberId: idSchema,
    /** 年額（手取り見込み・現在価値） */
    annualAmount: yenSchema,
    /** 年金額の伸び率（既定 0 = 名目一定, Q-11） */
    slideRate: rateSchema,
    /** v2: true の場合、annualAmount を 65 歳受給の見込額とみなし、受給開始年齢に応じた繰上げ・繰下げの増減率を適用する */
    claimAdjustment: z.boolean(),
  }),
} as const;

export type EventType = keyof typeof eventParamsSchemas;
export const EVENT_TYPES = Object.keys(eventParamsSchemas) as EventType[];
export type EventParams<T extends EventType> = z.infer<(typeof eventParamsSchemas)[T]>;

const eventBase = {
  id: idSchema,
  name: nameSchema,
  enabled: z.boolean(),
  trigger: triggerSchema,
  /** この時点で終了させる収支項目 ID またはイベント ID（イベント指定時はそのイベントの継続収支を終了） */
  endsIds: z.array(idSchema).max(50),
  memo: z.string().max(LIMITS.maxMemoLength).optional(),
};

export const lifeEventSchema = z.discriminatedUnion(
  'type',
  EVENT_TYPES.map((t) => z.object({ ...eventBase, type: z.literal(t), params: eventParamsSchemas[t] })) as unknown as [
    z.ZodObject<{ type: z.ZodLiteral<'one_time'> }>,
  ],
);

type EventOf<T extends EventType> = {
  id: string;
  type: T;
  name: string;
  enabled: boolean;
  trigger: Trigger;
  endsIds: string[];
  memo?: string | undefined;
  params: EventParams<T>;
};
export type LifeEvent = { [T in EventType]: EventOf<T> }[EventType];

// ---- シナリオ・アプリデータ ----

export const assumptionsSchema = z.object({
  startYm: ymSchema,
  endAge: z.number().int().min(LIMITS.minEndAge).max(LIMITS.maxEndAge),
  inflationRate: rateSchema,
  defaultReturnRate: rateSchema,
  /** 資金不足時の自動取り崩し（Q-13: 既定 OFF） */
  autoLiquidate: z.boolean(),
});
export type Assumptions = z.infer<typeof assumptionsSchema>;

export const scenarioSchema = z.object({
  id: idSchema,
  name: z.string().min(1, { message: 'シナリオ名を入力してください' }).max(LIMITS.maxNameLength),
  description: z.string().max(LIMITS.maxMemoLength).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  copiedFrom: idSchema.optional(),
  assumptions: assumptionsSchema,
  members: z.array(memberSchema).max(20),
  accounts: z.array(accountSchema).max(100),
  flows: z.array(flowItemSchema).max(500),
  transfers: z.array(transferRuleSchema).max(100),
  events: z.array(lifeEventSchema).max(300),
});
export type Scenario = Omit<z.infer<typeof scenarioSchema>, 'events'> & { events: LifeEvent[] };

export const settingsSchema = z.object({
  displayUnit: z.enum(['yen', 'man']),
  lastExportedAt: z.string().optional(),
});
export type Settings = z.infer<typeof settingsSchema>;

export const appDataSchema = z.object({
  app: z.literal('lifeplan'),
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  savedAt: z.string(),
  settings: settingsSchema,
  activeScenarioId: idSchema,
  scenarios: z.array(scenarioSchema).min(1).max(20),
});
export type AppData = Omit<z.infer<typeof appDataSchema>, 'scenarios'> & { scenarios: Scenario[] };

/** スキーマ検証（構造・型・範囲）。参照整合性は engine/validate で検査する。 */
export function parseAppData(raw: unknown): { ok: true; data: AppData } | { ok: false; issues: string[] } {
  const r = appDataSchema.safeParse(raw);
  if (r.success) {
    const data = r.data as unknown as AppData;
    if (!data.scenarios.some((s) => s.id === data.activeScenarioId)) {
      return { ok: false, issues: ['activeScenarioId: 存在しないシナリオを指しています'] };
    }
    return { ok: true, data };
  }
  return { ok: false, issues: r.error.issues.slice(0, 20).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) };
}
