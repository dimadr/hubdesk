import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { api, getApiError } from '../api/client';
import { PRIORITY_LABELS, TicketResponse, UserInfo } from '../api/types';
import { ThemeColors, useAppTheme } from '../theme/ThemeContext';

const COLUMNS = [
  { key: 'ASSIGNED', label: 'Назначены', color: '#60a5fa' },
  { key: 'ACCEPTED', label: 'Приняты', color: '#a78bfa' },
  { key: 'IN_PROGRESS', label: 'В работе', color: '#fbbf24' },
  { key: 'COMPLETED', label: 'Завершены', color: '#34d399' },
] as const;

const ZOOM_LEVELS = [1, 1.6, 2.4, 3.2];

export const KanbanScreen: React.FC<{ user: UserInfo; onOpen: (ticket: TicketResponse) => void }> = ({ user, onOpen }) => {
  const { width } = useWindowDimensions();
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [tickets, setTickets] = useState<TicketResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [zoomIndex, setZoomIndex] = useState(0);

  const load = useCallback(async () => {
    setError('');
    try {
      const active: TicketResponse[] = [];
      let offset = 0;
      while (true) {
        const { data } = await api.get<TicketResponse[]>('/tickets', { params: { assignee_id: user.user_id, archived: false, limit: 100, offset } });
        active.push(...data);
        if (data.length < 100) break;
        offset += data.length;
      }
      const { data: completed } = await api.get<TicketResponse[]>('/tickets', { params: { assignee_id: user.user_id, status: 'COMPLETED', archived: true, limit: 50 } });
      setTickets([...active, ...completed]);
    } catch (e) {
      setError(getApiError(e, 'Не удалось загрузить доску'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user.user_id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const groups = useMemo(() => Object.fromEntries(COLUMNS.map((column) => [column.key, tickets.filter((ticket) => ticket.status === column.key)])), [tickets]);
  const fitColumnWidth = Math.max(76, (width - 28 - 18) / 4);
  const zoom = ZOOM_LEVELS[zoomIndex];
  const columnWidth = fitColumnWidth * zoom;
  const compact = zoomIndex === 0;

  if (loading) return <SafeAreaView style={styles.container}><ActivityIndicator color={colors.primary} size="large" style={styles.loader} /></SafeAreaView>;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Моя доска</Text>
        <View style={styles.zoomControls}>
          <TouchableOpacity style={[styles.zoomButton, zoomIndex === 0 && styles.zoomDisabled]} onPress={() => setZoomIndex((value) => Math.max(0, value - 1))} disabled={zoomIndex === 0}><Text style={styles.zoomText}>−</Text></TouchableOpacity>
          <Text style={styles.zoomValue}>{Math.round(zoom * 100)}%</Text>
          <TouchableOpacity style={[styles.zoomButton, zoomIndex === ZOOM_LEVELS.length - 1 && styles.zoomDisabled]} onPress={() => setZoomIndex((value) => Math.min(ZOOM_LEVELS.length - 1, value + 1))} disabled={zoomIndex === ZOOM_LEVELS.length - 1}><Text style={styles.zoomText}>＋</Text></TouchableOpacity>
        </View>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <ScrollView style={styles.verticalScroll} contentContainerStyle={styles.verticalContent} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} colors={[colors.primary]} />}>
        <ScrollView horizontal showsHorizontalScrollIndicator={zoomIndex > 0} contentContainerStyle={styles.board} nestedScrollEnabled>
          {COLUMNS.map((column) => (
            <View key={column.key} style={[styles.column, { width: columnWidth }, compact && styles.columnCompact]}>
              <View style={[styles.columnHeader, compact && styles.columnHeaderCompact]}><View style={[styles.dot, { backgroundColor: column.color }]} /><Text style={[styles.columnTitle, compact && styles.columnTitleCompact]} numberOfLines={2}>{column.label}</Text><Text style={[styles.count, compact && styles.countCompact]}>{groups[column.key].length}</Text></View>
              <View style={styles.cards}>
              {groups[column.key].map((ticket) => (
                <TouchableOpacity key={ticket.id} style={[styles.card, compact && styles.cardCompact]} onPress={() => onOpen(ticket)} activeOpacity={0.75}>
                  <Text style={[styles.number, compact && styles.numberCompact]}>#{ticket.number}</Text>
                  <Text style={[styles.subject, compact && styles.subjectCompact]} numberOfLines={compact ? 3 : 4}>{ticket.subject}</Text>
                  {!compact && ticket.location_name ? <Text style={styles.location} numberOfLines={2}>{ticket.location_name}</Text> : null}
                  {!compact ? <Text style={[styles.priority, ticket.priority === 'critical' && styles.critical]}>{PRIORITY_LABELS[ticket.priority]}</Text> : null}
                </TouchableOpacity>
              ))}
              {!groups[column.key].length && <Text style={[styles.empty, compact && styles.emptyCompact]}>—</Text>}
              </View>
            </View>
          ))}
        </ScrollView>
      </ScrollView>
    </SafeAreaView>
  );
};

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background }, loader: { marginTop: 44 }, error: { color: colors.danger, marginHorizontal: 14, marginBottom: 8 },
  header: { height: 52, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center' }, title: { flex: 1, color: colors.text, fontSize: 23, fontWeight: '800' },
  zoomControls: { height: 34, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.input, borderRadius: 7, borderWidth: 1, borderColor: colors.border },
  zoomButton: { width: 34, height: 32, alignItems: 'center', justifyContent: 'center' }, zoomDisabled: { opacity: 0.3 }, zoomText: { color: colors.primary, fontSize: 21, fontWeight: '800' }, zoomValue: { minWidth: 43, color: colors.muted, fontSize: 10, fontWeight: '700', textAlign: 'center' },
  verticalScroll: { flex: 1 }, verticalContent: { paddingBottom: 16 },
  board: { paddingHorizontal: 14, gap: 6, alignItems: 'flex-start' }, column: { backgroundColor: colors.input, borderRadius: 8, padding: 9, borderWidth: 1, borderColor: colors.border, alignSelf: 'flex-start' }, columnCompact: { padding: 4, borderRadius: 6 },
  columnHeader: { minHeight: 34, flexDirection: 'row', alignItems: 'center' }, columnHeaderCompact: { minHeight: 31, alignItems: 'flex-start', paddingTop: 4 }, dot: { width: 7, height: 7, borderRadius: 4, marginRight: 5, marginTop: 3 },
  columnTitle: { flex: 1, color: colors.text, fontSize: 13, fontWeight: '800' }, columnTitleCompact: { fontSize: 8, lineHeight: 10 }, count: { marginLeft: 4, color: colors.muted, fontSize: 11 }, countCompact: { fontSize: 8 }, cards: { paddingBottom: 12 },
  card: { backgroundColor: colors.surface, borderRadius: 7, padding: 10, marginBottom: 7, borderWidth: 1, borderColor: colors.border }, cardCompact: { borderRadius: 5, padding: 4, marginBottom: 4 }, number: { color: colors.subtle, fontSize: 10, fontWeight: '700' }, numberCompact: { fontSize: 7 },
  subject: { color: colors.text, fontSize: 13, fontWeight: '700', lineHeight: 18, marginTop: 4 }, subjectCompact: { fontSize: 8, lineHeight: 10, marginTop: 2 }, location: { color: colors.muted, fontSize: 11, marginTop: 5 }, priority: { color: colors.muted, fontSize: 10, marginTop: 7 }, critical: { color: colors.danger, fontWeight: '800' },
  empty: { color: colors.subtle, textAlign: 'center', marginTop: 24 }, emptyCompact: { fontSize: 9, marginTop: 10 },
});
