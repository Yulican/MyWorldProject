import { useContext } from 'react';
import { AppContext, type AppContextValue } from '../context/AppContext';

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error('useApp muss innerhalb von <AppProvider> verwendet werden.');
  }
  return ctx;
}
