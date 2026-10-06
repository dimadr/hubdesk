import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getSavedUrl, normalizeApiUrl, saveUrl } from '../api/client';
import { ThemeColors, useAppTheme } from '../theme/ThemeContext';

interface Props {
  onDone: () => void;
  onCancel?: () => void;
  onBeforeSave?: () => void | Promise<void>;
  onLogout?: () => void;
}

export const ServerSetupScreen: React.FC<Props> = ({ onDone, onCancel, onBeforeSave, onLogout }) => {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getSavedUrl().then(setUrl).catch(() => {});
  }, []);

  const testConnection = async () => {
    const cleanUrl = normalizeApiUrl(url);
    if (!cleanUrl) {
      Alert.alert('Ошибка', 'Введите адрес сервера');
      return;
    }

    setLoading(true);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 7000);
    try {
      const response = await fetch(`${cleanUrl}/health`, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (data?.status !== 'ok') throw new Error('Сервер не готов к работе');
      if (onBeforeSave) await onBeforeSave();
      await saveUrl(cleanUrl);
      Alert.alert('Готово', 'Сервер подключен');
      onDone();
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        Alert.alert('Нет ответа', 'Сервер не ответил за 7 секунд');
      } else {
        Alert.alert('Ошибка подключения', 'Проверьте адрес сервера и подключение к сети');
      }
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Абие</Text>
        <Text style={styles.subtitle}>Адрес сервера</Text>
        <TextInput
          style={styles.input}
          placeholder="http://server:8002 или https://desk.example.ru"
          placeholderTextColor={colors.subtle}
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          keyboardType="url"
          autoCorrect={false}
          editable={!loading}
        />
        <TouchableOpacity style={[styles.button, loading && styles.disabled]} onPress={testConnection} disabled={loading}>
          {loading ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.buttonText}>Проверить и сохранить</Text>}
        </TouchableOpacity>
        {onCancel && (
          <TouchableOpacity style={styles.cancel} onPress={onCancel} disabled={loading}>
            <Text style={styles.cancelText}>Отмена</Text>
          </TouchableOpacity>
        )}
        {onLogout && (
          <TouchableOpacity style={styles.logout} onPress={onLogout} disabled={loading}>
            <Text style={styles.logoutText}>Выйти из учетной записи</Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
};

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, justifyContent: 'center', padding: 24 },
  card: { backgroundColor: colors.surface, borderRadius: 8, padding: 24, borderWidth: 1, borderColor: colors.border },
  title: { fontSize: 28, fontWeight: '800', color: colors.text, textAlign: 'center' },
  subtitle: { fontSize: 14, color: colors.muted, textAlign: 'center', marginTop: 6, marginBottom: 24 },
  input: { backgroundColor: colors.input, borderRadius: 8, padding: 14, fontSize: 15, color: colors.text, borderWidth: 1, borderColor: colors.border },
  button: { backgroundColor: colors.primary, borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 12 },
  disabled: { opacity: 0.6 },
  buttonText: { color: colors.onPrimary, fontSize: 15, fontWeight: '700' },
  cancel: { padding: 12, alignItems: 'center', marginTop: 4 },
  cancelText: { color: colors.muted, fontSize: 14, fontWeight: '600' },
  logout: { padding: 12, alignItems: 'center', marginTop: 8, borderTopWidth: 1, borderTopColor: colors.border },
  logoutText: { color: colors.danger, fontSize: 14, fontWeight: '700' },
});
