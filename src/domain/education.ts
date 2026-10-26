// 教育費テンプレートの既定値（Q-19）。値は公的統計の調査結果で、利用者が上書きできる。
// 制度値・統計値は計算エンジンに埋め込まず、出典と調査年を添えてここで管理する。

export type Course = 'public' | 'private' | 'national' | 'private_arts' | 'private_science';

export type EducationSource = { id: string; title: string; publisher: string; year: string; url: string; note: string };

export const EDUCATION_SOURCES: Record<string, EducationSource> = {
  mext_r5: {
    id: 'mext_r5',
    title: '令和5年度子供の学習費調査（2026年1月16日訂正後の値）',
    publisher: '文部科学省',
    year: '令和5年度（2023年度）',
    url: 'https://www.mext.go.jp/content/20260116-mxt_chousa01-000046779_01.pdf',
    note: '子供一人当たりの年間「学習費総額」（学校教育費・学校給食費・学校外活動費の合計）。高等学校は全日制。',
  },
  jfc_r3: {
    id: 'jfc_r3',
    title: '令和3年度 教育費負担の実態調査結果（2021年12月20日公表）',
    publisher: '日本政策金融公庫',
    year: '令和3年度（2021年度）',
    url: 'https://www.jfc.go.jp/n/findings/pdf/kyouikuhi_chousa_k_r03.pdf',
    note: '大学の「在学費用」（1年間、授業料・通学費・教科書代・家庭教育費等の見込額）と「入学費用」（受験費用・学校納付金・入学しなかった学校への納付金）。',
  },
};

/** 年額（円）。キーは `${stage}:${course}` */
export const EDUCATION_DEFAULTS: Record<string, { annual: number; source: string }> = {
  'kindergarten:public': { annual: 184646, source: 'mext_r5' },
  'kindergarten:private': { annual: 347338, source: 'mext_r5' },
  'elementary:public': { annual: 366599, source: 'mext_r5' },
  'elementary:private': { annual: 1741516, source: 'mext_r5' },
  'junior:public': { annual: 542450, source: 'mext_r5' },
  'junior:private': { annual: 1560359, source: 'mext_r5' },
  'high:public': { annual: 596954, source: 'mext_r5' },
  'high:private': { annual: 1179261, source: 'mext_r5' },
  'university:national': { annual: 1035000, source: 'jfc_r3' },
  'university:private_arts': { annual: 1520000, source: 'jfc_r3' },
  'university:private_science': { annual: 1832000, source: 'jfc_r3' },
};

/** 大学の入学費用（一時金, 円） */
export const UNIVERSITY_ENTRANCE_DEFAULTS: Record<string, { amount: number; source: string }> = {
  national: { amount: 672000, source: 'jfc_r3' },
  private_arts: { amount: 818000, source: 'jfc_r3' },
  private_science: { amount: 888000, source: 'jfc_r3' },
};

export const COURSE_LABEL: Record<string, string> = {
  none: '通わない／計上しない',
  public: '公立',
  private: '私立',
  national: '国公立',
  private_arts: '私立文系',
  private_science: '私立理系',
};
