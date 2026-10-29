import {
  createContext,
  useCallback,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';

export type AppState = {
  userName: string | null;
};

export type AppContextValue = AppState & {
  setUserName: (name: string | null) => void;
};

export const AppContext = createContext<AppContextValue | undefined>(undefined);

export function AppProvider({ children }: PropsWithChildren) {
  const [userName, setUserNameState] = useState<string | null>(null);

  const setUserName = useCallback((name: string | null) => {
    setUserNameState(name);
  }, []);

  const value = useMemo<AppContextValue>(
    () => ({ userName, setUserName }),
    [userName, setUserName],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
