import { useCallback, useEffect, useState } from 'react';
import { useWindowDimensions } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type LayoutMode = 'auto' | 'desktop' | 'mobile';
const KEY = 'adminLayoutMode';
const DESKTOP_MIN_WIDTH = 900;

/**
 * Admin layout preference: auto (by screen width), or forced desktop/mobile.
 * Persisted in AsyncStorage so the choice sticks across sessions.
 */
export function useAdminLayout() {
  const { width } = useWindowDimensions();
  const [mode, setModeState] = useState<LayoutMode>('auto');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(KEY).then((v) => {
      if (v === 'desktop' || v === 'mobile' || v === 'auto') setModeState(v);
      setReady(true);
    });
  }, []);

  const setMode = useCallback((m: LayoutMode) => {
    setModeState(m);
    AsyncStorage.setItem(KEY, m).catch(() => {});
  }, []);

  const isDesktop = mode === 'desktop' || (mode === 'auto' && width >= DESKTOP_MIN_WIDTH);
  return { mode, setMode, isDesktop, width, ready };
}
