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
import { getTintedDarkColors, getTintedLightColors } from './colorTint';

export type ThemeMode = 'system' | 'light' | 'dark';

export const THEME_STORAGE_KEY = '@ghostrun:theme_preference';
export const ACCENT_COLOR_STORAGE_KEY = '@ghostrun:theme_accent_color';

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
  accentColor: string | null;
  setAccentColor: (color: string | null) => Promise<void>;
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
  accentColor: null,
  setAccentColor: async () => {},
};

const ThemeContext = createContext<ThemeContextValue>(defaultContextValue);

export interface ThemeProviderProps {
  children: React.ReactNode;
  overrideTokens?: Partial<ThemeTokens>;
  initialMode?: ThemeMode;
  initialAccentColor?: string | null;
}

export function ThemeProvider({
  children,
  overrideTokens,
  initialMode,
  initialAccentColor,
}: ThemeProviderProps) {
  const systemScheme = useColorScheme();
  const [themeMode, setThemeModeState] = useState<ThemeMode>(initialMode || 'system');
  const [accentColor, setAccentColorState] = useState<string | null>(initialAccentColor || null);

  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(THEME_STORAGE_KEY);
        if (stored && isMounted && (stored === 'system' || stored === 'light' || stored === 'dark')) {
          setThemeModeState(stored as ThemeMode);
        }

        const storedAccent = await AsyncStorage.getItem(ACCENT_COLOR_STORAGE_KEY);
        if (storedAccent && isMounted) {
          setAccentColorState(storedAccent);
        } else {
          // Fallback: check profile color if no dedicated accent is saved yet
          const profileRaw = await AsyncStorage.getItem('@ghostrun:profile');
          if (profileRaw && isMounted) {
            try {
              const parsed = JSON.parse(profileRaw);
              if (parsed?.color) {
                setAccentColorState(parsed.color);
              }
            } catch {
              // ignore
            }
          }
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

  const setAccentColor = useCallback(async (color: string | null) => {
    setAccentColorState(color);
    try {
      if (color) {
        await AsyncStorage.setItem(ACCENT_COLOR_STORAGE_KEY, color);
      } else {
        await AsyncStorage.removeItem(ACCENT_COLOR_STORAGE_KEY);
      }
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
    const baseMode = isDark ? 'dark' : 'light';
    const base = getThemeTokens(baseMode);

    let colors = base.colors;
    if (accentColor) {
      colors = isDark ? getTintedDarkColors(accentColor) : getTintedLightColors(accentColor);
    }

    if (!overrideTokens) {
      return {
        ...base,
        colors,
      };
    }

    return {
      ...base,
      ...overrideTokens,
      colors: {
        ...colors,
        ...(overrideTokens.colors || {}),
      },
    };
  }, [isDark, accentColor, overrideTokens]);

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
      accentColor,
      setAccentColor,
    }),
    [activeTokens, isDark, themeMode, setThemeMode, accentColor, setAccentColor]
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
