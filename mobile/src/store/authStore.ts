import { Platform } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { create } from 'zustand';
import {
  api, sessionApi, setAccessToken, setRefreshHandler, setUnauthorizedHandler,
} from '../api/client';
import { AuthResponse, UserInfo } from '../api/types';
import {
  clearDeviceSession, isQuickUnlockEnabled, loadLockTimeout, loadRefreshToken,
  loadSavedUser, loadSessionId, migrateLegacyAuth, saveDeviceSession,
  saveLockTimeout,
} from '../security/sessionStorage';

export type AuthPhase = 'initializing' | 'signed_out' | 'security_setup' | 'locked' | 'unlocked';

interface AuthState {
  token: string | null;
  user: UserInfo | null;
  phase: AuthPhase;
  quickUnlockEnabled: boolean;
  lockTimeoutSeconds: number;
  currentSessionId: number | null;
  login: (email: string, password: string) => Promise<void>;
  enableQuickUnlock: () => Promise<void>;
  skipQuickUnlock: () => void;
  unlock: () => Promise<void>;
  lock: () => void;
  logout: () => Promise<void>;
  restoreSession: () => Promise<void>;
  refreshAccessToken: (allowWhileLocked?: boolean) => Promise<string | null>;
  setLockTimeoutSeconds: (seconds: number) => Promise<void>;
}

let pendingEnrollmentPassword: string | null = null;

const deviceName = Platform.OS === 'android' ? 'Абие · Android' : 'Абие · iPhone';

const authenticateDevice = async (promptMessage: string): Promise<void> => {
  const [hasHardware, isEnrolled] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
  ]);
  if (!hasHardware || !isEnrolled) {
    throw new Error('На устройстве не настроена биометрическая защита');
  }
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage,
    cancelLabel: 'Отмена',
    disableDeviceFallback: false,
    biometricsSecurityLevel: 'strong',
  });
  if (!result.success) throw new Error('Разблокировка отменена или не выполнена');
};

const userFromAuth = (data: AuthResponse): UserInfo => ({
  user_id: data.user_id,
  email: data.email,
  name: data.name,
  role: data.role,
  status: data.status,
});

export const useAuthStore = create<AuthState>((set, get) => ({
  token: null,
  user: null,
  phase: 'initializing',
  quickUnlockEnabled: false,
  lockTimeoutSeconds: 60,
  currentSessionId: null,

  login: async (email, password) => {
    const { data } = await api.post<AuthResponse>('/login', {
      email,
      password,
      remember_me: false,
    });
    pendingEnrollmentPassword = password;
    const user = userFromAuth(data);
    setAccessToken(data.token);
    set({
      token: data.token,
      user,
      phase: 'security_setup',
      quickUnlockEnabled: false,
      currentSessionId: null,
    });
  },

  enableQuickUnlock: async () => {
    const { user } = get();
    if (!user || !pendingEnrollmentPassword) throw new Error('Выполните вход с паролем повторно');
    await authenticateDevice('Подтвердите быструю разблокировку');
    const { data } = await api.post<AuthResponse>('/auth/device-session', {
      email: user.email,
      password: pendingEnrollmentPassword,
      device_name: deviceName,
    });
    if (!data.refresh_token || !data.session_id) throw new Error('Сервер не создал сессию устройства');
    const nextUser = userFromAuth(data);
    await saveDeviceSession(data.refresh_token, data.session_id, nextUser);
    pendingEnrollmentPassword = null;
    setAccessToken(data.token);
    set({
      token: data.token,
      user: nextUser,
      phase: 'unlocked',
      quickUnlockEnabled: true,
      currentSessionId: data.session_id,
    });
  },

  skipQuickUnlock: () => {
    pendingEnrollmentPassword = null;
    set({ phase: 'unlocked', quickUnlockEnabled: false });
  },

  unlock: async () => {
    await authenticateDevice('Разблокировать Абие');
    const token = await get().refreshAccessToken(true);
    if (!token) throw new Error('Сессия устройства завершена. Войдите с паролем');
  },

  lock: () => {
    if (!get().quickUnlockEnabled) return;
    setAccessToken(null);
    set({ token: null, phase: 'locked' });
  },

  logout: async () => {
    const refreshToken = await loadRefreshToken();
    if (refreshToken) {
      try {
        await sessionApi.post('/auth/logout', { refresh_token: refreshToken });
      } catch {}
    }
    pendingEnrollmentPassword = null;
    setAccessToken(null);
    await clearDeviceSession();
    set({
      token: null,
      user: null,
      phase: 'signed_out',
      quickUnlockEnabled: false,
      currentSessionId: null,
    });
  },

  restoreSession: async () => {
    await migrateLegacyAuth();
    const [enabled, refreshToken, user, sessionId, timeout] = await Promise.all([
      isQuickUnlockEnabled(),
      loadRefreshToken(),
      loadSavedUser(),
      loadSessionId(),
      loadLockTimeout(),
    ]);
    if (enabled && refreshToken && user && sessionId) {
      setAccessToken(null);
      set({
        token: null,
        user,
        phase: 'locked',
        quickUnlockEnabled: true,
        lockTimeoutSeconds: timeout,
        currentSessionId: sessionId,
      });
      return;
    }
    await clearDeviceSession();
    setAccessToken(null);
    set({
      token: null,
      user: null,
      phase: 'signed_out',
      quickUnlockEnabled: false,
      lockTimeoutSeconds: timeout,
      currentSessionId: null,
    });
  },

  refreshAccessToken: async (allowWhileLocked = false) => {
    if (get().phase === 'locked' && !allowWhileLocked) return null;
    const refreshToken = await loadRefreshToken();
    if (!refreshToken) return null;
    try {
      const { data } = await sessionApi.post<AuthResponse>('/auth/refresh', {
        refresh_token: refreshToken,
      });
      const user = userFromAuth(data);
      setAccessToken(data.token);
      set({ token: data.token, user, phase: 'unlocked' });
      return data.token;
    } catch {
      setAccessToken(null);
      await clearDeviceSession();
      set({
        token: null,
        user: null,
        phase: 'signed_out',
        quickUnlockEnabled: false,
        currentSessionId: null,
      });
      return null;
    }
  },

  setLockTimeoutSeconds: async (seconds) => {
    await saveLockTimeout(seconds);
    set({ lockTimeoutSeconds: seconds });
  },
}));

setRefreshHandler(() => useAuthStore.getState().refreshAccessToken());
setUnauthorizedHandler(async () => {
  if (useAuthStore.getState().phase === 'signed_out') return;
  setAccessToken(null);
  await clearDeviceSession();
  useAuthStore.setState({
    token: null,
    user: null,
    phase: 'signed_out',
    quickUnlockEnabled: false,
    currentSessionId: null,
  });
});
