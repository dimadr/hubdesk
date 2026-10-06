import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { api, getApiError } from '../api/client';
import {
  PRIORITY_LABELS,
  ReportEngineerRow,
  ReportObjectRow,
  ReportTicketStats,
  STATUS_LABELS,
  TYPE_LABELS,
  TicketResponse,
} from '../api/types';
import { ThemeColors, useAppTheme } from '../theme/ThemeContext';

type ReportTab = 'tickets' | 'objects' | 'engineers';

interface Props {
  onBack: () => void;
  onOpenTicket: (ticket: TicketResponse) => void;
}

interface DetailTarget {
  title: string;
  params: Record<string, string | number>;
}

const PAGE_SIZE = 50;
const EMPTY_LOADED: Record<ReportTab, boolean> = { tickets: false, objects: false, engineers: false };
const ENGINEER_STATUSES = ['', 'ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED'] as const;

const statusLabel = (value: string) => STATUS_LABELS[value as keyof typeof STATUS_LABELS] || value;
const priorityLabel = (value: string) => PRIORITY_LABELS[value as keyof typeof PRIORITY_LABELS] || value;
const typeLabel = (value: string) => TYPE_LABELS[value] || value;
const formatDate = (value: string | null) => value ? new Date(value).toLocaleDateString('ru-RU') : '—';

const dateBoundaryIso = (value: string, endOfDay: boolean): string | null | undefined => {
  if (!value.trim()) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return undefined;
  return date.toISOString();
};

export const ReportsScreen: React.FC<Props> = ({ onBack, onOpenTicket }) => {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [tab, setTab] = useState<ReportTab>('tickets');
  const [tickets, setTickets] = useState<ReportTicketStats | null>(null);
  const [objects, setObjects] = useState<ReportObjectRow[]>([]);
  const [engineers, setEngineers] = useState<ReportEngineerRow[]>([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [dateParams, setDateParams] = useState<Record<string, string>>({});
  const [engineerStatus, setEngineerStatus] = useState('');
  const [loaded, setLoaded] = useState<Record<ReportTab, boolean>>(EMPTY_LOADED);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<DetailTarget | null>(null);
  const [detailTickets, setDetailTickets] = useState<TicketResponse[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailLoadingMore, setDetailLoadingMore] = useState(false);
  const [detailHasMore, setDetailHasMore] = useState(false);
  const summaryRequestRef = useRef(0);
  const detailRequestRef = useRef(0);

  const loadSummary = useCallback(async (refresh = false) => {
    const requestId = ++summaryRequestRef.current;
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      if (tab === 'tickets') {
        const response = await api.get<ReportTicketStats>('/reports/tickets', { params: dateParams });
        if (requestId === summaryRequestRef.current) setTickets(response.data);
      } else if (tab === 'objects') {
        const response = await api.get<ReportObjectRow[]>('/reports/objects', { params: dateParams });
        if (requestId === summaryRequestRef.current) setObjects(response.data);
      } else {
        const response = await api.get<ReportEngineerRow[]>('/reports/engineers', {
          params: { ...dateParams, ...(engineerStatus ? { status: engineerStatus } : {}) },
        });
        if (requestId === summaryRequestRef.current) setEngineers(response.data);
      }
      if (requestId === summaryRequestRef.current) setLoaded((current) => ({ ...current, [tab]: true }));
    } catch (e) {
      if (requestId === summaryRequestRef.current) setError(getApiError(e, 'Не удалось загрузить отчёт'));
    } finally {
      if (requestId === summaryRequestRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [dateParams, engineerStatus, tab]);

  useFocusEffect(useCallback(() => {
    if (!detail && !loaded[tab]) void loadSummary();
  }, [detail, loadSummary, loaded, tab]));

  const applyDates = () => {
    const fromIso = dateBoundaryIso(dateFrom, false);
    const toIso = dateBoundaryIso(dateTo, true);
    if (fromIso === undefined || toIso === undefined) {
      setError('Введите дату в формате ГГГГ-ММ-ДД');
      return;
    }
    if (fromIso && toIso && fromIso > toIso) {
      setError('Начальная дата не может быть позже конечной');
      return;
    }
    setError('');
    setDetail(null);
    setDateParams({ ...(fromIso ? { date_from: fromIso } : {}), ...(toIso ? { date_to: toIso } : {}) });
    setLoaded({ ...EMPTY_LOADED });
  };

  const selectTab = (nextTab: ReportTab) => {
    detailRequestRef.current += 1;
    setDetail(null);
    setDetailTickets([]);
    setError('');
    setTab(nextTab);
  };

  const selectEngineerStatus = (status: string) => {
    setEngineerStatus(status);
    setError('');
    setLoaded((current) => ({ ...current, engineers: false }));
  };

  const loadDetails = async (target: DetailTarget, reset: boolean) => {
    if (!reset && (detailLoading || detailLoadingMore || !detailHasMore)) return;
    const requestId = ++detailRequestRef.current;
    if (reset) setDetailLoading(true);
    else setDetailLoadingMore(true);
    setError('');
    try {
      const offset = reset ? 0 : detailTickets.length;
      const response = await api.get<TicketResponse[]>('/reports/details', {
        params: { ...dateParams, ...target.params, limit: PAGE_SIZE, offset },
      });
      if (requestId !== detailRequestRef.current) return;
      setDetailTickets((current) => reset ? response.data : [...current, ...response.data]);
      setDetailHasMore(response.data.length === PAGE_SIZE);
    } catch (e) {
      if (requestId === detailRequestRef.current) setError(getApiError(e, 'Не удалось загрузить заявки'));
    } finally {
      if (requestId === detailRequestRef.current) {
        setDetailLoading(false);
        setDetailLoadingMore(false);
      }
    }
  };

  const openDetails = (target: DetailTarget) => {
    setDetail(target);
    setDetailTickets([]);
    setDetailHasMore(true);
    void loadDetails(target, true);
  };

  const closeDetails = () => {
    detailRequestRef.current += 1;
    setDetail(null);
    setDetailTickets([]);
    setDetailHasMore(false);
    setError('');
  };

  if (detail) {
    return (
      <SafeAreaView style={styles.container}>
        <Header title={detail.title} onBack={closeDetails} styles={styles} />
        {detailLoading ? <ActivityIndicator color={colors.primary} size="large" style={styles.loader} /> : (
          <ScrollView contentContainerStyle={styles.content}>
            {error ? <ErrorBlock message={error} onRetry={() => loadDetails(detail, true)} styles={styles} /> : null}
            <Text style={styles.resultCount}>Заявок: {detailTickets.length}</Text>
            {detailTickets.map((ticket) => (
              <TicketRow key={ticket.id} ticket={ticket} onPress={() => onOpenTicket(ticket)} styles={styles} />
            ))}
            {!detailTickets.length && !error ? <Text style={styles.empty}>Нет заявок</Text> : null}
            {detailHasMore ? (
              <TouchableOpacity style={styles.loadMore} onPress={() => loadDetails(detail, false)} disabled={detailLoadingMore}>
                {detailLoadingMore ? <ActivityIndicator color={colors.primary} /> : <Text style={styles.loadMoreText}>Загрузить ещё</Text>}
              </TouchableOpacity>
            ) : null}
          </ScrollView>
        )}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Отчёты" onBack={onBack} styles={styles} />
      <View style={styles.filters}>
        <View style={styles.dateField}>
          <Text style={styles.dateLabel}>С</Text>
          <TextInput style={styles.dateInput} value={dateFrom} onChangeText={setDateFrom} placeholder="ГГГГ-ММ-ДД" placeholderTextColor={colors.subtle} autoCapitalize="none" maxLength={10} />
        </View>
        <View style={styles.dateField}>
          <Text style={styles.dateLabel}>По</Text>
          <TextInput style={styles.dateInput} value={dateTo} onChangeText={setDateTo} placeholder="ГГГГ-ММ-ДД" placeholderTextColor={colors.subtle} autoCapitalize="none" maxLength={10} />
        </View>
        <TouchableOpacity style={styles.applyButton} onPress={applyDates}><Text style={styles.applyText}>Применить</Text></TouchableOpacity>
      </View>
      <View style={styles.tabs}>
        {([['tickets', 'Заявки'], ['objects', 'Объекты'], ['engineers', 'Инженеры']] as const).map(([key, label]) => (
          <TouchableOpacity key={key} style={[styles.tab, tab === key && styles.tabActive]} onPress={() => selectTab(key)}><Text style={[styles.tabText, tab === key && styles.tabTextActive]}>{label}</Text></TouchableOpacity>
        ))}
      </View>
      {loading && !loaded[tab] ? <ActivityIndicator color={colors.primary} size="large" style={styles.loader} /> : (
        <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadSummary(true)} colors={[colors.primary]} tintColor={colors.primary} />}>
          {error ? <ErrorBlock message={error} onRetry={() => loadSummary()} styles={styles} /> : null}
          {tab === 'tickets' && tickets ? (
            <TicketSummary data={tickets} onStatus={(status) => openDetails({ title: statusLabel(status), params: { status } })} styles={styles} />
          ) : null}
          {tab === 'objects' ? objects.map((item) => (
            <TouchableOpacity key={item.location_id} style={styles.card} onPress={() => openDetails({ title: item.location_name || item.customer_name, params: { location_id: item.location_id } })} activeOpacity={0.75}>
              <View style={styles.cardHeading}><Text style={styles.cardTitle}>{item.location_name || item.customer_name}</Text><Text style={styles.chevron}>›</Text></View>
              {item.customer_name ? <Text style={styles.cardMeta}>{item.customer_name}</Text> : null}
              {item.location_address ? <Text style={styles.cardMeta}>{item.location_address}</Text> : null}
              <Text style={styles.cardMeta}>Всего: {item.total} · Открыто: {item.open} · Закрыто: {item.closed}</Text>
              <Text style={[styles.cardMeta, item.overdue > 0 && styles.danger]}>Просрочено: {item.overdue} · Среднее: {item.avg_resolution_hours} ч</Text>
              {Object.keys(item.types || {}).length ? <Text style={styles.cardTypes}>Работы: {Object.entries(item.types).map(([type, count]) => `${typeLabel(type)} × ${count}`).join(' · ')}</Text> : null}
            </TouchableOpacity>
          )) : null}
          {tab === 'engineers' ? (
            <>
              <Text style={styles.sectionTitle}>Статус заявок</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.statusFilters}>
                {ENGINEER_STATUSES.map((status) => (
                  <TouchableOpacity key={status || 'all'} style={[styles.statusFilter, engineerStatus === status && styles.statusFilterActive]} onPress={() => selectEngineerStatus(status)}>
                    <Text style={[styles.statusFilterText, engineerStatus === status && styles.statusFilterTextActive]}>{status ? statusLabel(status) : 'Все'}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              {engineers.map((item) => (
                <TouchableOpacity key={item.engineer_id} style={styles.card} onPress={() => openDetails({ title: item.engineer_name, params: { assignee_id: item.engineer_id, ...(engineerStatus ? { status: engineerStatus } : {}) } })} activeOpacity={0.75}>
                  <View style={styles.cardHeading}><Text style={styles.cardTitle}>{item.engineer_name}</Text><Text style={styles.chevron}>›</Text></View>
                  <Text style={styles.cardMeta}>Всего: {item.total} · В работе: {item.in_progress} · Завершено: {item.completed}</Text>
                  <Text style={[styles.cardMeta, item.overdue > 0 && styles.danger]}>Просрочено: {item.overdue} · Среднее: {item.avg_resolution_hours} ч</Text>
                </TouchableOpacity>
              ))}
            </>
          ) : null}
          {loaded[tab] && ((tab === 'objects' && !objects.length) || (tab === 'engineers' && !engineers.length) || (tab === 'tickets' && !tickets)) ? <Text style={styles.empty}>Нет данных</Text> : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
};

const Header = ({ title, onBack, styles }: { title: string; onBack: () => void; styles: ReturnType<typeof createStyles> }) => (
  <View style={styles.header}>
    <TouchableOpacity onPress={onBack}><Text style={styles.back}>Назад</Text></TouchableOpacity>
    <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
    <View style={styles.spacer} />
  </View>
);

const TicketSummary = ({ data, onStatus, styles }: { data: ReportTicketStats; onStatus: (status: string) => void; styles: ReturnType<typeof createStyles> }) => (
  <>
    <View style={styles.kpiGrid}>
      <Kpi label="Всего" value={data.total} styles={styles} />
      <Kpi label="SLA" value={`${data.sla_percent}%`} styles={styles} />
      <Kpi label="Среднее время" value={`${data.avg_resolution_hours} ч`} styles={styles} />
    </View>
    <Text style={styles.sectionTitle}>По статусам</Text>
    {data.by_status.map((row) => <SummaryRow key={row.label} label={statusLabel(row.label)} value={row.count} onPress={() => onStatus(row.label)} styles={styles} />)}
    <Text style={styles.sectionTitle}>По приоритетам</Text>
    {data.by_priority.map((row) => <SummaryRow key={row.label} label={priorityLabel(row.label)} value={row.count} styles={styles} />)}
    <Text style={styles.sectionTitle}>По типам</Text>
    {data.by_type.map((row) => <SummaryRow key={row.label} label={typeLabel(row.label)} value={row.count} styles={styles} />)}
  </>
);

const TicketRow = ({ ticket, onPress, styles }: { ticket: TicketResponse; onPress: () => void; styles: ReturnType<typeof createStyles> }) => (
  <TouchableOpacity style={styles.ticketCard} onPress={onPress} activeOpacity={0.75}>
    <View style={styles.ticketTop}>
      <Text style={styles.ticketNumber}>#{ticket.number}</Text>
      <Text style={styles.ticketStatus}>{statusLabel(ticket.status)}</Text>
    </View>
    <Text style={styles.ticketSubject}>{ticket.subject}</Text>
    {ticket.location_name ? <Text style={styles.ticketLocation}>{ticket.location_name}{ticket.location_address ? ` · ${ticket.location_address}` : ''}</Text> : null}
    <Text style={styles.ticketMeta}>{ticket.assignee_name || 'Исполнитель не назначен'} · {priorityLabel(ticket.priority)}</Text>
    <Text style={styles.ticketMeta}>Создана: {formatDate(ticket.created_at)} · Завершена: {formatDate(ticket.completed_at)}</Text>
  </TouchableOpacity>
);

const Kpi = ({ label, value, styles }: { label: string; value: number | string; styles: ReturnType<typeof createStyles> }) => <View style={styles.kpi}><Text style={styles.kpiLabel}>{label}</Text><Text style={styles.kpiValue}>{value}</Text></View>;

const SummaryRow = ({ label, value, onPress, styles }: { label: string; value: number; onPress?: () => void; styles: ReturnType<typeof createStyles> }) => {
  const content = <><Text style={styles.summaryLabel}>{label}</Text><Text style={styles.summaryValue}>{value}</Text>{onPress ? <Text style={styles.summaryChevron}>›</Text> : null}</>;
  return onPress ? <TouchableOpacity style={styles.summaryRow} onPress={onPress}>{content}</TouchableOpacity> : <View style={styles.summaryRow}>{content}</View>;
};

const ErrorBlock = ({ message, onRetry, styles }: { message: string; onRetry: () => void; styles: ReturnType<typeof createStyles> }) => (
  <View style={styles.errorBlock}><Text style={styles.error}>{message}</Text><TouchableOpacity onPress={onRetry}><Text style={styles.retry}>Повторить</Text></TouchableOpacity></View>
);

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { height: 52, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.border },
  back: { color: colors.primary, width: 70, fontWeight: '700' },
  headerTitle: { flex: 1, color: colors.text, fontSize: 17, fontWeight: '800', textAlign: 'center' },
  spacer: { width: 70 },
  filters: { flexDirection: 'row', alignItems: 'flex-end', gap: 7, paddingHorizontal: 14, paddingTop: 10 },
  dateField: { flex: 1 },
  dateLabel: { color: colors.muted, fontSize: 11, fontWeight: '700', marginBottom: 4 },
  dateInput: { height: 40, color: colors.text, backgroundColor: colors.input, borderRadius: 7, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 9, fontSize: 12 },
  applyButton: { height: 40, minWidth: 82, alignItems: 'center', justifyContent: 'center', borderRadius: 7, backgroundColor: colors.primary, paddingHorizontal: 10 },
  applyText: { color: colors.onPrimary, fontSize: 11, fontWeight: '800' },
  tabs: { flexDirection: 'row', gap: 6, padding: 10, paddingHorizontal: 14 },
  tab: { flex: 1, height: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.input, borderRadius: 7 },
  tabActive: { backgroundColor: colors.primary },
  tabText: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  tabTextActive: { color: colors.onPrimary },
  content: { padding: 14, paddingTop: 4, paddingBottom: 30 },
  loader: { marginTop: 44 },
  errorBlock: { alignItems: 'center', marginBottom: 12 },
  error: { color: colors.danger, textAlign: 'center' },
  retry: { color: colors.primary, fontWeight: '800', marginTop: 7 },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  kpi: { minWidth: '47%', flexGrow: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 12 },
  kpiLabel: { color: colors.muted, fontSize: 11 },
  kpiValue: { color: colors.text, fontSize: 22, fontWeight: '800', marginTop: 6 },
  sectionTitle: { color: colors.subtle, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', marginTop: 20, marginBottom: 8 },
  summaryRow: { minHeight: 42, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.border },
  summaryLabel: { flex: 1, color: colors.secondary, fontSize: 13 },
  summaryValue: { color: colors.text, fontWeight: '800' },
  summaryChevron: { color: colors.subtle, fontSize: 24, width: 22, textAlign: 'right' },
  statusFilters: { gap: 6, paddingBottom: 10 },
  statusFilter: { height: 34, paddingHorizontal: 11, alignItems: 'center', justifyContent: 'center', borderRadius: 7, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.input },
  statusFilterActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  statusFilterText: { color: colors.muted, fontSize: 11, fontWeight: '700' },
  statusFilterTextActive: { color: colors.onPrimary },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 13, marginBottom: 8 },
  cardHeading: { minHeight: 24, flexDirection: 'row', alignItems: 'center' },
  cardTitle: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '800' },
  chevron: { color: colors.subtle, fontSize: 26, marginLeft: 8 },
  cardMeta: { color: colors.muted, fontSize: 12, marginTop: 5 },
  cardTypes: { color: colors.secondary, fontSize: 11, marginTop: 7 },
  danger: { color: colors.danger },
  resultCount: { color: colors.muted, fontSize: 12, fontWeight: '700', marginBottom: 9 },
  ticketCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 12, marginBottom: 8 },
  ticketTop: { flexDirection: 'row', alignItems: 'center' },
  ticketNumber: { flex: 1, color: colors.subtle, fontSize: 11, fontWeight: '800' },
  ticketStatus: { color: colors.primarySoft, fontSize: 11, fontWeight: '800' },
  ticketSubject: { color: colors.text, fontSize: 14, fontWeight: '800', marginTop: 6 },
  ticketLocation: { color: colors.secondary, fontSize: 12, marginTop: 5 },
  ticketMeta: { color: colors.muted, fontSize: 11, marginTop: 5 },
  loadMore: { height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 7, borderWidth: 1, borderColor: colors.primary, marginTop: 8 },
  loadMoreText: { color: colors.primary, fontSize: 12, fontWeight: '800' },
  empty: { color: colors.subtle, textAlign: 'center', marginTop: 36 },
});
