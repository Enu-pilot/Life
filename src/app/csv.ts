// 年次表の CSV 出力（F-SIM-11）。Excel で文字化けしないよう UTF-8 BOM を付ける。金額は円単位の整数。
import type { Scenario } from '../domain/schema';
import { formatYm } from '../domain/time';
import type { SimulationResult } from '../engine';

type Ok = Extract<SimulationResult, { ok: true }>;

/** CSV のセル。区切り文字・引用符・改行を含む場合は引用し、表計算ソフトの数式として解釈される文字列は先頭に ' を付ける */
export function csvCell(v: string | number): string {
  if (typeof v === 'number') return String(v);
  const s = /^[=+\-@]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildYearlyCsv(s: Scenario, r: Ok, opts: { real: boolean; exportedAt: Date }): string {
  const head: (string | number)[][] = [
    ['シナリオ', s.name],
    ['計算期間', `${formatYm(r.start)}〜${formatYm(r.end)}`],
    ['物価上昇率', s.assumptions.inflationRate],
    ['金額', opts.real ? `実質値（${formatYm(r.start)}時点の物価に換算、円）` : '名目値（円）'],
    ['計算エンジン', r.engineVersion],
    ['出力日時', opts.exportedAt.toISOString()],
    ['注記', '入力条件と計算前提に基づく試算（予測値）であり、将来を保証するものではありません。個人情報を含みます。'],
    [],
    ['年', '本人年齢', '収入', '支出', '収支', 'ローン利息', 'ローン元本返済', '資産購入', '資産売却', '運用損益', '評価損益', '生活口座', '金融資産', '実物資産', '負債', '純資産', '資金不足の月数'],
  ];
  const rows = r.yearly.map((y) => [
    y.year,
    y.ages[r.selfId] ?? '',
    y.income,
    y.expense,
    y.netIncome,
    y.loanInterest,
    y.loanPrincipal,
    y.assetPurchase,
    y.assetSale,
    y.investmentReturn,
    y.revaluation,
    y.cash,
    y.financialAssets,
    y.realAssets,
    y.liabilities,
    y.netWorth,
    y.shortfallMonths,
  ]);
  return '﻿' + [...head, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
