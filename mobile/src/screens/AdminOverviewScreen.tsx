import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { api, getApiError } from '../api/client';
import { ThemeColors, useAppTheme } from '../theme/ThemeContext';

interface Stats {
  total_users: number;
  total_customers: number;
  total_locations: number;
  total_warehouses: number;
  total_tickets: number;
  open_tickets: number;
  overdue_tickets: number;
  completed_tickets: number;
  user_breakdown: { role: string; count: number }[];
}

interface UserRow {
  id: number;
  email: string;
  name: string;
  phone?: string | null;
  patronymic?: string | null;
  role: string;
  status?: string;
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'Администратор', director: 'Директор', dispatcher: 'Диспетчер', engineer: 'Инженер',
  customer: 'Заказчик', storekeeper: 'Кладовщик', viewer: 'Наблюдатель', metrologist: 'Метролог', accountant: 'Бухгалтер',
};

export const AdminOverviewScreen: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const [statsResponse, usersResponse] = await Promise.all([
        api.get<Stats>('/admin/stats'),
        api.get<UserRow[]>('/users/list'),
      ]);
      setStats(statsResponse.data);
      setUsers(usersResponse.data);
    } catch (e) {
      setError(getApiError(e, 'Не удалось загрузить админку'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}><TouchableOpacity onPress={onBack}><Text style={styles.back}>Назад</Text></TouchableOpacity><Text style={styles.headerTitle}>Админка</Text><View style={styles.spacer} /></View>
      {loading ? <ActivityIndicator color={colors.primary} size="large" style={styles.loader} /> : (
        <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} colors={[colors.primary]} tintColor={colors.primary} />}>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {stats && (
            <>
              <View style={styles.kpiGrid}>
                <Kpi label="Пользователей" value={stats.total_users} styles={styles} />
                <Kpi label="Клиентов" value={stats.total_customers} styles={styles} />
                <Kpi label="Объектов" value={stats.total_locations} styles={styles} />
                <Kpi label="Заявок" value={stats.total_tickets} styles={styles} />
                <Kpi label="Открыто" value={stats.open_tickets} styles={styles} />
                <Kpi label="Просрочено" value={stats.overdue_tickets} danger styles={styles} />
              </View>
              <Text style={styles.sectionTitle}>Пользователи по ролям</Text>
              {stats.user_breakdown.map((item) => <View key={item.role} style={styles.summaryRow}><Text style={styles.summaryLabel}>{ROLE_LABELS[item.role] || item.role}</Text><Text style={styles.summaryValue}>{item.count}</Text></View>)}
            </>
          )}
          <Text style={styles.sectionTitle}>Пользователи</Text>
          {users.map((user) => (
            <View key={user.id} style={styles.userCard}>
              <Text style={styles.userName}>{user.name} {user.patronymic || ''}</Text>
              <Text style={styles.userMeta}>{ROLE_LABELS[user.role] || user.role}{user.status ? ` · ${user.status}` : ''}</Text>
              <Text style={styles.userMeta}>{user.email}{user.phone ? ` · ${user.phone}` : ''}</Text>
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
};

const Kpi = ({ label, value, danger, styles }: { label: string; value: number; danger?: boolean; styles: ReturnType<typeof createStyles> }) => (
  <View style={styles.kpi}><Text style={styles.kpiLabel}>{label}</Text><Text style={[styles.kpiValue, danger && styles.danger]}>{value}</Text></View>
);

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { height: 52, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.border },
  back: { color: colors.primary, width: 70, fontWeight: '700' },
  headerTitle: { flex: 1, color: colors.text, fontSize: 17, fontWeight: '800', textAlign: 'center' },
  spacer: { width: 70 }, loader: { marginTop: 44 },
  content: { padding: 14, paddingBottom: 32 }, error: { color: colors.danger, textAlign: 'center', marginBottom: 12 },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  kpi: { width: '48%', minHeight: 78, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 12 },
  kpiLabel: { color: colors.muted, fontSize: 11, fontWeight: '700' }, kpiValue: { color: colors.text, fontSize: 25, fontWeight: '800', marginTop: 7 }, danger: { color: colors.danger },
  sectionTitle: { color: colors.subtle, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', marginTop: 20, marginBottom: 8 },
  summaryRow: { minHeight: 38, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.border },
  summaryLabel: { flex: 1, color: colors.secondary, fontSize: 13 }, summaryValue: { color: colors.text, fontWeight: '800' },
  userCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 12, marginBottom: 7 },
  userName: { color: colors.text, fontSize: 14, fontWeight: '700' }, userMeta: { color: colors.muted, fontSize: 11, marginTop: 4 },
});
