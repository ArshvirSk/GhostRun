import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ThemeTokens,
  getThemeTokens,
  tokens as defaultTokens,
} from './tokens';

export type ThemeMode = 'system' | 'light' | 'dark';

export const THEME_STORAGE_KEY = '@ghostrun:theme_preference';

interface ThemeContextValue {
  tokens: ThemeTokens;
  colors: ThemeTokens['colors'];
  spacing: ThemeTokens['spacing'];
  radii: ThemeTokens['radii'];
  typography: ThemeTokens['typography'];
  motion: ThemeTokens['motion'];
  isDark: boolean;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => Promise<void>;
}

const defaultContextValue: ThemeContextValue = {
  tokens: defaultTokens,
  colors: defaultTokens.colors,
  spacing: defaultTokens.spacing,
  radii: defaultTokens.radii,
  typography: defaultTokens.typography,
  motion: defaultTokens.motion,
  isDark: true,
  themeMode: 'system',
  setThemeMode: async () => {},
};

const ThemeContext = createContext<ThemeContextValue>(defaultContextValue);

export interface ThemeProviderProps {
  children: React.ReactNode;
  overrideTokens?: Partial<ThemeTokens>;
  initialMode?: ThemeMode;
}

export function ThemeProvider({
  children,
  overrideTokens,
  initialMode,
}: ThemeProviderProps) {
  const systemScheme = useColorScheme();
  const [themeMode, setThemeModeState] = useState<ThemeMode>(initialMode || 'system');

  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(THEME_STORAGE_KEY);
        if (stored && isMounted && (stored === 'system' || stored === 'light' || stored === 'dark')) {
          setThemeModeState(stored as ThemeMode);
        }
      } catch {
        // Fall back to system
      }
    })();
    return () => {
      isMounted = false;
    };
  }, []);

  const setThemeMode = useCallback(async (mode: ThemeMode) => {
    setThemeModeState(mode);
    try {
      await AsyncStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch {
      // Storage failure swallowed
    }
  }, []);

  const isDark = useMemo(() => {
    if (themeMode === 'light') return false;
    if (themeMode === 'dark') return true;
    return systemScheme !== 'light';
  }, [themeMode, systemScheme]);

  const activeTokens = useMemo<ThemeTokens>(() => {
    const base = getThemeTokens(isDark ? 'dark' : 'light');
    if (!overrideTokens) return base;
    return {
      ...base,
      ...overrideTokens,
      colors: {
        ...base.colors,
        ...(overrideTokens.colors || {}),
      },
    };
  }, [isDark, overrideTokens]);

  const contextValue = useMemo<ThemeContextValue>(
    () => ({
      tokens: activeTokens,
      colors: activeTokens.colors,
      spacing: activeTokens.spacing,
      radii: activeTokens.radii,
      typography: activeTokens.typography,
      motion: activeTokens.motion,
      isDark,
      themeMode,
      setThemeMode,
    }),
    [activeTokens, isDark, themeMode, setThemeMode]
  );

  return <ThemeContext.Provider value={contextValue}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    return defaultContextValue;
  }
  return context;
}
