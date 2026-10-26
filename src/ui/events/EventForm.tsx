import { COURSE_LABEL, EDUCATION_DEFAULTS, EDUCATION_SOURCES, UNIVERSITY_ENTRANCE_DEFAULTS } from '../../domain/education';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '../../domain/categories';
import { formatMoney } from '../../domain/format';
import type { FlowTemplate, Growth, LifeEvent, LoanTerms, Scenario } from '../../domain/schema';
import { equalPayment } from '../../engine';
import { useUnit } from '../AppContext';
import { CheckboxField, IntField, PercentField, SelectField, TextField, YenField, YmField } from '../components/fields';
import { FlowFields } from '../components/FlowFields';
import { TriggerField } from '../components/TriggerField';
import { childOptions, memberOptions } from '../scenarioView';
import { EVENT_META, newTemplate } from './defaults';

type Props<T extends LifeEvent['type']> = {
  value: Extract<LifeEvent, { type: T }>;
  onChange: (v: Extract<LifeEvent, { type: T }>) => void;
  errors: Record<string, string>;
  scenario: Scenario;
};

const GROWTH2 = [
  { value: 'none', label: '変化なし' },
  { value: 'inflation', label: '物価上昇率に連動' },
] as const;

function GrowthSelect({ label, value, onChange, allowFixed }: { label: string; value: Growth; onChange: (g: Growth) => void; allowFixed?: boolean }) {
  return (
    <>
      <SelectField
        label={label}
        value={value.type}
        onChange={(t) => onChange(t === 'fixed' ? { type: 'fixed', rate: 0.01 } : { type: t })}
        options={allowFixed ? [...GROWTH2, { value: 'fixed', label: '固定の率' }] : GROWTH2}
      />
      {value.type === 'fixed' && <PercentField label={`${label}（年率）`} value={value.rate} onChange={(rate) => onChange({ type: 'fixed', rate })} />}
    </>
  );
}

function TemplatesEditor({ flows, onChange, errors, scenario, title }: { flows: FlowTemplate[]; onChange: (f: FlowTemplate[]) => void; errors: Record<string, string>; scenario: Scenario; title: string }) {
  const members = memberOptions(scenario);
  const err = (i: number) => Object.fromEntries(Object.entries(errors).filter(([k]) => k.startsWith(`params.flows.${i}.`)).map(([k, v]) => [k.replace(`params.flows.${i}.`, ''), v]));
  return (
    <fieldset className="field">
      <legend>{title}（イベントの月から開始）</legend>
      {flows.length === 0 && <p className="muted small">なし</p>}
      {flows.map((f, i) => (
        <div key={f.key} className="card">
          <div className="actions" style={{ justifyContent: 'space-between', marginTop: 0 }}>
            <strong>{f.direction === 'income' ? '収入' : '支出'} {i + 1}</strong>
            <button type="button" className="btn btn--small btn--danger" onClick={() => onChange(flows.filter((_, j) => j !== i))}>
              この収支を削除
            </button>
          </div>
          <FlowFields value={f} onChange={(core) => onChange(flows.map((x, j) => (j === i ? { ...core, key: f.key } : x)))} errors={err(i)} members={members} defaultYm={scenario.assumptions.startYm} />
        </div>
      ))}
      <div className="actions">
        <button type="button" className="btn btn--small" onClick={() => onChange([...flows, newTemplate('income', 'salary', '')])}>
          ＋ 収入を追加
        </button>
        <button type="button" className="btn btn--small" onClick={() => onChange([...flows, newTemplate('expense', 'living', '')])}>
          ＋ 支出を追加
        </button>
      </div>
    </fieldset>
  );
}

function LoanFields({ value, onChange, principal, errors }: { value: LoanTerms; onChange: (l: LoanTerms) => void; principal: number; errors: Record<string, string> }) {
  const unit = useUnit();
  const payment = Number.isFinite(principal) && principal > 0 && Number.isFinite(value.annualRate) && value.termMonths > 0 ? equalPayment(principal, value.annualRate, value.termMonths) : null;
  return (
    <fieldset className="field">
      <legend>ローン条件</legend>
      <p className="muted small">
        借入額: {Number.isFinite(principal) ? formatMoney(Math.max(0, principal), unit) : '—'}（価格 − 頭金）／ 返済は借入の翌月から毎月（ボーナス払い未対応）／ 融資手数料・保証料は「諸費用」に含めてください
      </p>
      <div className="grid2">
        <PercentField label="金利（年率）" value={value.annualRate} onChange={(annualRate) => onChange({ ...value, annualRate })} error={errors.annualRate} />
        <IntField label="返済期間" unit="か月" value={value.termMonths} onChange={(termMonths) => onChange({ ...value, termMonths })} error={errors.termMonths} hint="例: 35 年 = 420 か月" />
        <SelectField
          label="返済方式"
          value={value.method}
          onChange={(method) => onChange({ ...value, method })}
          options={[
            { value: 'equal_payment', label: '元利均等返済' },
            { value: 'equal_principal', label: '元金均等返済' },
          ]}
        />
      </div>
      {payment !== null && value.method === 'equal_payment' && <p className="small">当初の毎月返済額（試算）: {formatMoney(payment, 'yen')}</p>}
      <fieldset className="field">
        <legend>金利の変更（変動金利の簡易設定）</legend>
        {value.rateChanges.map((c, i) => (
          <div key={i} className="grid2">
            <IntField
              label="初回返済から"
              unit="か月後"
              value={c.afterMonths}
              onChange={(afterMonths) => onChange({ ...value, rateChanges: value.rateChanges.map((x, j) => (j === i ? { ...x, afterMonths } : x)) })}
            />
            <PercentField label="変更後の金利" value={c.annualRate} onChange={(annualRate) => onChange({ ...value, rateChanges: value.rateChanges.map((x, j) => (j === i ? { ...x, annualRate } : x)) })} />
            <button type="button" className="btn btn--small" onClick={() => onChange({ ...value, rateChanges: value.rateChanges.filter((_, j) => j !== i) })}>
              削除
            </button>
          </div>
        ))}
        <button type="button" className="btn btn--small" onClick={() => onChange({ ...value, rateChanges: [...value.rateChanges, { afterMonths: 120, annualRate: value.annualRate + 0.005 }] })}>
          ＋ 金利変更を追加
        </button>
        <p className="muted small">変更月に残高と残り回数から返済額を再計算します（5 年ルール・125% ルールは未対応）。</p>
      </fieldset>
    </fieldset>
  );
}

const sub = (errors: Record<string, string>, prefix: string) => Object.fromEntries(Object.entries(errors).filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k.slice(prefix.length), v]));

export function EventParamsForm({ value, onChange, errors, scenario }: Props<LifeEvent['type']>) {
  const e = value;
  const members = memberOptions(scenario);
  const set = <T extends LifeEvent>(params: Partial<T['params']>) => onChange({ ...e, params: { ...e.params, ...params } } as LifeEvent);
  const unit = useUnit();
  switch (e.type) {
    case 'one_time': {
      const cats = e.params.direction === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
      return (
        <div className="grid2">
          <SelectField
            label="種類"
            value={e.params.direction}
            onChange={(direction) => set({ direction, category: direction === 'income' ? 'other_income' : 'leisure' })}
            options={[
              { value: 'expense', label: '一時支出' },
              { value: 'income', label: '臨時収入' },
            ]}
          />
          <SelectField label="カテゴリ" value={e.params.category} onChange={(category) => set({ category })} options={Object.entries(cats).filter(([k]) => k !== 'loan_interest').map(([k, l]) => ({ value: k, label: l }))} />
          <YenField label="金額" required value={e.params.amount} onChange={(amount) => set({ amount })} error={errors['params.amount']} />
          <GrowthSelect label="金額の変化" value={e.params.growth} onChange={(growth) => set({ growth: growth as { type: 'none' } })} />
        </div>
      );
    }
    case 'flow_change':
      return <TemplatesEditor title="追加する収支" flows={e.params.flows} onChange={(flows) => set({ flows })} errors={errors} scenario={scenario} />;
    case 'job':
      return (
        <>
          <div className="grid2">
            <SelectField
              label="種類"
              value={e.params.subtype}
              onChange={(subtype) => set({ subtype })}
              options={[
                { value: 'employment', label: '就職' },
                { value: 'change', label: '転職' },
                { value: 'independence', label: '独立・開業' },
              ]}
            />
            <YenField label="費用（開業費・転職費用など）" value={e.params.cost} onChange={(cost) => set({ cost })} error={errors['params.cost']} />
          </div>
          <TemplatesEditor title="新しい収入・支出" flows={e.params.flows} onChange={(flows) => set({ flows })} errors={errors} scenario={scenario} />
          <p className="muted small">それまでの給与は下の「この時点で終了する収支」で選んでください。昇給は収入の「上昇率」で設定します。</p>
        </>
      );
    case 'retirement':
      return (
        <>
          <YenField label="退職金（手取り）" value={e.params.severance} onChange={(severance) => set({ severance })} error={errors['params.severance']} />
          <TemplatesEditor title="退職後の収入・支出（再雇用など）" flows={e.params.flows} onChange={(flows) => set({ flows })} errors={errors} scenario={scenario} />
          <p className="muted small">給与は下の「この時点で終了する収支」で選んでください。</p>
        </>
      );
    case 'marriage':
      return (
        <>
          <div className="grid2">
            <TextField label="配偶者の呼び名" value={e.params.spouseName} onChange={(spouseName) => set({ spouseName })} error={errors['params.spouseName']} />
            <YmField label="配偶者の生年月" required value={e.params.spouseBirthYm} onChange={(spouseBirthYm) => set({ spouseBirthYm })} error={errors['params.spouseBirthYm']} />
            <YenField label="結婚費用" value={e.params.cost} onChange={(cost) => set({ cost })} error={errors['params.cost']} />
          </div>
          <TemplatesEditor title="配偶者の収入・生活費の変化" flows={e.params.flows} onChange={(flows) => set({ flows })} errors={errors} scenario={scenario} />
          <p className="muted small">保存すると配偶者を年齢・対象者の指定に使えるようになります。</p>
        </>
      );
    case 'birth':
      return (
        <>
          <div className="grid2">
            <TextField label="子の呼び名" value={e.params.childName} onChange={(childName) => set({ childName })} error={errors['params.childName']} />
            <YenField label="出産費用（給付金差引後）" value={e.params.cost} onChange={(cost) => set({ cost })} error={errors['params.cost']} />
          </div>
          <p className="muted small">子の生年月はこのイベントの年月になります。教育費は「教育費」イベントで追加してください。</p>
          <TemplatesEditor title="子育て費・児童手当など" flows={e.params.flows} onChange={(flows) => set({ flows })} errors={errors} scenario={scenario} />
        </>
      );
    case 'education': {
      const p = e.params;
      const stages = [
        ['kindergarten', '幼稚園（3年）', ['none', 'public', 'private']],
        ['elementary', '小学校（6年）', ['none', 'public', 'private']],
        ['junior', '中学校（3年）', ['none', 'public', 'private']],
        ['high', '高校（3年）', ['none', 'public', 'private']],
        ['university', '大学（4年）', ['none', 'national', 'private_arts', 'private_science']],
      ] as const;
      const kids = childOptions(scenario);
      return (
        <>
          <SelectField
            label="対象の子"
            value={p.memberId}
            onChange={(memberId) => onChange({ ...e, trigger: { type: 'school', memberId, stage: 'kindergarten' }, params: { ...p, memberId } })}
            options={[{ value: '', label: '選択してください' }, ...kids.map((k) => ({ value: k.id, label: k.label }))]}
            error={errors['params.memberId']}
          />
          <table className="table">
            <thead>
              <tr>
                <th>段階</th>
                <th>コース</th>
                <th>年額（既定値・出典）</th>
              </tr>
            </thead>
            <tbody>
              {stages.map(([stage, label, courses]) => {
                const course = p[stage] as string;
                const key = `${stage}:${course}`;
                const def = EDUCATION_DEFAULTS[key];
                return (
                  <tr key={stage}>
                    <td>{label}</td>
                    <td>
                      <select aria-label={`${label}のコース`} value={course} onChange={(ev) => set({ [stage]: ev.target.value } as never)}>
                        {courses.map((c) => (
                          <option key={c} value={c}>
                            {COURSE_LABEL[c]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      {course !== 'none' && def && (
                        <YenField
                          label={`年額（既定 ${formatMoney(def.annual, unit)}）`}
                          value={p.overrides[key] ?? def.annual}
                          onChange={(v) => set({ overrides: { ...p.overrides, [key]: v } })}
                          hint={`出典: ${EDUCATION_SOURCES[def.source]!.publisher}「${EDUCATION_SOURCES[def.source]!.title}」`}
                        />
                      )}
                      {stage === 'university' && course !== 'none' && (
                        <YenField
                          label={`入学費用（既定 ${formatMoney(UNIVERSITY_ENTRANCE_DEFAULTS[course]!.amount, unit)}）`}
                          value={p.overrides[`university_entrance:${course}`] ?? UNIVERSITY_ENTRANCE_DEFAULTS[course]!.amount}
                          onChange={(v) => set({ overrides: { ...p.overrides, [`university_entrance:${course}`]: v } })}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <GrowthSelect label="金額の変化" value={p.growth} onChange={(growth) => set({ growth: growth as { type: 'none' } })} />
          <p className="muted small">
            年額を 12 で割って毎月計上します（入学月 4 月から）。既定値は全国平均の統計値です。小〜高は{EDUCATION_SOURCES.mext_r5!.note} 大学は{EDUCATION_SOURCES.jfc_r3!.note}
          </p>
        </>
      );
    }
    case 'rent':
      return (
        <>
          <div className="grid2">
            <YenField label="家賃（月額）" required value={e.params.monthlyRent} onChange={(monthlyRent) => set({ monthlyRent })} error={errors['params.monthlyRent']} />
            <YenField label="入居時費用（敷金・礼金・仲介・引越し）" value={e.params.initialCost} onChange={(initialCost) => set({ initialCost })} />
            <YenField label="更新料（1 回あたり）" value={e.params.renewalFee} onChange={(renewalFee) => set({ renewalFee })} />
            <IntField label="更新の間隔" unit="年" value={e.params.renewalIntervalYears} onChange={(renewalIntervalYears) => set({ renewalIntervalYears })} error={errors['params.renewalIntervalYears']} hint="0 なら更新料なし" />
            <GrowthSelect label="家賃の変化" value={e.params.growth} onChange={(growth) => set({ growth })} allowFixed />
          </div>
          <TriggerField
            label="退去（家賃の終了）"
            mode="end"
            value={e.params.end}
            onChange={(end) => set({ end })}
            members={members}
            nullLabel="終了しない（住宅購入・引っ越しイベントで終了させる場合も含む）"
            error={errors['params.end']}
            defaultYm={scenario.assumptions.startYm}
          />
          <p className="muted small">引っ越しの場合は、前の住まい（賃貸イベントや家賃の項目）を「この時点で終了する収支」で選んでください。</p>
        </>
      );
    case 'home_purchase': {
      const p = e.params;
      return (
        <>
          <div className="grid2">
            <YenField label="物件価格" required value={p.price} onChange={(price) => set({ price })} error={errors['params.price']} />
            <YenField label="頭金" value={p.downPayment} onChange={(downPayment) => set({ downPayment })} error={errors['params.downPayment']} />
            <YenField label="諸費用（登記・仲介・融資手数料・保証料など）" value={p.closingCosts} onChange={(closingCosts) => set({ closingCosts })} hint="購入月に支出として計上" />
            <YenField label="管理費・修繕積立金（月額）" value={p.maintenanceMonthly} onChange={(maintenanceMonthly) => set({ maintenanceMonthly })} />
            <GrowthSelect label="管理費等の変化" value={p.maintenanceGrowth} onChange={(maintenanceGrowth) => set({ maintenanceGrowth })} allowFixed />
            <YenField label="固定資産税・都市計画税（年額）" value={p.propertyTaxYearly} onChange={(propertyTaxYearly) => set({ propertyTaxYearly })} hint="購入翌年から毎年 4 月に計上" />
            <PercentField label="評価額の変動率（年率）" value={p.revaluationRate} onChange={(revaluationRate) => set({ revaluationRate })} hint="例: −1.5%。売却しない限り現金には影響しません" />
          </div>
          <LoanFields value={p.loan} onChange={(loan) => set({ loan })} principal={p.price - p.downPayment} errors={sub(errors, 'params.loan.')} />
          <p className="muted small">現在の家賃は下の「この時点で終了する収支」で選んでください。住宅ローン控除・繰上返済・団信は未対応です。</p>
        </>
      );
    }
    case 'car': {
      const p = e.params;
      return (
        <>
          <div className="grid2">
            <YenField label="車両価格（1 台あたり）" required value={p.price} onChange={(price) => set({ price })} error={errors['params.price']} />
            <GrowthSelect label="価格の変化" value={p.priceGrowth} onChange={(priceGrowth) => set({ priceGrowth: priceGrowth as { type: 'none' } })} />
            <IntField label="買い替え周期" unit="年" value={p.cycleYears} onChange={(cycleYears) => set({ cycleYears })} error={errors['params.cycleYears']} hint="0 なら買い替えなし" />
            {p.cycleYears > 0 && <IntField label="購入台数（買い替えを含む）" unit="台" value={p.purchaseCount} onChange={(purchaseCount) => set({ purchaseCount })} error={errors['params.purchaseCount']} />}
            <YenField label="維持費（年額: 税・保険・車検・駐車場・燃料など）" value={p.maintenanceYearly} onChange={(maintenanceYearly) => set({ maintenanceYearly })} hint="12 で割って毎月計上" />
            <GrowthSelect label="維持費の変化" value={p.maintenanceGrowth} onChange={(maintenanceGrowth) => set({ maintenanceGrowth })} allowFixed />
            <PercentField label="車両の評価額の変動率（年率）" value={p.depreciationRate} onChange={(depreciationRate) => set({ depreciationRate })} hint="例: −15%。買い替え・手放す時に評価額で売却" />
          </div>
          <CheckboxField
            label="自動車ローンを利用する"
            checked={p.loan !== null}
            onChange={(on) => set({ loan: on ? { annualRate: 0.025, termMonths: 60, method: 'equal_payment', rateChanges: [] } : null })}
          />
          {p.loan && (
            <>
              <YenField label="頭金" value={p.downPayment} onChange={(downPayment) => set({ downPayment })} error={errors['params.downPayment']} />
              <LoanFields value={p.loan} onChange={(loan) => set({ loan })} principal={p.price - p.downPayment} errors={sub(errors, 'params.loan.')} />
            </>
          )}
          <TriggerField label="手放す時期" mode="point" value={p.holdUntil} onChange={(holdUntil) => set({ holdUntil })} members={members} nullLabel="手放さない（計算終了まで保有）" error={errors['params.holdUntil']} defaultYm={scenario.assumptions.startYm} />
        </>
      );
    }
    case 'pension':
      return (
        <div className="grid2">
          <SelectField
            label="受給者"
            value={e.params.memberId}
            onChange={(memberId) => onChange({ ...e, trigger: { type: 'age', memberId, age: e.trigger.type === 'age' ? e.trigger.age : 65 }, params: { ...e.params, memberId } })}
            options={[{ value: '', label: '選択してください' }, ...members.filter((m) => !childOptions(scenario).some((c) => c.id === m.id)).map((m) => ({ value: m.id, label: m.label }))]}
            error={errors['params.memberId']}
          />
          <IntField
            label="受給開始年齢"
            unit="歳"
            value={e.trigger.type === 'age' ? e.trigger.age : 65}
            onChange={(age) => onChange({ ...e, trigger: { type: 'age', memberId: e.params.memberId, age } })}
            error={errors['trigger.age'] ?? errors.trigger}
            hint="その年齢になる誕生月から受給します"
          />
          <YenField label="年金額（年額・手取り見込み・現在の価値）" required value={e.params.annualAmount} onChange={(annualAmount) => set({ annualAmount })} error={errors['params.annualAmount']} hint="ねんきん定期便などの見込額を参考に入力" />
          <PercentField label="年金額の伸び率（年率）" value={e.params.slideRate} onChange={(slideRate) => set({ slideRate })} hint="既定 0%（名目一定）。物価より低く設定するのが保守的です" />
        </div>
      );
  }
}

export function eventTitle(e: LifeEvent): string {
  return `${EVENT_META[e.type].icon} ${EVENT_META[e.type].label}`;
}
