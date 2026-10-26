// 層分離の検査（architecture.md §2）。ESLint の import 制約の代わりにテストで機械的に確認する。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
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
        const ok = i.startsWith('./') || i.startsWith('../domain/') || (i.startsWith('../') && !i.startsWith('../ui') && !i.startsWith('../app') && !i.startsWith('../storage') && !i.startsWith('../../'));
        if (!ok) bad.push(`${relative(ROOT, f)} → ${i}`);
      }
      const src = readFileSync(f, 'utf8');
      for (const g of ['window.', 'document.', 'localStorage', 'indexedDB', 'Date.now(', 'new Date(', 'Math.random(']) {
        if (src.includes(g)) bad.push(`${relative(ROOT, f)} uses ${g}`);
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
