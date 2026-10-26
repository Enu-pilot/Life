// 層分離の検査（architecture.md §2）。ESLint の import 制約の代わりにテストで機械的に確認する。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../../src');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}

function imports(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  return [...src.matchAll(/(?:import|export)[^'"]*from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!);
}

describe('層分離', () => {
  it('src/engine は src/domain と engine 内部以外を import しない（React・ブラウザ API・保存層に依存しない）', () => {
    const bad: string[] = [];
    for (const f of files(join(ROOT, 'engine'))) {
      for (const i of imports(f)) {
        // 相対 import は解決して src/engine か src/domain 内であること。パッケージ import は禁止
        const target = i.startsWith('.') ? relative(ROOT, resolve(dirname(f), i)) : null;
        const ok = target !== null && (target.startsWith('engine') || target.startsWith('domain'));
        if (!ok) bad.push(`${relative(ROOT, f)} → ${i}`);
      }
      const src = readFileSync(f, 'utf8');
      for (const g of ['window.', 'document.', 'localStorage', 'indexedDB', 'Date.now(', 'new Date(', 'Math.random(']) {
        if (src.includes(g)) bad.push(`${relative(ROOT, f)} uses ${g}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('src/storage は src/domain 以外の層（engine・ui・app）を import しない', () => {
    const bad: string[] = [];
    for (const f of files(join(ROOT, 'storage'))) {
      for (const i of imports(f)) {
        if (!i.startsWith('.')) continue;
        const target = relative(ROOT, resolve(dirname(f), i));
        if (!target.startsWith('storage') && !target.startsWith('domain')) bad.push(`${relative(ROOT, f)} → ${i}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('src/domain は他の層を import しない', () => {
    const bad: string[] = [];
    for (const f of files(join(ROOT, 'domain'))) {
      for (const i of imports(f)) if (i.startsWith('../')) bad.push(`${relative(ROOT, f)} → ${i}`);
    }
    expect(bad).toEqual([]);
  });

  it('外部へ通信するコードがない（fetch / XMLHttpRequest / WebSocket / sendBeacon）', () => {
    const bad: string[] = [];
    for (const f of files(ROOT)) {
      const src = readFileSync(f, 'utf8');
      for (const g of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'sendBeacon', 'EventSource']) if (src.includes(g)) bad.push(`${relative(ROOT, f)}: ${g}`);
    }
    expect(bad).toEqual([]);
  });
});
