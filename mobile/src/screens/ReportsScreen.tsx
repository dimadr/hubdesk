import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { api, getApiError } from '../api/client';
import { ThemeColors, useAppTheme } from '../theme/ThemeContext';

interface TicketStats {
  total: number;
  by_status: { label: string; count: number }[];
  by_priority: { label: string; count: number }[];
  avg_resolution_hours: number;
  sla_percent: number;
}

interface ObjectRow {
  location_id: number;
  location_name: string;
  customer_name: string;
  total: number;
  open: number;
  closed: number;
  overdue: number;
  avg_resolution_hours: number;
}

interface EngineerRow {
  engineer_id: number;
  engineer_name: string;
  total: number;
  completed: number;
  in_progress: number;
  overdue: number;
  avg_resolution_hours: number;
}

type ReportTab = 'tickets' | 'objects' | 'engineers';

export const ReportsScreen: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [tab, setTab] = useState<ReportTab>('tickets');
  const [tickets, setTickets] = useState<TicketStats | null>(null);
  const [objects, setObjects] = useState<ObjectRow[]>([]);
  const [engineers, setEngineers] = useState<EngineerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const [ticketResponse, objectResponse, engineerResponse] = await Promise.all([
        api.get<TicketStats>('/reports/tickets'),
        api.get<ObjectRow[]>('/reports/objects'),
        api.get<EngineerRow[]>('/reports/engineers'),
      ]);
      setTickets(ticketResponse.data);
      setObjects(objectResponse.data);
      setEngineers(engineerResponse.data);
    } catch (e) {
      setError(getApiError(e, 'Не удалось загрузить отчёты'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}><TouchableOpacity onPress={onBack}><Text style={styles.back}>Назад</Text></TouchableOpacity><Text style={styles.headerTitle}>Отчёты</Text><View style={styles.spacer} /></View>
      <View style={styles.tabs}>
        {([['tickets', 'Заявки'], ['objects', 'Объекты'], ['engineers', 'Инженеры']] as const).map(([key, label]) => (
          <TouchableOpacity key={key} style={[styles.tab, tab === key && styles.tabActive]} onPress={() => setTab(key)}><Text style={[styles.tabText, tab === key && styles.tabTextActive]}>{label}</Text></TouchableOpacity>
        ))}
      </View>
      {loading ? <ActivityIndicator color={colors.primary} size="large" style={styles.loader} /> : (
        <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} colors={[colors.primary]} tintColor={colors.primary} />}>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {tab === 'tickets' && tickets && (
            <>
              <View style={styles.kpiGrid}>
                <Kpi label="Всего" value={tickets.total} styles={styles} />
                <Kpi label="SLA" value={`${tickets.sla_percent}%`} styles={styles} />
                <Kpi label="Среднее время" value={`${tickets.avg_resolution_hours} ч`} styles={styles} />
              </View>
              <Text style={styles.sectionTitle}>По статусам</Text>
              {tickets.by_status.map((row) => <SummaryRow key={row.label} label={row.label} value={row.count} styles={styles} />)}
              <Text style={styles.sectionTitle}>По приоритетам</Text>
              {tickets.by_priority.map((row) => <SummaryRow key={row.label} label={row.label} value={row.count} styles={styles} />)}
            </>
          )}
          {tab === 'objects' && objects.map((item) => (
            <View key={item.location_id} style={styles.card}><Text style={styles.cardTitle}>{item.location_name || item.customer_name}</Text><Text style={styles.cardMeta}>Всего: {item.total} · Открыто: {item.open} · Закрыто: {item.closed}</Text><Text style={[styles.cardMeta, item.overdue > 0 && styles.danger]}>Просрочено: {item.overdue} · Среднее: {item.avg_resolution_hours} ч</Text></View>
          ))}
          {tab === 'engineers' && engineers.map((item) => (
            <View key={item.engineer_id} style={styles.card}><Text style={styles.cardTitle}>{item.engineer_name}</Text><Text style={styles.cardMeta}>Всего: {item.total} · В работе: {item.in_progress} · Завершено: {item.completed}</Text><Text style={[styles.cardMeta, item.overdue > 0 && styles.danger]}>Просрочено: {item.overdue} · Среднее: {item.avg_resolution_hours} ч</Text></View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
};

const Kpi = ({ label, value, styles }: { label: string; value: number | string; styles: ReturnType<typeof createStyles> }) => <View style={styles.kpi}><Text style={styles.kpiLabel}>{label}</Text><Text style={styles.kpiValue}>{value}</Text></View>;
const SummaryRow = ({ label, value, styles }: { label: string; value: number; styles: ReturnType<typeof createStyles> }) => <View style={styles.summaryRow}><Text style={styles.summaryLabel}>{label}</Text><Text style={styles.summaryValue}>{value}</Text></View>;

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { height: 52, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.border },
  back: { color: colors.primary, width: 70, fontWeight: '700' }, headerTitle: { flex: 1, color: colors.text, fontSize: 17, fontWeight: '800', textAlign: 'center' }, spacer: { width: 70 },
  tabs: { flexDirection: 'row', gap: 6, padding: 10, paddingHorizontal: 14 }, tab: { flex: 1, height: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.input, borderRadius: 7 }, tabActive: { backgroundColor: colors.primary }, tabText: { color: colors.muted, fontSize: 12, fontWeight: '700' }, tabTextActive: { color: colors.onPrimary },
  content: { padding: 14, paddingTop: 4, paddingBottom: 30 }, loader: { marginTop: 44 }, error: { color: colors.danger, textAlign: 'center', marginBottom: 12 },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, kpi: { minWidth: '47%', flexGrow: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 12 }, kpiLabel: { color: colors.muted, fontSize: 11 }, kpiValue: { color: colors.text, fontSize: 22, fontWeight: '800', marginTop: 6 },
  sectionTitle: { color: colors.subtle, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', marginTop: 20, marginBottom: 8 }, summaryRow: { minHeight: 40, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.border }, summaryLabel: { flex: 1, color: colors.secondary, fontSize: 13 }, summaryValue: { color: colors.text, fontWeight: '800' },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 13, marginBottom: 8 }, cardTitle: { color: colors.text, fontSize: 14, fontWeight: '800' }, cardMeta: { color: colors.muted, fontSize: 12, marginTop: 5 }, danger: { color: colors.danger },
});
