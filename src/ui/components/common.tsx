import { useEffect, useRef, type ReactNode } from 'react';
import type { z } from 'zod';

/** Zod の検証結果を「フィールドパス → メッセージ」に変換する */
export function collectErrors(schema: z.ZodType, value: unknown): Record<string, string> {
  const r = schema.safeParse(value);
  if (r.success) return {};
  const out: Record<string, string> = {};
  for (const i of r.error.issues) {
    const key = i.path.join('.');
    if (!(key in out)) out[key] = i.message;
  }
  return out;
}

export function Dialog({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog${wide ? ' dialog--wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="dialog__head">
          <h2>{title}</h2>
          <button type="button" className="btn btn--ghost" aria-label="閉じる" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="dialog__body">{children}</div>
        {footer && <div className="dialog__foot">{footer}</div>}
      </div>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty__title">{title}</p>
      {children}
    </div>
  );
}

export function Banner({ kind, children }: { kind: 'info' | 'warn' | 'error'; children: ReactNode }) {
  return (
    <div className={`banner banner--${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {kind === 'warn' && <span aria-hidden="true">⚠ </span>}
      {kind === 'error' && <span aria-hidden="true">⛔ </span>}
      {children}
    </div>
  );
}

export const DISCLAIMER =
  '本アプリの計算結果は、入力された条件と計算前提に基づく試算（予測値）であり、将来の収入・支出・資産額を保証するものではありません。税金・社会保険・年金等の制度は簡易的に扱っており、実際の金額とは異なる場合があります。重要な意思決定にあたっては、専門家への相談や公的機関の情報をご確認ください。';

export function Disclaimer() {
  return <p className="disclaimer">{DISCLAIMER}</p>;
}
