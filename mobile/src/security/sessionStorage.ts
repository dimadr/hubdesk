import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { UserInfo } from '../api/types';

const REFRESH_TOKEN_KEY = 'hubdesk_refresh_token';
const SESSION_ID_KEY = 'secure_session_id';
const USER_KEY = 'secure_session_user';
const QUICK_UNLOCK_KEY = 'quick_unlock_enabled';
const LOCK_TIMEOUT_KEY = 'lock_timeout_seconds';
const MIGRATION_KEY = 'secure_auth_migrated_v1';

const secureOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

export const migrateLegacyAuth = async (): Promise<void> => {
  if (await AsyncStorage.getItem(MIGRATION_KEY)) return;
  await AsyncStorage.multiRemove(['token', 'user']);
  await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
  await AsyncStorage.setItem(MIGRATION_KEY, '1');
};

export const saveDeviceSession = async (
  refreshToken: string,
  sessionId: number,
  user: UserInfo,
): Promise<void> => {
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken, secureOptions);
  await AsyncStorage.multiSet([
    [SESSION_ID_KEY, String(sessionId)],
    [USER_KEY, JSON.stringify(user)],
    [QUICK_UNLOCK_KEY, '1'],
  ]);
};

export const loadRefreshToken = (): Promise<string | null> => (
  SecureStore.getItemAsync(REFRESH_TOKEN_KEY, secureOptions)
);

export const loadSavedUser = async (): Promise<UserInfo | null> => {
  const raw = await AsyncStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as UserInfo;
  } catch {
    return null;
  }
};

export const loadSessionId = async (): Promise<number | null> => {
  const raw = await AsyncStorage.getItem(SESSION_ID_KEY);
  const value = raw ? Number(raw) : NaN;
  return Number.isInteger(value) ? value : null;
};

export const clearDeviceSession = async (): Promise<void> => {
  await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
  await AsyncStorage.multiRemove([SESSION_ID_KEY, USER_KEY, QUICK_UNLOCK_KEY]);
};

export const isQuickUnlockEnabled = async (): Promise<boolean> => (
  (await AsyncStorage.getItem(QUICK_UNLOCK_KEY)) === '1'
);

export const loadLockTimeout = async (): Promise<number> => {
  const raw = await AsyncStorage.getItem(LOCK_TIMEOUT_KEY);
  const value = raw ? Number(raw) : 60;
  return [0, 60, 300].includes(value) ? value : 60;
};

export const saveLockTimeout = async (seconds: number): Promise<void> => {
  if (![0, 60, 300].includes(seconds)) throw new Error('Некорректное время блокировки');
  await AsyncStorage.setItem(LOCK_TIMEOUT_KEY, String(seconds));
};
