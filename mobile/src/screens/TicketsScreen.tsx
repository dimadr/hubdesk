import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, FlatList, RefreshControl, ScrollView, StyleSheet, Text,
  TextInput, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { api, getApiError } from '../api/client';
import { FILTER_TABS, STATUS_LABELS, TicketResponse, UserInfo } from '../api/types';
import { ThemeColors, useAppTheme } from '../theme/ThemeContext';

const LIMIT = 50;
const STATUS_COLORS: Record<string, string> = {
  ASSIGNED: '#60a5fa', ACCEPTED: '#a78bfa', IN_PROGRESS: '#fbbf24', COMPLETED: '#34d399',
};

interface Props {
  user: UserInfo;
  onOpen: (ticket: TicketResponse) => void;
  onCreate: () => void;
  onSettings: () => void;
}

export const TicketsScreen: React.FC<Props> = ({ user, onOpen, onCreate, onSettings }) => {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [tickets, setTickets] = useState<TicketResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const ticketsRef = useRef<TicketResponse[]>([]);
  const requestRef = useRef<AbortController | null>(null);
  const loadingMoreRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => () => {
    mountedRef.current = false;
    requestRef.current?.abort();
  }, []);

  const load = useCallback(async (reset: boolean, refresh = false) => {
    if (!reset && loadingMoreRef.current) return;
    if (reset) {
      requestRef.current?.abort();
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
    const controller = new AbortController();
    requestRef.current = controller;
    if (reset && !refresh) setLoading(true);
    if (!reset) {
      loadingMoreRef.current = true;
      setLoadingMore(true);
    }
    setError('');
    try {
      const params: Record<string, unknown> = { limit: LIMIT, offset: reset ? 0 : ticketsRef.current.length };
      if (tab === 'overdue') params.overdue = true;
      else if (tab === 'archive') params.archived = true;
      else if (tab !== 'all') params.status = tab;
      else params.archived = false;
      if (search.trim()) params.q = search.trim();
      const { data } = await api.get<TicketResponse[]>('/tickets', { params, signal: controller.signal });
      if (!mountedRef.current || requestRef.current !== controller) return;
      const next = reset
        ? data
        : [...ticketsRef.current, ...data.filter((item) => !ticketsRef.current.some((current) => current.id === item.id))];
      ticketsRef.current = next;
      setTickets(next);
      setHasMore(data.length === LIMIT);
    } catch (e: any) {
      if (e?.code !== 'ERR_CANCELED' && e?.name !== 'CanceledError') setError(getApiError(e, 'Не удалось загрузить заявки'));
    } finally {
      if (mountedRef.current && requestRef.current === controller) {
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
        loadingMoreRef.current = false;
      }
    }
  }, [search, tab]);

  useFocusEffect(useCallback(() => {
    const timer = setTimeout(() => load(true), search.trim() ? 350 : 0);
    return () => clearTimeout(timer);
  }, [load, search]));

  const refresh = () => {
    setRefreshing(true);
    load(true, true);
  };

  const renderTicket = ({ item }: { item: TicketResponse }) => (
    <TouchableOpacity style={styles.card} onPress={() => onOpen(item)} activeOpacity={0.75}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardNumber}>#{item.number}</Text>
        {item.priority === 'critical' && <Text style={styles.critical}>КРИТИЧЕСКАЯ</Text>}
        {item.priority === 'high' && <Text style={styles.high}>ВЫСОКАЯ</Text>}
      </View>
      <Text style={styles.cardSubject} numberOfLines={2}>{item.subject}</Text>
      {item.location_name && <Text style={styles.cardLocation} numberOfLines={1}>{item.location_name}</Text>}
      <View style={styles.cardFooter}>
        <View style={[styles.statusDot, { backgroundColor: STATUS_COLORS[item.status] || colors.subtle }]} />
        <Text style={styles.statusText}>{STATUS_LABELS[item.status]}</Text>
        {item.resolution_overdue && <Text style={styles.overdue}>Просрочена</Text>}
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Заявки</Text>
        <TouchableOpacity style={styles.iconButton} onPress={onSettings} accessibilityLabel="Настройки сервера"><Text style={styles.icon}>⚙</Text></TouchableOpacity>
        {user.role === 'engineer' && <TouchableOpacity style={styles.createButton} onPress={onCreate}><Text style={styles.createText}>＋</Text></TouchableOpacity>}
      </View>
      <View style={styles.tabsContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsContent}>
          {FILTER_TABS.map((item) => (
            <TouchableOpacity key={item.key} style={[styles.tab, tab === item.key && styles.tabActive]} onPress={() => setTab(item.key)}>
              <Text style={[styles.tabText, tab === item.key && styles.tabTextActive]}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
      <TextInput style={styles.search} placeholder="Номер или тема" placeholderTextColor={colors.subtle} value={search} onChangeText={setSearch} autoCorrect={false} />
      {error ? (
        <View style={styles.message}><Text style={styles.error}>{error}</Text><TouchableOpacity onPress={() => load(true)}><Text style={styles.retry}>Повторить</Text></TouchableOpacity></View>
      ) : loading ? (
        <ActivityIndicator color={colors.primary} size="large" style={styles.loader} />
      ) : (
        <FlatList
          data={tickets}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderTicket}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} colors={[colors.primary]} />}
          onEndReached={() => { if (hasMore && !loadingMoreRef.current) load(false); }}
          onEndReachedThreshold={0.4}
          ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.primary} style={styles.footerLoader} /> : null}
          ListEmptyComponent={<Text style={styles.empty}>Нет заявок</Text>}
          contentContainerStyle={styles.list}
        />
      )}
    </SafeAreaView>
  );
};

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, paddingHorizontal: 14 },
  header: { height: 52, flexDirection: 'row', alignItems: 'center', gap: 8 }, title: { flex: 1, fontSize: 25, fontWeight: '800', color: colors.text },
  iconButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' }, icon: { color: colors.muted, fontSize: 21 },
  createButton: { width: 38, height: 38, backgroundColor: colors.primary, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }, createText: { color: colors.onPrimary, fontSize: 25, lineHeight: 27 },
  tabsContainer: { height: 38, marginBottom: 11 }, tabsContent: { gap: 6, paddingRight: 18 }, tab: { height: 36, paddingHorizontal: 13, justifyContent: 'center', borderRadius: 7, backgroundColor: colors.input }, tabActive: { backgroundColor: colors.primary }, tabText: { fontSize: 12, fontWeight: '700', color: colors.muted }, tabTextActive: { color: colors.onPrimary },
  search: { height: 44, backgroundColor: colors.input, borderRadius: 8, paddingHorizontal: 12, fontSize: 14, color: colors.text, marginBottom: 11, borderWidth: 1, borderColor: colors.border },
  card: { backgroundColor: colors.surface, borderRadius: 8, padding: 13, marginBottom: 8, borderWidth: 1, borderColor: colors.border }, cardHeader: { height: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, cardNumber: { fontSize: 11, color: colors.subtle, fontWeight: '700' }, critical: { fontSize: 9, color: colors.danger, fontWeight: '800' }, high: { fontSize: 9, color: colors.warning, fontWeight: '800' },
  cardSubject: { color: colors.text, fontSize: 15, fontWeight: '700', lineHeight: 20, marginTop: 3 }, cardLocation: { color: colors.muted, fontSize: 12, marginTop: 5 }, cardFooter: { height: 22, flexDirection: 'row', alignItems: 'center', marginTop: 7 }, statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 }, statusText: { color: colors.muted, fontSize: 12 }, overdue: { color: colors.danger, fontSize: 11, fontWeight: '700', marginLeft: 'auto' },
  list: { paddingBottom: 28, flexGrow: 1 }, loader: { marginTop: 44 }, footerLoader: { marginVertical: 15 }, empty: { color: colors.subtle, textAlign: 'center', marginTop: 42 },
  message: { marginTop: 42, alignItems: 'center', gap: 12 }, error: { color: colors.danger, textAlign: 'center' }, retry: { color: colors.primary, fontWeight: '700' },
});
