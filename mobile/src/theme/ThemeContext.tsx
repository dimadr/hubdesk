import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

export type ThemeMode = 'dark' | 'light';

export interface ThemeColors {
  background: string;
  surface: string;
  input: string;
  text: string;
  secondary: string;
  muted: string;
  subtle: string;
  border: string;
  primary: string;
  primarySoft: string;
  success: string;
  successBright: string;
  warning: string;
  danger: string;
  info: string;
  onPrimary: string;
}

const palettes: Record<ThemeMode, ThemeColors> = {
  dark: {
    background: '#080a12',
    surface: '#111527',
    input: '#0d1020',
    text: '#eaf0ff',
    secondary: '#c8cee8',
    muted: '#9097b8',
    subtle: '#5f6690',
    border: 'rgba(255,255,255,.08)',
    primary: '#8b5cf6',
    primarySoft: '#a78bfa',
    success: '#34a875',
    successBright: '#34d399',
    warning: '#fbbf24',
    danger: '#f87171',
    info: '#60a5fa',
    onPrimary: '#ffffff',
  },
  light: {
    background: '#f4f6fb',
    surface: '#ffffff',
    input: '#eef1f7',
    text: '#171a27',
    secondary: '#42475c',
    muted: '#667085',
    subtle: '#8b93a7',
    border: '#d7dce7',
    primary: '#6941c6',
    primarySoft: '#7459d9',
    success: '#238b62',
    successBright: '#159769',
    warning: '#ad6b00',
    danger: '#c73d4d',
    info: '#2878c8',
    onPrimary: '#ffffff',
  },
};

const STORAGE_KEY = 'interface_theme';

interface ThemeContextValue {
  mode: ThemeMode;
  colors: ThemeColors;
  setMode: (mode: ThemeMode) => void;
  toggleMode: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export const ThemeProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [mode, setModeState] = useState<ThemeMode>('dark');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((saved) => {
        if (saved === 'dark' || saved === 'light') setModeState(saved);
      })
      .catch(() => {});
  }, []);

  const setMode = (nextMode: ThemeMode) => {
    setModeState(nextMode);
    AsyncStorage.setItem(STORAGE_KEY, nextMode).catch(() => {});
  };

  const value = useMemo(() => ({
    mode,
    colors: palettes[mode],
    setMode,
    toggleMode: () => setMode(mode === 'dark' ? 'light' : 'dark'),
  }), [mode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useAppTheme = (): ThemeContextValue => {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useAppTheme must be used inside ThemeProvider');
  return value;
};
