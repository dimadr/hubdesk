import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'server_url';
const DEFAULT_URL = 'http://192.168.0.178:8002/api';

export const getSavedUrl = async (): Promise<string> => {
  return (await AsyncStorage.getItem(STORAGE_KEY)) || DEFAULT_URL;
};

export const hasSavedUrl = async (): Promise<boolean> => {
  return (await AsyncStorage.getItem(STORAGE_KEY)) !== null;
};

export const saveUrl = async (url: string): Promise<void> => {
  const sanitizedUrl = url.replace(/\/+$/, '');
  await AsyncStorage.setItem(STORAGE_KEY, sanitizedUrl);
  api.defaults.baseURL = sanitizedUrl;
};

export const api = axios.create({ baseURL: DEFAULT_URL });

api.interceptors.request.use(async (config) => {
  const token = await AsyncStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    if (error.response?.status === 401) {
      await AsyncStorage.multiRemove(['token', 'user']);
    }
    return Promise.reject(error);
  }
);

export const initApi = async (): Promise<void> => {
  const baseURL = await getSavedUrl();
  api.defaults.baseURL = baseURL;
};
