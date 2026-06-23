import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../api/client';
import { TicketResponse, STATUS_LABELS, PRIORITY_LABELS } from '../api/types';

const COLUMNS = [
  { key: 'project', label: 'В проекте', color: '#34d399', bg: 'rgba(52,211,153,.08)' },
  { key: 'todo', label: 'Дела', color: '#fbbf24', bg: 'rgba(251,191,36,.08)' },
  { key: 'in_progress', label: 'В работе', color: '#ec4899', bg: 'rgba(236,72,153,.08)' },
  { key: 'done', label: 'Завершённые', color: '#60a5fa', bg: 'rgba(96,165,250,.08)' },
];

const STATUS_MAP: Record<string, string> = {
  ASSIGNED: 'project', ACCEPTED: 'todo',
  ON_THE_WAY: 'in_progress', ARRIVED: 'in_progress', IN_PROGRESS: 'in_progress',
  REVIEW: 'done', COMPLETED: 'done',
};

export const KanbanScreen: React.FC = () => {
  const [tickets, setTickets] = useState<TicketResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  const load = useCallback(async () => {
    try {
      const user = await AsyncStorage.getItem('user');
      if (!user) return;
      let userId = 0;
      try {
        userId = JSON.parse(user).user_id;
      } catch {
        return;
      }
      const { data } = await api.get('/tickets', { params: { assignee_id: userId, limit: 50 } });
      if (isMountedRef.current) setTickets(data);
    } catch (e) {
      console.error(e);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      load().then(() => { if (active && isMountedRef.current) setLoading(false); });
      return () => { active = false; };
    }, [load])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    if (isMountedRef.current) setRefreshing(false);
  };

  const groupedTickets = useMemo(() => {
    const groups: Record<string, TicketResponse[]> = { project: [], todo: [], in_progress: [], done: [] };
    tickets.forEach(t => {
      const k = STATUS_MAP[t.status];
      if (groups[k]) groups[k].push(t);
    });
    return groups;
  }, [tickets]);

  if (loading) {
    return <SafeAreaView style={styles.container}><ActivityIndicator color="#8b5cf6" size="large" style={{ marginTop: 40 }} /></SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Моя доска</Text>
      <ScrollView
        horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.kanbanScroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#8b5cf6" colors={['#8b5cf6']} />}
      >
        {COLUMNS.map((col) => {
          const items = groupedTickets[col.key] || [];
          return (
            <View key={col.key} style={[styles.column, { backgroundColor: col.bg }]}>
              <Text style={[styles.columnTitle, { color: col.color }]}>{col.label} ({items.length})</Text>
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.columnCardsScroll}>
                {items.length === 0 ? (
                  <Text style={styles.emptyText}>Нет задач</Text>
                ) : (
                  items.map(t => (
                    <View key={t.id} style={styles.card}>
                      <Text style={styles.cardNumber}>#{t.number}</Text>
                      <Text style={styles.cardSubject} numberOfLines={2}>{t.subject}</Text>
                      <View style={styles.cardFooter}>
                        <Text style={[styles.cardPriority, { color: t.priority === 'critical' ? '#f87171' : t.priority === 'high' ? '#fbbf24' : '#9097b8' }]}>
                          {PRIORITY_LABELS[t.priority] || t.priority}
                        </Text>
                        <Text style={styles.cardStatus}>{STATUS_LABELS[t.status] || t.status}</Text>
                      </View>
                    </View>
                  ))
                )}
              </ScrollView>
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080a12' },
  title: { fontSize: 22, fontWeight: '800', color: '#eaf0ff', margin: 14, marginBottom: 10 },
  kanbanScroll: { paddingHorizontal: 14, paddingBottom: 20, gap: 12 },
  column: { width: 260, borderRadius: 14, padding: 12, maxHeight: '98%', backgroundColor: '#0d1020' },
  columnTitle: { fontSize: 14, fontWeight: '700', marginBottom: 12, letterSpacing: 0.3 },
  columnCardsScroll: { paddingBottom: 16 },
  card: { backgroundColor: '#111527', borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,.05)' },
  cardNumber: { fontSize: 10, color: '#5f6690', fontWeight: '700' },
  cardSubject: { fontSize: 13, fontWeight: '600', color: '#eaf0ff', marginVertical: 6, lineHeight: 18 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  cardPriority: { fontSize: 11, fontWeight: '600' },
  cardStatus: { fontSize: 10, color: '#6b7280', fontWeight: '500' },
  emptyText: { color: '#475569', fontSize: 12, textAlign: 'center', marginTop: 20, fontStyle: 'italic' }
});
