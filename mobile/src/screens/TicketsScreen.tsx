import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, ScrollView, FlatList, TouchableOpacity, TextInput, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../api/client';
import { TicketResponse, STATUS_LABELS, PRIORITY_LABELS, FILTER_TABS } from '../api/types';

const STATUS_COLORS: Record<string, string> = {
  ASSIGNED: '#60a5fa', ACCEPTED: '#a78bfa', ON_THE_WAY: '#fbbf24',
  ARRIVED: '#93c5fd', IN_PROGRESS: '#60a5fa', REVIEW: '#a78bfa', COMPLETED: '#34d399',
};

export const TicketsScreen: React.FC<{ onOpen: (ticket: TicketResponse) => void }> = ({ onOpen }) => {
  const [tickets, setTickets] = useState<TicketResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');

  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchTickets = useCallback(async (currentTab: string, currentSearch: string, isRefresh = false) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    
    const controller = new AbortController();
    abortControllerRef.current = controller;

    if (!isRefresh) setLoading(true);

    try {
      const params: any = { limit: 100 };
      if (currentTab === 'overdue') params.overdue = true;
      else if (currentTab === 'archive') params.archived = true;
      else if (currentTab !== 'all') params.status = currentTab;
      
      if (currentSearch.trim()) params.q = currentSearch.trim();

      const { data } = await api.get('/tickets', { 
        params,
        signal: controller.signal
      });

      setTickets(data.filter((t: TicketResponse) => currentTab !== 'all' || !t.is_archived));
    } catch (err: any) {
      if (err.name !== 'CanceledError' && err.message !== 'canceled') {
        console.error(err);
      }
    } finally {
      if (abortControllerRef.current === controller) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!search) {
      fetchTickets(tab, search);
      return;
    }

    const delayDebounce = setTimeout(() => {
      fetchTickets(tab, search);
    }, 400);

    return () => clearTimeout(delayDebounce);
  }, [tab, search, fetchTickets]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchTickets(tab, search, true);
    setRefreshing(false);
  };

  const renderTicket = ({ item }: { item: TicketResponse }) => (
    <TouchableOpacity style={styles.card} onPress={() => onOpen(item)} activeOpacity={0.7}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardNumber}>#{item.number}</Text>
        {item.priority === 'critical' && <Text style={styles.badgeCrit}>CRIT</Text>}
        {item.priority === 'high' && <Text style={styles.badgeHigh}>HIGH</Text>}
      </View>
      <Text style={styles.cardSubject} numberOfLines={2}>{item.subject}</Text>
      <View style={styles.cardFooter}>
        <View style={[styles.statusDot, { backgroundColor: STATUS_COLORS[item.status] || '#5f6690' }]} />
        <Text style={styles.statusText}>{STATUS_LABELS[item.status] || item.status}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Заявки</Text>
      
      <View style={styles.tabsContainer}>
        <ScrollView 
          horizontal 
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabsContent}
        >
          {FILTER_TABS.map((item) => (
            <TouchableOpacity 
              key={item.key}
              style={[styles.tab, tab === item.key && styles.tabActive]} 
              onPress={() => setTab(item.key)}
            >
              <Text style={[styles.tabText, tab === item.key && styles.tabTextActive]}>
                {item.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <TextInput 
        style={styles.search} 
        placeholder="Поиск по теме..." 
        placeholderTextColor="#5f6690"
        value={search} 
        onChangeText={setSearch}
        autoCorrect={false}
      />

      {loading && !refreshing ? (
        <ActivityIndicator color="#8b5cf6" size="large" style={{ marginTop: 40 }} />
      ) : (
        <FlatList 
          data={tickets} 
          keyExtractor={(t) => String(t.id)} 
          renderItem={renderTicket}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#8b5cf6" colors={['#8b5cf6']} />
          }
          contentContainerStyle={{ paddingBottom: 30 }}
          ListEmptyComponent={<Text style={styles.empty}>Нет заявок</Text>}
          removeClippedSubviews={true}
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080a12', paddingHorizontal: 14 },
  title: { fontSize: 26, fontWeight: '800', color: '#eaf0ff', marginTop: 10, marginBottom: 10 },
  tabsContainer: { height: 38, marginBottom: 12 },
  tabsContent: { gap: 6, paddingRight: 14 },
  tab: { paddingHorizontal: 14, justifyContent: 'center', borderRadius: 8, backgroundColor: '#0d1020', height: 36 },
  tabActive: { backgroundColor: '#8b5cf6' },
  tabText: { fontSize: 13, fontWeight: '600', color: '#9097b8' },
  tabTextActive: { color: '#fff' },
  search: { backgroundColor: '#0d1020', borderRadius: 10, padding: 12, fontSize: 14, color: '#eaf0ff', marginBottom: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,.07)' },
  card: { backgroundColor: '#111527', borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,.07)' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  cardNumber: { fontSize: 11, color: '#5f6690', fontWeight: '700' },
  badgeCrit: { fontSize: 9, fontWeight: '700', color: '#f87171', backgroundColor: 'rgba(248,113,113,.15)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  badgeHigh: { fontSize: 9, fontWeight: '700', color: '#fbbf24', backgroundColor: 'rgba(251,191,36,.15)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  cardSubject: { fontSize: 15, fontWeight: '600', color: '#eaf0ff', marginBottom: 8 },
  cardFooter: { flexDirection: 'row', alignItems: 'center' },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  statusText: { fontSize: 12, color: '#9097b8', fontWeight: '500' },
  empty: { color: '#5f6690', textAlign: 'center', marginTop: 40, fontSize: 14 },
});
