import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, Modal, RefreshControl, ScrollView, StyleSheet, Text,
  TextInput, TouchableOpacity, useWindowDimensions, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { api, getApiError } from '../api/client';
import {
  PersonalTaskColumn, PersonalTaskResponse, PRIORITY_LABELS, TicketResponse, UserInfo,
} from '../api/types';
import { ThemeColors, useAppTheme } from '../theme/ThemeContext';

const COLUMNS: ReadonlyArray<{ key: PersonalTaskColumn; label: string; color: string }> = [
  { key: 'project', label: 'В проекте', color: '#60a5fa' },
  { key: 'todo', label: 'Дела', color: '#a78bfa' },
  { key: 'in_progress', label: 'В работе', color: '#fbbf24' },
  { key: 'done', label: 'Завершённые', color: '#34d399' },
];

const TICKET_COLUMNS: Record<string, PersonalTaskColumn> = {
  ASSIGNED: 'project', ACCEPTED: 'todo', IN_PROGRESS: 'in_progress', COMPLETED: 'done',
};
const ZOOM_LEVELS = [1, 1.6, 2.4, 3.2];

type BoardItem =
  | { kind: 'ticket'; id: string; column: PersonalTaskColumn; ticket: TicketResponse }
  | { kind: 'task'; id: string; column: PersonalTaskColumn; task: PersonalTaskResponse };

export const KanbanScreen: React.FC<{ user: UserInfo; onOpen: (ticket: TicketResponse) => void }> = ({ user, onOpen }) => {
  const { width } = useWindowDimensions();
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [tickets, setTickets] = useState<TicketResponse[]>([]);
  const [tasks, setTasks] = useState<PersonalTaskResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [zoomIndex, setZoomIndex] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newColumn, setNewColumn] = useState<PersonalTaskColumn>('todo');

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
      const [{ data: completed }, { data: personalTasks }] = await Promise.all([
        api.get<TicketResponse[]>('/tickets', { params: { assignee_id: user.user_id, status: 'COMPLETED', archived: true, limit: 50 } }),
        api.get<PersonalTaskResponse[]>('/personal-tasks'),
      ]);
      setTickets([...active, ...completed]);
      setTasks(personalTasks);
    } catch (e) {
      setError(getApiError(e, 'Не удалось загрузить доску'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user.user_id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const items = useMemo<BoardItem[]>(() => [
    ...tickets.map((ticket): BoardItem => ({ kind: 'ticket', id: `ticket-${ticket.id}`, column: TICKET_COLUMNS[ticket.status], ticket })),
    ...tasks.map((task): BoardItem => ({ kind: 'task', id: `task-${task.id}`, column: task.column, task })),
  ], [tasks, tickets]);
  const groups = useMemo(() => Object.fromEntries(COLUMNS.map((column) => [column.key, items.filter((item) => item.column === column.key)])) as Record<PersonalTaskColumn, BoardItem[]>, [items]);
  const fitColumnWidth = Math.max(76, (width - 28 - 18) / 4);
  const zoom = ZOOM_LEVELS[zoomIndex];
  const columnWidth = fitColumnWidth * zoom;
  const compact = zoomIndex === 0;

  const createTask = async () => {
    const title = newTitle.trim();
    if (!title || busy) return;
    setBusy(true);
    try {
      await api.post('/personal-tasks', { title, column: newColumn });
      setNewTitle('');
      setCreateOpen(false);
      await load();
    } catch (e) {
      Alert.alert('Дело не добавлено', getApiError(e));
    } finally {
      setBusy(false);
    }
  };

  const moveTask = async (task: PersonalTaskResponse, direction: -1 | 1) => {
    const index = COLUMNS.findIndex((column) => column.key === task.column);
    const nextColumn = COLUMNS[index + direction];
    if (!nextColumn || busy) return;
    setBusy(true);
    try {
      await api.patch(`/personal-tasks/${task.id}`, { column: nextColumn.key });
      setTasks((current) => current.map((item) => item.id === task.id ? { ...item, column: nextColumn.key } : item));
    } catch (e) {
      Alert.alert('Дело не перемещено', getApiError(e));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <SafeAreaView style={styles.container}><ActivityIndicator color={colors.primary} size="large" style={styles.loader} /></SafeAreaView>;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Моя доска</Text>
        <TouchableOpacity style={styles.addButton} onPress={() => setCreateOpen(true)}><Text style={styles.addText}>＋</Text></TouchableOpacity>
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
                {groups[column.key].map((item) => item.kind === 'ticket' ? (
                  <TouchableOpacity key={item.id} style={[styles.card, compact && styles.cardCompact]} onPress={() => onOpen(item.ticket)} activeOpacity={0.75}>
                    <Text style={[styles.number, compact && styles.numberCompact]}>Заявка #{item.ticket.number}</Text>
                    <Text style={[styles.subject, compact && styles.subjectCompact]} numberOfLines={compact ? 3 : 4}>{item.ticket.subject}</Text>
                    {!compact && item.ticket.location_name ? <Text style={styles.location} numberOfLines={2}>{item.ticket.location_name}</Text> : null}
                    {!compact ? <Text style={[styles.priority, item.ticket.priority === 'critical' && styles.critical]}>{PRIORITY_LABELS[item.ticket.priority]}</Text> : null}
                  </TouchableOpacity>
                ) : (
                  <View key={item.id} style={[styles.card, styles.taskCard, compact && styles.cardCompact]}>
                    <Text style={[styles.number, compact && styles.numberCompact]}>Личное дело</Text>
                    <Text style={[styles.subject, compact && styles.subjectCompact]} numberOfLines={compact ? 4 : 6}>{item.task.title}</Text>
                    <View style={styles.moveRow}>
                      <TouchableOpacity style={styles.moveButton} onPress={() => moveTask(item.task, -1)} disabled={busy || item.task.column === COLUMNS[0].key}><Text style={styles.moveText}>‹</Text></TouchableOpacity>
                      <TouchableOpacity style={styles.moveButton} onPress={() => moveTask(item.task, 1)} disabled={busy || item.task.column === COLUMNS[COLUMNS.length - 1].key}><Text style={styles.moveText}>›</Text></TouchableOpacity>
                    </View>
                  </View>
                ))}
                {!groups[column.key].length && <Text style={[styles.empty, compact && styles.emptyCompact]}>—</Text>}
              </View>
            </View>
          ))}
        </ScrollView>
      </ScrollView>

      <Modal visible={createOpen} transparent animationType="fade" onRequestClose={() => setCreateOpen(false)}>
        <View style={styles.modalBackdrop}><View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Новое личное дело</Text>
          <TextInput style={styles.modalInput} value={newTitle} onChangeText={setNewTitle} placeholder="Что нужно сделать" placeholderTextColor={colors.subtle} multiline autoFocus maxLength={500} />
          <Text style={styles.modalLabel}>Колонка</Text>
          <View style={styles.columnChoices}>{COLUMNS.map((column) => <TouchableOpacity key={column.key} style={[styles.choice, newColumn === column.key && styles.choiceActive]} onPress={() => setNewColumn(column.key)}><Text style={[styles.choiceText, newColumn === column.key && styles.choiceTextActive]}>{column.label}</Text></TouchableOpacity>)}</View>
          <View style={styles.modalActions}><TouchableOpacity style={styles.cancelButton} onPress={() => setCreateOpen(false)} disabled={busy}><Text style={styles.cancelText}>Отмена</Text></TouchableOpacity><TouchableOpacity style={[styles.saveButton, (!newTitle.trim() || busy) && styles.disabled]} onPress={createTask} disabled={!newTitle.trim() || busy}>{busy ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.saveText}>Добавить</Text>}</TouchableOpacity></View>
        </View></View>
      </Modal>
    </SafeAreaView>
  );
};

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background }, loader: { marginTop: 44 }, error: { color: colors.danger, marginHorizontal: 14, marginBottom: 8 },
  header: { height: 52, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 7 }, title: { flex: 1, color: colors.text, fontSize: 23, fontWeight: '800' }, addButton: { width: 34, height: 34, borderRadius: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary }, addText: { color: colors.onPrimary, fontSize: 21, fontWeight: '800' },
  zoomControls: { height: 34, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.input, borderRadius: 7, borderWidth: 1, borderColor: colors.border }, zoomButton: { width: 30, height: 32, alignItems: 'center', justifyContent: 'center' }, zoomDisabled: { opacity: 0.3 }, zoomText: { color: colors.primary, fontSize: 20, fontWeight: '800' }, zoomValue: { minWidth: 40, color: colors.muted, fontSize: 10, fontWeight: '700', textAlign: 'center' },
  verticalScroll: { flex: 1 }, verticalContent: { paddingBottom: 16 }, board: { paddingHorizontal: 14, gap: 6, alignItems: 'flex-start' }, column: { backgroundColor: colors.input, borderRadius: 8, padding: 9, borderWidth: 1, borderColor: colors.border, alignSelf: 'flex-start' }, columnCompact: { padding: 4, borderRadius: 6 }, columnHeader: { minHeight: 34, flexDirection: 'row', alignItems: 'center' }, columnHeaderCompact: { minHeight: 31, alignItems: 'flex-start', paddingTop: 4 }, dot: { width: 7, height: 7, borderRadius: 4, marginRight: 5, marginTop: 3 }, columnTitle: { flex: 1, color: colors.text, fontSize: 13, fontWeight: '800' }, columnTitleCompact: { fontSize: 8, lineHeight: 10 }, count: { marginLeft: 4, color: colors.muted, fontSize: 11 }, countCompact: { fontSize: 8 }, cards: { paddingBottom: 12 },
  card: { backgroundColor: colors.surface, borderRadius: 7, padding: 10, marginBottom: 7, borderWidth: 1, borderColor: colors.border }, taskCard: { borderLeftWidth: 3, borderLeftColor: colors.primary }, cardCompact: { borderRadius: 5, padding: 4, marginBottom: 4 }, number: { color: colors.subtle, fontSize: 10, fontWeight: '700' }, numberCompact: { fontSize: 7 }, subject: { color: colors.text, fontSize: 13, fontWeight: '700', lineHeight: 18, marginTop: 4 }, subjectCompact: { fontSize: 8, lineHeight: 10, marginTop: 2 }, location: { color: colors.muted, fontSize: 11, marginTop: 5 }, priority: { color: colors.muted, fontSize: 10, marginTop: 7 }, critical: { color: colors.danger, fontWeight: '800' }, moveRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }, moveButton: { minWidth: 28, height: 24, alignItems: 'center', justifyContent: 'center', borderRadius: 5, backgroundColor: colors.input }, moveText: { color: colors.primarySoft, fontSize: 19, lineHeight: 20, fontWeight: '800' }, empty: { color: colors.subtle, textAlign: 'center', marginTop: 24 }, emptyCompact: { fontSize: 9, marginTop: 10 },
  modalBackdrop: { flex: 1, justifyContent: 'center', padding: 20, backgroundColor: 'rgba(0,0,0,.65)' }, modalCard: { backgroundColor: colors.surface, borderRadius: 8, borderWidth: 1, borderColor: colors.border, padding: 16 }, modalTitle: { color: colors.text, fontSize: 18, fontWeight: '800', marginBottom: 12 }, modalInput: { minHeight: 88, color: colors.text, backgroundColor: colors.input, borderRadius: 7, borderWidth: 1, borderColor: colors.border, padding: 10, textAlignVertical: 'top' }, modalLabel: { color: colors.muted, fontSize: 11, fontWeight: '800', marginTop: 13, marginBottom: 6 }, columnChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 }, choice: { paddingHorizontal: 9, paddingVertical: 8, borderRadius: 6, backgroundColor: colors.input, borderWidth: 1, borderColor: colors.border }, choiceActive: { backgroundColor: colors.primary, borderColor: colors.primary }, choiceText: { color: colors.muted, fontSize: 11, fontWeight: '700' }, choiceTextActive: { color: colors.onPrimary }, modalActions: { flexDirection: 'row', gap: 8, marginTop: 16 }, cancelButton: { flex: 1, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 7, borderWidth: 1, borderColor: colors.border }, cancelText: { color: colors.secondary, fontWeight: '700' }, saveButton: { flex: 1, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 7, backgroundColor: colors.primary }, saveText: { color: colors.onPrimary, fontWeight: '800' }, disabled: { opacity: 0.5 },
});
