import { useContext } from 'react';
import { AppContext, type AppContextValue } from '../context/AppContext';

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error('useApp must be used inside <AppProvider>.');
  }
  return ctx;
}
