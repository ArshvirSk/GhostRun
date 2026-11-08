import React, { createContext, useContext, useMemo } from 'react';
import { ThemeTokens, tokens } from './tokens';

interface ThemeContextValue {
  tokens: ThemeTokens;
  colors: ThemeTokens['colors'];
  spacing: ThemeTokens['spacing'];
  radii: ThemeTokens['radii'];
  typography: ThemeTokens['typography'];
}

const ThemeContext = createContext<ThemeContextValue>({
  tokens,
  colors: tokens.colors,
  spacing: tokens.spacing,
  radii: tokens.radii,
  typography: tokens.typography,
});

export interface ThemeProviderProps {
  children: React.ReactNode;
  overrideTokens?: Partial<ThemeTokens>;
}

export function ThemeProvider({ children, overrideTokens }: ThemeProviderProps) {
  const value = useMemo<ThemeContextValue>(() => {
    const activeTokens = overrideTokens ? { ...tokens, ...overrideTokens } : tokens;
    return {
      tokens: activeTokens,
      colors: activeTokens.colors,
      spacing: activeTokens.spacing,
      radii: activeTokens.radii,
      typography: activeTokens.typography,
    };
  }, [overrideTokens]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    return {
      tokens,
      colors: tokens.colors,
      spacing: tokens.spacing,
      radii: tokens.radii,
      typography: tokens.typography,
    };
  }
  return context;
}
