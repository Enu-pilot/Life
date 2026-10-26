import { createContext, useContext, type ReactNode } from 'react';
import type { Repository } from '../storage/repository';

const Ctx = createContext<Repository | null>(null);

export function RepositoryProvider({ repo, children }: { repo: Repository; children: ReactNode }) {
  return <Ctx.Provider value={repo}>{children}</Ctx.Provider>;
}

export function useRepository(): Repository {
  const r = useContext(Ctx);
  if (!r) throw new Error('RepositoryProvider がありません');
  return r;
}
