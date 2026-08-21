import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { api, getApiError } from '../api/client';
import { STATUS_LABELS, TicketResponse } from '../api/types';
import { ThemeColors, useAppTheme } from '../theme/ThemeContext';

interface LocationRow {
  id: number;
  name: string;
  address: string;
  customer_name: string;
  contact_name: string | null;
  contact_phone: string | null;
  assigned_engineer_name: string | null;
  contract_number: string | null;
}

export const LocationsScreen: React.FC<{ onBack: () => void; onOpenTicket: (ticket: TicketResponse) => void }> = ({ onBack, onOpenTicket }) => {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [selected, setSelected] = useState<LocationRow | null>(null);
  const [tickets, setTickets] = useState<TicketResponse[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [worksLoading, setWorksLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const { data } = await api.get<LocationRow[]>('/locations');
      setLocations(data);
    } catch (e) {
      setError(getApiError(e, 'Не удалось загрузить объекты'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openLocation = async (location: LocationRow) => {
    setSelected(location);
    setTickets([]);
    setWorksLoading(true);
    setError('');
    try {
      const all: TicketResponse[] = [];
      const limit = 200;
      for (let offset = 0; ; offset += limit) {
        const { data } = await api.get<TicketResponse[]>('/tickets', { params: { location_id: location.id, limit, offset, sort_by: 'created_at', sort_dir: 'desc' } });
        all.push(...data);
        if (data.length < limit) break;
      }
      setTickets(all);
    } catch (e) {
      setError(getApiError(e, 'Не удалось загрузить работы по объекту'));
    } finally {
      setWorksLoading(false);
    }
  };

  const query = search.trim().toLowerCase();
  const filtered = query ? locations.filter((location) => [location.name, location.address, location.customer_name].some((value) => value?.toLowerCase().includes(query))) : locations;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}><TouchableOpacity onPress={onBack}><Text style={styles.back}>Назад</Text></TouchableOpacity><Text style={styles.headerTitle}>Объекты</Text><View style={styles.spacer} /></View>
      <TextInput style={styles.search} placeholder="Название, адрес или клиент" placeholderTextColor={colors.subtle} value={search} onChangeText={setSearch} />
      {error && !selected ? <Text style={styles.error}>{error}</Text> : null}
      {loading ? <ActivityIndicator color={colors.primary} size="large" style={styles.loader} /> : (
        <FlatList data={filtered} keyExtractor={(item) => String(item.id)} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} colors={[colors.primary]} tintColor={colors.primary} />} contentContainerStyle={styles.list} ListEmptyComponent={<Text style={styles.empty}>Объекты не найдены</Text>} renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} onPress={() => openLocation(item)} activeOpacity={0.75}>
            <Text style={styles.cardTitle}>{item.name}</Text>
            <Text style={styles.cardMeta}>{item.customer_name}</Text>
            <Text style={styles.cardMeta}>{item.address}</Text>
            {item.assigned_engineer_name ? <Text style={styles.cardFoot}>Инженер: {item.assigned_engineer_name}</Text> : null}
          </TouchableOpacity>
        )} />
      )}
      <Modal visible={Boolean(selected)} animationType="slide" onRequestClose={() => setSelected(null)}>
        <SafeAreaView style={styles.container}>
          <View style={styles.header}><TouchableOpacity onPress={() => setSelected(null)}><Text style={styles.back}>Назад</Text></TouchableOpacity><Text style={styles.headerTitle} numberOfLines={1}>{selected?.name}</Text><View style={styles.spacer} /></View>
          <ScrollView contentContainerStyle={styles.modalContent}>
            {selected && <View style={styles.locationInfo}><Text style={styles.cardTitle}>{selected.name}</Text><Text style={styles.cardMeta}>{selected.customer_name}</Text><Text style={styles.cardMeta}>{selected.address}</Text>{selected.contact_name ? <Text style={styles.cardFoot}>{selected.contact_name}{selected.contact_phone ? ` · ${selected.contact_phone}` : ''}</Text> : null}</View>}
            <Text style={styles.sectionTitle}>Работы ({tickets.length})</Text>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            {worksLoading ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : tickets.map((ticket) => (
              <TouchableOpacity key={ticket.id} style={styles.ticket} onPress={() => { setSelected(null); onOpenTicket(ticket); }}>
                <Text style={styles.ticketNumber}>#{ticket.number} · {STATUS_LABELS[ticket.status]}</Text>
                <Text style={styles.ticketTitle}>{ticket.subject}</Text>
                <Text style={styles.cardMeta}>{ticket.assignee_name || 'Исполнитель не назначен'} · {new Date(ticket.created_at).toLocaleDateString('ru-RU')}</Text>
              </TouchableOpacity>
            ))}
            {!worksLoading && !tickets.length && !error ? <Text style={styles.empty}>По объекту нет заявок</Text> : null}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
};

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { height: 52, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.border },
  back: { color: colors.primary, width: 70, fontWeight: '700' }, headerTitle: { flex: 1, color: colors.text, fontSize: 17, fontWeight: '800', textAlign: 'center' }, spacer: { width: 70 },
  search: { height: 44, margin: 14, marginBottom: 8, backgroundColor: colors.input, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12, color: colors.text },
  list: { padding: 14, paddingTop: 6, paddingBottom: 28, flexGrow: 1 }, loader: { marginTop: 36 }, error: { color: colors.danger, textAlign: 'center', margin: 14 }, empty: { color: colors.subtle, textAlign: 'center', marginTop: 32 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 13, marginBottom: 8 },
  cardTitle: { color: colors.text, fontSize: 15, fontWeight: '800' }, cardMeta: { color: colors.muted, fontSize: 12, marginTop: 4 }, cardFoot: { color: colors.secondary, fontSize: 12, marginTop: 8 },
  modalContent: { padding: 14, paddingBottom: 32 }, locationInfo: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 13 },
  sectionTitle: { color: colors.subtle, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', marginTop: 20, marginBottom: 8 },
  ticket: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 12, marginBottom: 7 }, ticketNumber: { color: colors.muted, fontSize: 11, fontWeight: '700' }, ticketTitle: { color: colors.text, fontSize: 14, fontWeight: '700', marginTop: 4 },
});
