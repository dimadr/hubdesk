import React, { useEffect, useState, useRef, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../api/client';

export const WarehouseScreen: React.FC = () => {
  const [tab, setTab] = useState<'devices' | 'inserts'>('devices');
  const [devices, setDevices] = useState<any[]>([]);
  const [inserts, setInserts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;

    setLoading(true);
    Promise.all([
      api.get('/replacement-devices').catch(() => ({ data: [] })),
      api.get('/insert/products').catch(() => ({ data: [] })),
    ]).then(([d, i]) => {
      if (isMountedRef.current) {
        setDevices(d.data || []);
        setInserts(i.data || []);
        setLoading(false);
      }
    });

    return () => { isMountedRef.current = false; };
  }, []);

  const parseAndFormatDate = (dateStr: string | null) => {
    if (!dateStr) return { formatted: '—', isOverdue: false };
    const normalizedStr = dateStr.includes(' ') && !dateStr.includes('T')
      ? dateStr.replace(' ', 'T')
      : dateStr;
    const date = new Date(normalizedStr);
    if (isNaN(date.getTime())) {
      return { formatted: dateStr.substring(0, 10), isOverdue: false };
    }
    const isOverdue = date < new Date();
    const formatted = date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
    return { formatted, isOverdue };
  };

  const renderDevice = useCallback(({ item }: { item: any }) => {
    const expiry = parseAndFormatDate(item.verification_expiry);
    const returnDate = parseAndFormatDate(item.return_date);
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{item.name}</Text>
        {item.verification_expiry && (
          <Text style={styles.cardRow}>
            Поверка до: <Text style={{ color: expiry.isOverdue ? '#f87171' : '#eaf0ff' }}>{expiry.formatted}</Text>
          </Text>
        )}
        {item.taken_by_name && <Text style={styles.cardRow}>У кого: {item.taken_by_name}</Text>}
        {item.location_name && <Text style={styles.cardRow}>Объект: {item.location_name}</Text>}
        {item.return_date && <Text style={styles.cardRow}>Возврат: {returnDate.formatted}</Text>}
      </View>
    );
  }, []);

  const renderInsert = useCallback(({ item }: { item: any }) => (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{item.name}</Text>
      {item.diameter && <Text style={styles.cardRow}>Диаметр: {item.diameter}</Text>}
      {item.length && <Text style={styles.cardRow}>Длина: {item.length}</Text>}
      {item.flange_type && <Text style={styles.cardRow}>Тип: {item.flange_type}</Text>}
      <Text style={styles.cardRow}>
        Остаток: <Text style={{ color: item.balance > 0 ? '#34d399' : '#5f6690', fontWeight: '700' }}>{item.balance} шт</Text>
      </Text>
    </View>
  ), []);

  if (loading) {
    return <SafeAreaView style={styles.container}><ActivityIndicator color="#8b5cf6" size="large" style={{ marginTop: 40 }} /></SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Склад</Text>
      <View style={styles.tabs}>
        <TouchableOpacity style={[styles.tab, tab === 'devices' && styles.tabActive]} onPress={() => setTab('devices')} activeOpacity={0.8}>
          <Text style={[styles.tabText, tab === 'devices' && styles.tabTextActive]}>Подменный фонд</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, tab === 'inserts' && styles.tabActive]} onPress={() => setTab('inserts')} activeOpacity={0.8}>
          <Text style={[styles.tabText, tab === 'inserts' && styles.tabTextActive]}>Склад вставок</Text>
        </TouchableOpacity>
      </View>
      {tab === 'devices' ? (
        <FlatList data={devices} keyExtractor={(item) => `device-${item.id}`} renderItem={renderDevice}
          contentContainerStyle={styles.listContent} ListEmptyComponent={<Text style={styles.empty}>Нет приборов</Text>} removeClippedSubviews={true} />
      ) : (
        <FlatList data={inserts} keyExtractor={(item) => `insert-${item.id}`} renderItem={renderInsert}
          contentContainerStyle={styles.listContent} ListEmptyComponent={<Text style={styles.empty}>Нет вставок</Text>} removeClippedSubviews={true} />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080a12', paddingHorizontal: 14 },
  title: { fontSize: 22, fontWeight: '800', color: '#eaf0ff', marginTop: 10, marginBottom: 10 },
  tabs: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 8, backgroundColor: '#0d1020', alignItems: 'center' },
  tabActive: { backgroundColor: '#8b5cf6' },
  tabText: { fontSize: 13, fontWeight: '600', color: '#9097b8' },
  tabTextActive: { color: '#fff' },
  listContent: { paddingBottom: 20 },
  card: { backgroundColor: '#111527', borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,.07)' },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#eaf0ff', marginBottom: 6 },
  cardRow: { fontSize: 12, color: '#9097b8', marginBottom: 2 },
  empty: { color: '#5f6690', textAlign: 'center', marginTop: 40, fontSize: 14 },
});
