// 計算エンジンの入出力型（calculation-spec §5, §13）

import type { AccountKind, Growth } from '../domain/schema';
import type { MonthIndex } from '../domain/time';

export const EXTERNAL = 'EXTERNAL';

export type PostingType =
  | 'income'
  | 'expense'
  | 'transfer'
  | 'asset_purchase'
  | 'asset_sale'
  | 'loan_draw'
  | 'loan_principal'
  | 'loan_interest'
  | 'investment_return'
  | 'interest'
  | 'revaluation';

export type SourceKind = 'item' | 'event' | 'account' | 'system';

export type Posting = {
  month: MonthIndex;
  from: string; // 口座 ID または EXTERNAL
  to: string;
  amount: number; // 正の整数円
  type: PostingType;
  category: string;
  name: string; // 表示用（項目名・イベント名）
  sourceId: string;
  sourceKind: SourceKind;
};

export type Issue = {
  level: 'error' | 'warning';
  code: string;
  message: string;
  /** 関連する要素の ID（画面から該当箇所へ誘導するため） */
  refId?: string;
};

// ---- 内部表現（シナリオをコンパイルした計算ルール） ----

export type Ctx = {
  start: MonthIndex;
  end: MonthIndex;
  inflationRate: number;
  /** メンバー ID → 生年月（イベントで追加されるメンバーを含む） */
  births: Map<string, MonthIndex>;
};

export type FlowRule = {
  key: string;
  sourceId: string;
  sourceKind: SourceKind;
  name: string;
  direction: 'income' | 'expense';
  category: string;
  from: MonthIndex;
  to: MonthIndex; // 両端を含む。to < from なら発生しない
  amount: number; // 1 回あたり（基準時点の価格、小数可）
  months: number[] | null; // null = 毎月
  growth: Growth;
  growthBase: MonthIndex;
  growthStepMonth: number;
};

export type TransferRuleC = Omit<FlowRule, 'direction' | 'category'> & { fromId: string; toId: string };

export type OneTime =
  | {
      kind: 'post';
      key: string;
      month: MonthIndex;
      type: PostingType;
      from: string;
      to: string;
      amount: number; // 整数円
      category: string;
      name: string;
      sourceId: string;
      sourceKind: SourceKind;
      /** 定期的な一時金（更新料など）。終了指定（endsIds）の対象になる */
      endable?: boolean;
    }
  | {
      /** 口座残高の全額を移す（車両の売却など） */
      kind: 'sellAll';
      key: string;
      month: MonthIndex;
      accountId: string;
      to: string;
      category: string;
      name: string;
      sourceId: string;
      sourceKind: SourceKind;
    };

export type AccountC = {
  id: string;
  kind: AccountKind;
  name: string;
  opening: number;
  annualRate: number;
  sourceId: string;
  sourceKind: SourceKind;
};

export type LoanRule = {
  accountId: string;
  name: string;
  sourceId: string;
  sourceKind: SourceKind;
  firstPayment: MonthIndex;
  termMonths: number;
  method: 'equal_payment' | 'equal_principal';
  annualRate: number;
  /** month 以降の返済に適用する金利 */
  rateChanges: { month: MonthIndex; annualRate: number }[];
};

export type Plan = {
  ctx: Ctx;
  accounts: AccountC[];
  flows: FlowRule[];
  transfers: TransferRuleC[];
  oneTimes: OneTime[];
  loans: LoanRule[];
  /** 解決済みイベント（タイムライン表示用） */
  events: ResolvedEvent[];
  autoLiquidate: boolean;
};

export type ResolvedEvent = {
  id: string;
  name: string;
  type: string;
  month: MonthIndex;
  enabled: boolean;
  /** 期間外・参照切れで計算に含めない場合 */
  skipped?: string;
};

// ---- 出力 ----

export type FlowTotals = {
  income: number;
  expense: number; // ローン利息を含む
  loanInterest: number;
  loanPrincipal: number;
  assetPurchase: number;
  assetSale: number;
  loanDraw: number;
  investmentReturn: number; // 利息を含む
  revaluation: number;
  autoLiquidation: number;
};

export type Snapshot = {
  /** 口座 ID → 残高（負債は正の値） */
  balances: Record<string, number>;
  cash: number;
  financialAssets: number; // cash + savings + investment
  realAssets: number; // property + vehicle + other_asset
  liabilities: number;
  netWorth: number;
};

export type MonthlyRow = FlowTotals &
  Snapshot & {
    month: MonthIndex;
    shortfall: boolean;
  };

export type YearlyRow = FlowTotals &
  Snapshot & {
    year: number;
    /** メンバー ID → 12 月時点の満年齢（出生前は含まない） */
    ages: Record<string, number>;
    firstMonth: MonthIndex;
    lastMonth: MonthIndex;
    /** 収入 − 支出（振替・元本返済・資産購入を除く） */
    netIncome: number;
    /** 生活口座の増減 */
    cashChange: number;
    opening: Snapshot;
    byCategory: Record<string, number>; // 収入は正、支出は負
    shortfallMonths: number;
    /** 期首純資産 + 収入 − 支出 + 運用損益 + 評価損益 − 期末純資産（常に 0 になるはず） */
    reconciliationError: number;
  };

export type AccountInfo = { id: string; kind: AccountKind; name: string; sourceKind: SourceKind };

export type Metrics = {
  startNetWorth: number;
  endNetWorth: number;
  endFinancialAssets: number;
  minCash: { amount: number; month: MonthIndex };
  shortfall: { firstMonth: MonthIndex | null; maxAmount: number; months: number };
  lifetimeIncome: number;
  lifetimeExpense: number;
  loanPayoff: { accountId: string; name: string; month: MonthIndex | null }[];
};

export type SimulationResult =
  | {
      ok: true;
      engineVersion: string;
      start: MonthIndex;
      end: MonthIndex;
      selfId: string;
      births: Record<string, MonthIndex>;
      accounts: AccountInfo[];
      monthly: MonthlyRow[];
      yearly: YearlyRow[];
      postings: Posting[];
      events: ResolvedEvent[];
      metrics: Metrics;
      issues: Issue[];
    }
  | { ok: false; issues: Issue[] };

export type SimOptions = {
  /** 全運用口座の利回りに加算（感度分析・楽観/悲観用） */
  returnShift?: number;
  /** 物価上昇率に加算 */
  inflationShift?: number;
};
