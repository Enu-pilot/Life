// 制度パラメータ（Phase 5）。制度値は計算エンジンに埋め込まず、施行時期・条件・出典とともにここで管理する。
// 制度が改正された場合はこのファイルを更新し、calculation-spec §18 と該当テストを更新すること。

export type InstitutionSource = { title: string; publisher: string; url: string; checked: string };

export const PENSION_CLAIM = {
  id: 'pension_claim_2022',
  title: '老齢年金の繰上げ・繰下げ受給の増減率',
  effectiveFrom: '2022-04-01',
  /** 繰上げ: 1 か月あたりの減額率。生年月が bornFromYm 以降なら 0.4%、それより前は 0.5% */
  early: [
    { bornFromYm: '1962-04', ratePerMonth: 0.004, note: '昭和37年4月2日以降生まれ（最大 24%）' },
    { bornFromYm: null, ratePerMonth: 0.005, note: '昭和37年4月1日以前生まれ（最大 30%）' },
  ],
  minAge: 60,
  normalAge: 65,
  /** 繰下げ: 1 か月あたりの増額率（66 歳以降） */
  deferralRatePerMonth: 0.007,
  /** 繰下げの上限年齢。生年月が bornFromYm 以降なら 75 歳、それより前は 70 歳 */
  maxAge: [
    { bornFromYm: '1952-04', age: 75, note: '昭和27年4月2日以降生まれ（最大 84%）' },
    { bornFromYm: null, age: 70, note: '昭和27年4月1日以前生まれ（最大 42%）' },
  ],
  simplifications: [
    '生年「月」のみを扱うため、4 月生まれは 4 月 2 日以降生まれとみなす（学齢と同じ規則）',
    '受給開始は指定年齢になる誕生月とし、月数 =（受給開始年齢 − 65）× 12 で計算する',
    '老齢基礎年金と老齢厚生年金を同時に繰上げ・繰下げする場合を想定（片方のみの繰下げは未対応）',
    '加給年金・振替加算・在職老齢年金による支給停止は考慮しない',
  ],
  sources: [
    { title: '年金の繰上げ受給', publisher: '日本年金機構', url: 'https://www.nenkin.go.jp/service/jukyu/seido/roureinenkin/kuriage-kurisage/20140421-01.html', checked: '2026-10-26（ページ更新日 2024-08-19）' },
    { title: '年金の繰下げ受給', publisher: '日本年金機構', url: 'https://www.nenkin.go.jp/service/jukyu/seido/roureinenkin/kuriage-kurisage/20140421-02.html', checked: '2026-10-26（ページ更新日 2026-08-12）' },
    { title: '令和4年4月から年金制度が改正されました', publisher: '日本年金機構', url: 'https://www.nenkin.go.jp/oshirase/topics/2022/0401.html', checked: '2026-10-26' },
  ] as InstitutionSource[],
} as const;
