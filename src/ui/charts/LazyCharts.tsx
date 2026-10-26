// グラフ部品の遅延読み込み（初回表示のコードを小さくする）
import { lazy, Suspense, type ComponentProps } from 'react';
import type * as C from './Charts';

const LazyAsset = lazy(() => import('./Charts').then((m) => ({ default: m.AssetChart })));
const LazyCashflow = lazy(() => import('./Charts').then((m) => ({ default: m.CashflowChart })));
const LazyCompare = lazy(() => import('./Charts').then((m) => ({ default: m.CompareChart })));

const Fallback = () => <p className="muted small">グラフを読み込み中…</p>;

export const AssetChart = (p: ComponentProps<typeof C.AssetChart>) => (
  <Suspense fallback={<Fallback />}>
    <LazyAsset {...p} />
  </Suspense>
);
export const CashflowChart = (p: ComponentProps<typeof C.CashflowChart>) => (
  <Suspense fallback={<Fallback />}>
    <LazyCashflow {...p} />
  </Suspense>
);
export const CompareChart = (p: ComponentProps<typeof C.CompareChart>) => (
  <Suspense fallback={<Fallback />}>
    <LazyCompare {...p} />
  </Suspense>
);
