import { useEffect, useId, useState, type ReactNode } from 'react';
import { formatPercent, formatYenInput, parsePercentInput, parseYenInput } from '../../domain/format';

type BaseProps = {
  label: string;
  error?: string | undefined;
  hint?: ReactNode;
  required?: boolean;
};

function FieldShell({ label, error, hint, required, id, children }: BaseProps & { id: string; children: ReactNode }) {
  return (
    <div className={`field${error ? ' field--error' : ''}`}>
      <label htmlFor={id}>
        {label}
        {required && <span className="req" aria-label="必須">*</span>}
      </label>
      {children}
      {hint && <div className="field__hint">{hint}</div>}
      {error && (
        <div className="field__error" role="alert" id={`${id}-err`}>
          {error}
        </div>
      )}
    </div>
  );
}

export function TextField(props: BaseProps & { value: string; onChange: (v: string) => void; placeholder?: string; maxLength?: number }) {
  const id = useId();
  return (
    <FieldShell {...props} id={id}>
      <input
        id={id}
        type="text"
        value={props.value}
        placeholder={props.placeholder}
        maxLength={props.maxLength}
        aria-invalid={!!props.error}
        aria-describedby={props.error ? `${id}-err` : undefined}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </FieldShell>
  );
}

/** 金額入力。「30万」「300,000」等を受け付け、円の数値（解釈不能なら NaN）を返す */
export function YenField(props: BaseProps & { value: number; onChange: (v: number) => void }) {
  const id = useId();
  const [text, setText] = useState(() => (Number.isFinite(props.value) ? formatYenInput(props.value) : ''));
  useEffect(() => {
    const parsed = parseYenInput(text);
    if (parsed !== props.value && Number.isFinite(props.value)) setText(formatYenInput(props.value));
    // 外部から値が変わった場合のみ同期する
  }, [props.value]);
  const parsed = parseYenInput(text);
  return (
    <FieldShell
      {...props}
      id={id}
      hint={
        <>
          {props.hint}
          {parsed !== null && Number.isFinite(parsed) && parsed >= 10000 && <span className="muted"> = {(parsed / 1e4).toLocaleString('ja-JP')}万円</span>}
        </>
      }
    >
      <div className="input-unit">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          value={text}
          aria-invalid={!!props.error}
          aria-describedby={props.error ? `${id}-err` : undefined}
          onChange={(e) => {
            setText(e.target.value);
            const v = parseYenInput(e.target.value);
            props.onChange(v === null ? NaN : v);
          }}
          onBlur={() => {
            const v = parseYenInput(text);
            if (v !== null && Number.isFinite(v)) setText(formatYenInput(v));
          }}
        />
        <span>円</span>
      </div>
    </FieldShell>
  );
}

/** 率の入力（%表示、値は小数） */
export function PercentField(props: BaseProps & { value: number; onChange: (v: number) => void }) {
  const id = useId();
  const [text, setText] = useState(() => (Number.isFinite(props.value) ? formatPercent(props.value, 4).replace('%', '') : ''));
  return (
    <FieldShell {...props} id={id}>
      <div className="input-unit">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          value={text}
          aria-invalid={!!props.error}
          aria-describedby={props.error ? `${id}-err` : undefined}
          onChange={(e) => {
            setText(e.target.value);
            const v = parsePercentInput(e.target.value);
            props.onChange(v === null ? NaN : v);
          }}
        />
        <span>%</span>
      </div>
    </FieldShell>
  );
}

export function IntField(props: BaseProps & { value: number; onChange: (v: number) => void; unit?: string; min?: number; max?: number }) {
  const id = useId();
  const [text, setText] = useState(() => (Number.isFinite(props.value) ? String(props.value) : ''));
  return (
    <FieldShell {...props} id={id}>
      <div className="input-unit">
        <input
          id={id}
          type="text"
          inputMode="numeric"
          value={text}
          aria-invalid={!!props.error}
          aria-describedby={props.error ? `${id}-err` : undefined}
          onChange={(e) => {
            setText(e.target.value);
            const s = e.target.value.trim().replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
            props.onChange(/^-?\d+$/.test(s) ? Number(s) : NaN);
          }}
        />
        {props.unit && <span>{props.unit}</span>}
      </div>
    </FieldShell>
  );
}

function normalizeYm(raw: string, final: boolean): string {
  const v = raw
    .trim()
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[/／年.]/g, '-')
    .replace(/月$/, '');
  if (!final) return v;
  const m = /^(\d{4})-(\d{1,2})$/.exec(v);
  return m ? `${m[1]}-${m[2]!.padStart(2, '0')}` : v;
}

/** 年月（YYYY-MM）。不正な形式でもそのまま渡し、検証でエラー表示する。ゼロ埋めはフォーカスが外れたときに行う */
export function YmField(props: BaseProps & { value: string; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <FieldShell {...props} id={id} hint={props.hint ?? '例: 2030-04'}>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        placeholder="YYYY-MM"
        value={props.value}
        aria-invalid={!!props.error}
        aria-describedby={props.error ? `${id}-err` : undefined}
        onChange={(e) => props.onChange(normalizeYm(e.target.value, false))}
        onBlur={(e) => props.onChange(normalizeYm(e.target.value, true))}
      />
    </FieldShell>
  );
}

export function SelectField<T extends string>(
  props: BaseProps & { value: T; onChange: (v: T) => void; options: readonly { value: T; label: string }[] },
) {
  const id = useId();
  return (
    <FieldShell {...props} id={id}>
      <select id={id} value={props.value} aria-invalid={!!props.error} onChange={(e) => props.onChange(e.target.value as T)}>
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

export function CheckboxField(props: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: ReactNode }) {
  const id = useId();
  return (
    <div className="field field--check">
      <input id={id} type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
      <label htmlFor={id}>{props.label}</label>
      {props.hint && <div className="field__hint">{props.hint}</div>}
    </div>
  );
}

export function MonthsField(props: BaseProps & { value: number[]; onChange: (v: number[]) => void }) {
  return (
    <fieldset className={`field months${props.error ? ' field--error' : ''}`}>
      <legend>{props.label}</legend>
      <div className="months__grid">
        {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
          <label key={m} className="months__item">
            <input
              type="checkbox"
              checked={props.value.includes(m)}
              onChange={(e) => props.onChange(e.target.checked ? [...props.value, m].sort((a, b) => a - b) : props.value.filter((x) => x !== m))}
            />
            {m}月
          </label>
        ))}
      </div>
      {props.error && (
        <div className="field__error" role="alert">
          {props.error}
        </div>
      )}
    </fieldset>
  );
}

export function FormErrors({ errors }: { errors: string[] }) {
  if (errors.length === 0) return null;
  return (
    <div className="banner banner--error" role="alert">
      <strong>入力内容を確認してください</strong>
      <ul>
        {errors.map((e, i) => (
          <li key={i}>{e}</li>
        ))}
      </ul>
    </div>
  );
}
