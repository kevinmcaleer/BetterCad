import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError, createApi, type Account, type Api } from "./api";

/**
 * Who is signed in (#88). `available` is false when there is no server (a static host, or offline): the editor
 * works the same, and the account menu says accounts aren't reachable.
 */
export interface AccountState {
  api: Api;
  account: Account | null;
  /** True once the first check has answered. */
  ready: boolean;
  available: boolean;
  setAccount: (a: Account | null) => void;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AccountState | null>(null);

export function AccountProvider({ api: given, children }: { api?: Api; children: ReactNode }) {
  const [api] = useState(() => given ?? createApi());
  const [account, setAccount] = useState<Account | null>(null);
  const [ready, setReady] = useState(false);
  const [available, setAvailable] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setAccount(await api.me());
      setAvailable(true);
    } catch (e) {
      setAccount(null);
      setAvailable(!(e instanceof ApiError && e.status === 0));
    } finally {
      setReady(true);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(() => ({ api, account, ready, available, setAccount, refresh }), [api, account, ready, available, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The account, or a signed-out stand-in when no provider is mounted (tests, the gallery). */
export function useAccount(): AccountState {
  const v = useContext(Ctx);
  const [fallback] = useState<AccountState>(() => ({
    api: createApi(),
    account: null,
    ready: true,
    available: false,
    setAccount: () => undefined,
    refresh: async () => undefined,
  }));
  return v ?? fallback;
}
