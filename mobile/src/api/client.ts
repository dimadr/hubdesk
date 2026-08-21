import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'server_url';
let unauthorizedHandler: (() => void | Promise<void>) | null = null;
let refreshHandler: (() => Promise<string | null>) | null = null;
let refreshPromise: Promise<string | null> | null = null;
let accessToken: string | null = null;

export const normalizeApiUrl = (url: string): string => {
  let sanitizedUrl = url.trim().replace(/\/+$/, '');
  if (!sanitizedUrl) return '';
  if (!/^https?:\/\//i.test(sanitizedUrl)) sanitizedUrl = `http://${sanitizedUrl}`;
  return sanitizedUrl.endsWith('/api') ? sanitizedUrl : `${sanitizedUrl}/api`;
};

export const getApiError = (error: any, fallback = 'Не удалось выполнить запрос'): string => {
  const detail = error?.response?.data?.detail;
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => typeof item === 'string' ? item : item?.msg)
      .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()));
    if (messages.length) return messages.join('\n');
  }
  if (error?.code === 'ERR_NETWORK' || !error?.response) return 'Нет связи с сервером';
  return fallback;
};

export const getSavedUrl = async (): Promise<string> => {
  return (await AsyncStorage.getItem(STORAGE_KEY)) || '';
};

export const hasSavedUrl = async (): Promise<boolean> => Boolean(await getSavedUrl());

export const saveUrl = async (url: string): Promise<void> => {
  const sanitizedUrl = normalizeApiUrl(url);
  if (!sanitizedUrl) throw new Error('Введите адрес сервера');
  await AsyncStorage.setItem(STORAGE_KEY, sanitizedUrl);
  api.defaults.baseURL = sanitizedUrl;
  sessionApi.defaults.baseURL = sanitizedUrl;
};

export const setUnauthorizedHandler = (handler: () => void | Promise<void>): void => {
  unauthorizedHandler = handler;
};

export const setRefreshHandler = (handler: () => Promise<string | null>): void => {
  refreshHandler = handler;
};

export const setAccessToken = (token: string | null): void => {
  accessToken = token;
};

export const api = axios.create({ timeout: 15000 });
export const sessionApi = axios.create({ timeout: 15000 });

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const requestUrl = error.config?.url || '';
    const canRefresh = error.response?.status === 401
      && !requestUrl.includes('/login')
      && !requestUrl.includes('/auth/refresh')
      && !error.config?._authRetried;
    if (canRefresh && refreshHandler) {
      error.config._authRetried = true;
      refreshPromise ||= refreshHandler().finally(() => { refreshPromise = null; });
      const nextToken = await refreshPromise;
      if (nextToken) {
        error.config.headers.Authorization = `Bearer ${nextToken}`;
        return api.request(error.config);
      }
    }
    if (error.response?.status === 401 && !requestUrl.includes('/login')) {
      if (unauthorizedHandler) await unauthorizedHandler();
    }
    return Promise.reject(error);
  },
);

export const initApi = async (): Promise<void> => {
  const baseURL = await getSavedUrl() || undefined;
  api.defaults.baseURL = baseURL;
  sessionApi.defaults.baseURL = baseURL;
};
