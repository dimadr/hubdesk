import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, getApiError } from '../api/client';
import { DeviceSessionResponse } from '../api/types';
import { useAuthStore } from '../store/authStore';
import { ThemeColors, useAppTheme } from '../theme/ThemeContext';

const formatDate = (value: string) => new Date(value.endsWith('Z') ? value : `${value}Z`).toLocaleString('ru-RU');

export const DeviceSessionsScreen: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const currentSessionId = useAuthStore((state) => state.currentSessionId);
  const logout = useAuthStore((state) => state.logout);
  const [sessions, setSessions] = useState<DeviceSessionResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const { data } = await api.get<DeviceSessionResponse[]>('/auth/sessions');
      setSessions(data);
    } catch (requestError) {
      setError(getApiError(requestError, 'Не удалось загрузить устройства'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const revoke = (session: DeviceSessionResponse) => {
    Alert.alert('Отозвать устройство?', session.device_name, [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Отозвать', style: 'destructive', onPress: async () => {
          setBusyId(session.id);
          try {
            await api.delete(`/auth/sessions/${session.id}`);
            if (session.id === currentSessionId) await logout();
            else await load();
          } catch (requestError) {
            Alert.alert('Ошибка', getApiError(requestError, 'Не удалось отозвать устройство'));
          } finally {
            setBusyId(null);
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}><TouchableOpacity onPress={onBack}><Text style={styles.back}>Назад</Text></TouchableOpacity><Text style={styles.title}>Устройства</Text><View style={styles.spacer} /></View>
      {loading ? <ActivityIndicator color={colors.primary} size="large" style={styles.loader} /> : (
        <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} colors={[colors.primary]} tintColor={colors.primary} />}>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {sessions.map((session) => (
            <View key={session.id} style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.device}>{session.device_name}{session.id === currentSessionId ? ' · это устройство' : ''}</Text>
                <Text style={styles.meta}>Последняя активность: {formatDate(session.last_used_at)}</Text>
              </View>
              <TouchableOpacity style={styles.revoke} onPress={() => revoke(session)} disabled={busyId !== null}>
                {busyId === session.id ? <ActivityIndicator color={colors.danger} /> : <Text style={styles.revokeText}>Отозвать</Text>}
              </TouchableOpacity>
            </View>
          ))}
          {!sessions.length && !error ? <Text style={styles.empty}>Нет активных устройств</Text> : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
};

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { height: 52, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.border },
  back: { color: colors.primary, width: 70, fontWeight: '700' },
  title: { flex: 1, color: colors.text, fontSize: 17, fontWeight: '800', textAlign: 'center' },
  spacer: { width: 70 }, loader: { marginTop: 44 }, content: { padding: 14, paddingBottom: 30 },
  row: { minHeight: 78, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 12, marginBottom: 8 },
  rowText: { flex: 1, paddingRight: 10 }, device: { color: colors.text, fontSize: 14, fontWeight: '700' }, meta: { color: colors.muted, fontSize: 11, marginTop: 5 },
  revoke: { minWidth: 70, minHeight: 38, alignItems: 'center', justifyContent: 'center' }, revokeText: { color: colors.danger, fontSize: 12, fontWeight: '800' },
  error: { color: colors.danger, textAlign: 'center', marginBottom: 12 }, empty: { color: colors.subtle, textAlign: 'center', marginTop: 36 },
});
