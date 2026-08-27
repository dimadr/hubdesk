import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, Modal, RefreshControl, ScrollView, StyleSheet, Text,
  TextInput, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { api, getApiError } from '../api/client';
import {
  InsertProductResponse, NomenclatureResponse, ReplacementDeviceResponse, UserInfo,
  WarehouseBalanceResponse, WarehouseDocumentResponse, WarehouseResponse,
} from '../api/types';
import { ThemeColors, useAppTheme } from '../theme/ThemeContext';

type TabKey = 'documents' | 'balances' | 'warehouses' | 'nomenclature' | 'replacement' | 'inserts';
type CatalogForm = { kind: 'warehouse' | 'nomenclature'; id?: number; name: string; type: string; unit: string };
type FundKind = 'replacement' | 'insert';

const DOC_TYPES = { INFLOW: 'Приход', TRANSFER: 'Перемещение', WRITE_OFF: 'Списание' } as const;
const DOC_STATUSES = { DRAFT: 'Черновик', APPROVAL: 'Согласование', DELIVERY: 'Доставка', ACCOUNTED: 'Проведён' } as const;
const NEXT_ACTION = {
  DRAFT: { path: 'approve', label: 'На согласование' },
  APPROVAL: { path: 'deliver', label: 'В доставку' },
  DELIVERY: { path: 'account', label: 'Провести' },
} as const;

export const WarehouseScreen: React.FC<{ user: UserInfo; onBack: () => void }> = ({ user, onBack }) => {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const canWrite = ['admin', 'director', 'storekeeper'].includes(user.role);
  const canManageReplacement = ['admin', 'director', 'storekeeper'].includes(user.role);
  const canManageInsert = ['admin', 'director', 'storekeeper', 'metrologist'].includes(user.role);
  const canViewReplacement = canManageReplacement || user.role === 'engineer';
  const canViewInsert = canManageInsert || user.role === 'engineer';
  const tabs = useMemo<Array<{ key: TabKey; label: string }>>(() => [
    { key: 'documents', label: 'Документы' }, { key: 'balances', label: 'Остатки' },
    { key: 'warehouses', label: 'Склады' }, { key: 'nomenclature', label: 'Номенклатура' },
    ...(canViewReplacement ? [{ key: 'replacement' as TabKey, label: 'Подмена' }] : []),
    ...(canViewInsert ? [{ key: 'inserts' as TabKey, label: 'Вставки' }] : []),
  ], [canViewInsert, canViewReplacement]);
  const [tab, setTab] = useState<TabKey>('documents');
  const [warehouses, setWarehouses] = useState<WarehouseResponse[]>([]);
  const [nomenclature, setNomenclature] = useState<NomenclatureResponse[]>([]);
  const [documents, setDocuments] = useState<WarehouseDocumentResponse[]>([]);
  const [balances, setBalances] = useState<WarehouseBalanceResponse[]>([]);
  const [devices, setDevices] = useState<ReplacementDeviceResponse[]>([]);
  const [inserts, setInserts] = useState<InsertProductResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [catalogForm, setCatalogForm] = useState<CatalogForm | null>(null);
  const [docOpen, setDocOpen] = useState(false);
  const [docType, setDocType] = useState<keyof typeof DOC_TYPES>('INFLOW');
  const [sourceId, setSourceId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [lineItemId, setLineItemId] = useState('');
  const [lineQuantity, setLineQuantity] = useState('1');
  const [draftLines, setDraftLines] = useState<Array<{ nomenclature_id: number; quantity: number }>>([]);
  const [fundForm, setFundForm] = useState<{ kind: FundKind; itemId: number; itemName: string; type: 'incoming' | 'outgoing' | 'return'; quantity: string; comment: string } | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const requests: Promise<unknown>[] = [
        api.get<WarehouseResponse[]>('/warehouses'), api.get<NomenclatureResponse[]>('/nomenclature'),
        api.get<WarehouseDocumentResponse[]>('/warehouse-documents'), api.get<WarehouseBalanceResponse[]>('/balances'),
      ];
      if (canViewReplacement) requests.push(api.get<ReplacementDeviceResponse[]>('/replacement/devices'));
      if (canViewInsert) requests.push(api.get<InsertProductResponse[]>('/insert/products'));
      const results = await Promise.all(requests) as Array<{ data: unknown }>;
      setWarehouses(results[0].data as WarehouseResponse[]);
      setNomenclature(results[1].data as NomenclatureResponse[]);
      setDocuments(results[2].data as WarehouseDocumentResponse[]);
      setBalances(results[3].data as WarehouseBalanceResponse[]);
      let index = 4;
      if (canViewReplacement) setDevices(results[index++].data as ReplacementDeviceResponse[]);
      if (canViewInsert) setInserts(results[index].data as InsertProductResponse[]);
    } catch (e) {
      setError(getApiError(e, 'Не удалось загрузить склад'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [canViewInsert, canViewReplacement]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const warehouseName = (id: number | null) => id ? warehouses.find((item) => item.id === id)?.name || `Склад #${id}` : '—';
  const nomenclatureName = (id: number) => nomenclature.find((item) => item.id === id)?.name || `Позиция #${id}`;

  const saveCatalog = async () => {
    if (!catalogForm?.name.trim() || busy) return;
    setBusy(true);
    try {
      const base = catalogForm.kind === 'warehouse' ? '/warehouses' : '/nomenclature';
      const payload = catalogForm.kind === 'warehouse'
        ? { name: catalogForm.name.trim(), type: catalogForm.type }
        : { name: catalogForm.name.trim(), type: catalogForm.type, unit: catalogForm.unit.trim() || 'шт' };
      if (catalogForm.id) await api.patch(`${base}/${catalogForm.id}`, payload);
      else await api.post(base, payload);
      setCatalogForm(null);
      await load();
    } catch (e) {
      Alert.alert('Не сохранено', getApiError(e));
    } finally {
      setBusy(false);
    }
  };

  const addDraftLine = () => {
    const id = Number(lineItemId);
    const quantity = Number(lineQuantity.replace(',', '.'));
    if (!id || !Number.isFinite(quantity) || quantity <= 0) {
      Alert.alert('Проверьте строку', 'Выберите позицию и укажите количество больше нуля');
      return;
    }
    setDraftLines((current) => [...current, { nomenclature_id: id, quantity }]);
    setLineItemId('');
    setLineQuantity('1');
  };

  const createDocument = async () => {
    if (!draftLines.length || busy) return;
    if (docType !== 'INFLOW' && !sourceId) return Alert.alert('Не выбран склад', 'Укажите склад-источник');
    if (docType !== 'WRITE_OFF' && !targetId) return Alert.alert('Не выбран склад', 'Укажите склад-получатель');
    if (docType === 'TRANSFER' && sourceId === targetId) return Alert.alert('Проверьте склады', 'Источник и получатель должны отличаться');
    setBusy(true);
    try {
      await api.post('/warehouse-documents', {
        doc_type: docType,
        source_warehouse_id: docType === 'INFLOW' ? null : Number(sourceId),
        target_warehouse_id: docType === 'WRITE_OFF' ? null : Number(targetId),
        lines: draftLines,
      });
      setDocOpen(false);
      setDraftLines([]);
      setSourceId('');
      setTargetId('');
      await load();
    } catch (e) {
      Alert.alert('Документ не создан', getApiError(e));
    } finally {
      setBusy(false);
    }
  };

  const advanceDocument = async (document: WarehouseDocumentResponse) => {
    const action = NEXT_ACTION[document.status as keyof typeof NEXT_ACTION];
    if (!action || busy) return;
    Alert.alert(action.label, `Документ #${document.id}`, [
      { text: 'Отмена', style: 'cancel' },
      { text: action.label, onPress: async () => {
        setBusy(true);
        try {
          await api.patch(`/warehouse-documents/${document.id}/${action.path}`);
          await load();
        } catch (e) {
          Alert.alert('Статус не изменён', getApiError(e));
        } finally {
          setBusy(false);
        }
      } },
    ]);
  };

  const saveFundTransaction = async () => {
    if (!fundForm || busy) return;
    const quantity = Number(fundForm.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) return Alert.alert('Проверьте количество', 'Введите целое число больше нуля');
    setBusy(true);
    try {
      const isReplacement = fundForm.kind === 'replacement';
      await api.post(isReplacement ? '/replacement/transactions' : '/insert/transactions', {
        type: fundForm.type,
        [isReplacement ? 'device_id' : 'product_id']: fundForm.itemId,
        quantity,
        comment: fundForm.comment.trim() || null,
      });
      setFundForm(null);
      await load();
    } catch (e) {
      Alert.alert('Операция не выполнена', getApiError(e));
    } finally {
      setBusy(false);
    }
  };

  const renderDocuments = () => <>
    {canWrite && <ActionButton label="Создать документ" onPress={() => { setDocType('INFLOW'); setDraftLines([]); setDocOpen(true); }} styles={styles} />}
    {documents.map((document) => {
      const action = NEXT_ACTION[document.status as keyof typeof NEXT_ACTION];
      return <View key={document.id} style={styles.card}>
        <View style={styles.cardHeader}><Text style={styles.cardTitle}>#{document.id} · {DOC_TYPES[document.doc_type]}</Text><Text style={styles.badge}>{DOC_STATUSES[document.status]}</Text></View>
        <Text style={styles.rowText}>{warehouseName(document.source_warehouse_id)} → {warehouseName(document.target_warehouse_id)}</Text>
        {document.lines.map((line) => <Text key={line.id} style={styles.rowMeta}>{nomenclatureName(line.nomenclature_id)}: {line.quantity}</Text>)}
        {canWrite && action ? <TouchableOpacity style={styles.inlineAction} onPress={() => advanceDocument(document)} disabled={busy}><Text style={styles.inlineActionText}>{action.label}</Text></TouchableOpacity> : null}
      </View>;
    })}
    {!documents.length && <Empty text="Нет складских документов" styles={styles} />}
  </>;

  const renderBalances = () => <>{balances.map((balance) => <View key={`${balance.warehouse_id}-${balance.nomenclature_id}`} style={styles.card}><Text style={styles.cardTitle}>{nomenclatureName(balance.nomenclature_id)}</Text><Text style={styles.rowText}>{warehouseName(balance.warehouse_id)}</Text><Text style={styles.balance}>{balance.quantity} {nomenclature.find((item) => item.id === balance.nomenclature_id)?.unit || ''}</Text></View>)}{!balances.length && <Empty text="Нет остатков" styles={styles} />}</>;
  const renderWarehouses = () => <>{canWrite && <ActionButton label="Добавить склад" onPress={() => setCatalogForm({ kind: 'warehouse', name: '', type: 'physical', unit: '' })} styles={styles} />}{warehouses.map((item) => <TouchableOpacity key={item.id} style={styles.card} onPress={() => canWrite && setCatalogForm({ kind: 'warehouse', id: item.id, name: item.name, type: item.type, unit: '' })} disabled={!canWrite}><Text style={styles.cardTitle}>{item.name}</Text><Text style={styles.rowMeta}>{item.type === 'personal' ? 'Персональный' : 'Физический'}</Text></TouchableOpacity>)}{!warehouses.length && <Empty text="Нет доступных складов" styles={styles} />}</>;
  const renderNomenclature = () => <>{canWrite && <ActionButton label="Добавить позицию" onPress={() => setCatalogForm({ kind: 'nomenclature', name: '', type: 'material', unit: 'шт' })} styles={styles} />}{nomenclature.map((item) => <TouchableOpacity key={item.id} style={styles.card} onPress={() => canWrite && setCatalogForm({ kind: 'nomenclature', id: item.id, name: item.name, type: item.type, unit: item.unit })} disabled={!canWrite}><Text style={styles.cardTitle}>{item.name}</Text><Text style={styles.rowMeta}>{item.type} · {item.unit}</Text></TouchableOpacity>)}{!nomenclature.length && <Empty text="Нет номенклатуры" styles={styles} />}</>;
  const renderFund = (kind: FundKind) => {
    const data = kind === 'replacement' ? devices : inserts;
    const canManage = kind === 'replacement' ? canManageReplacement : canManageInsert;
    return <>{data.map((item) => <View key={item.id} style={styles.card}><Text style={styles.cardTitle}>{item.name}</Text>{kind === 'replacement' && 'serial_number' in item && item.serial_number ? <Text style={styles.rowMeta}>Серийный номер: {item.serial_number}</Text> : null}{kind === 'insert' && 'diameter_inner' in item ? <Text style={styles.rowMeta}>Диаметр: {item.diameter_inner || '—'} / {item.diameter_outer || '—'}{item.cell ? ` · ячейка ${item.cell}` : ''}</Text> : null}<Text style={styles.balance}>Остаток: {item.balance} шт</Text>{canManage && <TouchableOpacity style={styles.inlineAction} onPress={() => setFundForm({ kind, itemId: item.id, itemName: item.name, type: 'outgoing', quantity: '1', comment: '' })}><Text style={styles.inlineActionText}>Операция</Text></TouchableOpacity>}</View>)}{!data.length && <Empty text={kind === 'replacement' ? 'Нет приборов' : 'Нет вставок'} styles={styles} />}</>;
  };

  if (loading) return <SafeAreaView style={styles.container}><ActivityIndicator color={colors.primary} size="large" style={styles.loader} /></SafeAreaView>;
  return <SafeAreaView style={styles.container}>
    <View style={styles.header}><TouchableOpacity onPress={onBack}><Text style={styles.back}>Назад</Text></TouchableOpacity><Text style={styles.title}>Склад</Text><View style={styles.headerSpace} /></View>
    <ScrollView style={styles.tabsScroll} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>{tabs.map((item) => <TouchableOpacity key={item.key} style={[styles.tab, tab === item.key && styles.tabActive]} onPress={() => setTab(item.key)}><Text style={[styles.tabText, tab === item.key && styles.tabTextActive]}>{item.label}</Text></TouchableOpacity>)}</ScrollView>
    {error ? <Text style={styles.error}>{error}</Text> : null}
    <ScrollView style={styles.contentScroll} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} colors={[colors.primary]} />}>
      {tab === 'documents' && renderDocuments()}{tab === 'balances' && renderBalances()}{tab === 'warehouses' && renderWarehouses()}{tab === 'nomenclature' && renderNomenclature()}{tab === 'replacement' && renderFund('replacement')}{tab === 'inserts' && renderFund('insert')}
    </ScrollView>

    <Modal visible={Boolean(catalogForm)} transparent animationType="fade" onRequestClose={() => setCatalogForm(null)}>{catalogForm && <View style={styles.modalBackdrop}><View style={styles.modalCard}><Text style={styles.modalTitle}>{catalogForm.id ? 'Изменить' : 'Добавить'} {catalogForm.kind === 'warehouse' ? 'склад' : 'позицию'}</Text><TextInput style={styles.input} value={catalogForm.name} onChangeText={(name) => setCatalogForm({ ...catalogForm, name })} placeholder="Название" placeholderTextColor={colors.subtle} />{catalogForm.kind === 'warehouse' ? <ChoiceRow value={catalogForm.type} options={[['physical', 'Физический'], ['personal', 'Персональный']]} onChange={(type) => setCatalogForm({ ...catalogForm, type })} styles={styles} /> : <><ChoiceRow value={catalogForm.type} options={[['material', 'Материал'], ['product', 'Продукция'], ['service', 'Услуга'], ['work', 'Работа']]} onChange={(type) => setCatalogForm({ ...catalogForm, type })} styles={styles} /><TextInput style={styles.input} value={catalogForm.unit} onChangeText={(unit) => setCatalogForm({ ...catalogForm, unit })} placeholder="Единица измерения" placeholderTextColor={colors.subtle} /></>}<ModalActions onCancel={() => setCatalogForm(null)} onSave={saveCatalog} disabled={!catalogForm.name.trim() || busy} busy={busy} styles={styles} colors={colors} /></View></View>}</Modal>

    <Modal visible={docOpen} transparent animationType="fade" onRequestClose={() => setDocOpen(false)}><View style={styles.modalBackdrop}><ScrollView contentContainerStyle={styles.modalCard} keyboardShouldPersistTaps="handled"><Text style={styles.modalTitle}>Новый складской документ</Text><ChoiceRow value={docType} options={Object.entries(DOC_TYPES)} onChange={(value) => { setDocType(value as keyof typeof DOC_TYPES); setSourceId(''); setTargetId(''); }} styles={styles} />{docType !== 'INFLOW' && <Selector label="Склад-источник" value={sourceId} options={warehouses.map((item) => [String(item.id), item.name])} onChange={setSourceId} styles={styles} />}{docType !== 'WRITE_OFF' && <Selector label="Склад-получатель" value={targetId} options={warehouses.map((item) => [String(item.id), item.name])} onChange={setTargetId} styles={styles} />}<Selector label="Номенклатура" value={lineItemId} options={nomenclature.map((item) => [String(item.id), item.name])} onChange={setLineItemId} styles={styles} /><View style={styles.lineForm}><TextInput style={[styles.input, styles.quantityInput]} value={lineQuantity} onChangeText={setLineQuantity} keyboardType="decimal-pad" placeholder="Количество" placeholderTextColor={colors.subtle} /><TouchableOpacity style={styles.lineAdd} onPress={addDraftLine}><Text style={styles.lineAddText}>Добавить строку</Text></TouchableOpacity></View>{draftLines.map((line, index) => <View key={`${line.nomenclature_id}-${index}`} style={styles.draftLine}><Text style={styles.rowText}>{nomenclatureName(line.nomenclature_id)} · {line.quantity}</Text><TouchableOpacity onPress={() => setDraftLines((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Text style={styles.removeLine}>Убрать</Text></TouchableOpacity></View>)}<ModalActions onCancel={() => setDocOpen(false)} onSave={createDocument} disabled={!draftLines.length || busy} busy={busy} styles={styles} colors={colors} /></ScrollView></View></Modal>

    <Modal visible={Boolean(fundForm)} transparent animationType="fade" onRequestClose={() => setFundForm(null)}>{fundForm && <View style={styles.modalBackdrop}><View style={styles.modalCard}><Text style={styles.modalTitle}>{fundForm.itemName}</Text><ChoiceRow value={fundForm.type} options={[['incoming', 'Приход'], ['outgoing', 'Выдача'], ['return', 'Возврат']]} onChange={(type) => setFundForm({ ...fundForm, type: type as typeof fundForm.type })} styles={styles} /><TextInput style={styles.input} value={fundForm.quantity} onChangeText={(quantity) => setFundForm({ ...fundForm, quantity })} keyboardType="number-pad" placeholder="Количество" placeholderTextColor={colors.subtle} /><TextInput style={[styles.input, styles.commentInput]} value={fundForm.comment} onChangeText={(comment) => setFundForm({ ...fundForm, comment })} placeholder="Комментарий" placeholderTextColor={colors.subtle} multiline /><ModalActions onCancel={() => setFundForm(null)} onSave={saveFundTransaction} disabled={busy} busy={busy} styles={styles} colors={colors} /></View></View>}</Modal>
  </SafeAreaView>;
};

const ChoiceRow = ({ value, options, onChange, styles }: { value: string; options: Array<[string, string]>; onChange: (value: string) => void; styles: ReturnType<typeof createStyles> }) => <View style={styles.choices}>{options.map(([key, label]) => <TouchableOpacity key={key} style={[styles.choice, value === key && styles.choiceActive]} onPress={() => onChange(key)}><Text style={[styles.choiceText, value === key && styles.choiceTextActive]}>{label}</Text></TouchableOpacity>)}</View>;
const Selector = ({ label, value, options, onChange, styles }: { label: string; value: string; options: Array<[string, string]>; onChange: (value: string) => void; styles: ReturnType<typeof createStyles> }) => <View style={styles.selector}><Text style={styles.selectorLabel}>{label}</Text><ScrollView horizontal showsHorizontalScrollIndicator={false}><ChoiceRow value={value} options={options} onChange={onChange} styles={styles} /></ScrollView></View>;
const ActionButton = ({ label, onPress, styles }: { label: string; onPress: () => void; styles: ReturnType<typeof createStyles> }) => <TouchableOpacity style={styles.actionButton} onPress={onPress}><Text style={styles.actionButtonText}>＋ {label}</Text></TouchableOpacity>;
const Empty = ({ text, styles }: { text: string; styles: ReturnType<typeof createStyles> }) => <Text style={styles.empty}>{text}</Text>;
const ModalActions = ({ onCancel, onSave, disabled, busy, styles, colors }: { onCancel: () => void; onSave: () => void; disabled: boolean; busy: boolean; styles: ReturnType<typeof createStyles>; colors: ThemeColors }) => <View style={styles.modalActions}><TouchableOpacity style={styles.cancelButton} onPress={onCancel} disabled={busy}><Text style={styles.cancelText}>Отмена</Text></TouchableOpacity><TouchableOpacity style={[styles.saveButton, disabled && styles.disabled]} onPress={onSave} disabled={disabled}>{busy ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.saveText}>Сохранить</Text>}</TouchableOpacity></View>;

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background }, loader: { marginTop: 44 }, header: { height: 52, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.border, paddingHorizontal: 14 }, back: { width: 70, color: colors.primary, fontWeight: '700' }, title: { flex: 1, color: colors.text, textAlign: 'center', fontSize: 18, fontWeight: '800' }, headerSpace: { width: 70 },
  tabsScroll: { flexGrow: 0, height: 52 }, tabs: { paddingHorizontal: 14, paddingVertical: 8, gap: 6 }, tab: { height: 36, paddingHorizontal: 12, borderRadius: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.input, borderWidth: 1, borderColor: colors.border }, tabActive: { backgroundColor: colors.primary, borderColor: colors.primary }, tabText: { color: colors.muted, fontSize: 12, fontWeight: '700' }, tabTextActive: { color: colors.onPrimary }, error: { color: colors.danger, marginHorizontal: 14, marginBottom: 5 }, contentScroll: { flex: 1 }, content: { padding: 14, paddingTop: 4, paddingBottom: 32 },
  actionButton: { height: 42, borderRadius: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary, marginBottom: 9 }, actionButtonText: { color: colors.onPrimary, fontWeight: '800' }, card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 12, marginBottom: 8 }, cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 }, cardTitle: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '800' }, badge: { color: colors.primarySoft, fontSize: 10, fontWeight: '800' }, rowText: { color: colors.secondary, fontSize: 12, marginTop: 5 }, rowMeta: { color: colors.muted, fontSize: 11, marginTop: 3 }, balance: { color: colors.successBright, fontSize: 13, fontWeight: '800', marginTop: 7 }, inlineAction: { minHeight: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 6, borderWidth: 1, borderColor: colors.primary, marginTop: 9 }, inlineActionText: { color: colors.primarySoft, fontSize: 12, fontWeight: '800' }, empty: { color: colors.subtle, textAlign: 'center', marginTop: 36 },
  modalBackdrop: { flex: 1, justifyContent: 'center', padding: 18, backgroundColor: 'rgba(0,0,0,.68)' }, modalCard: { backgroundColor: colors.surface, borderRadius: 8, borderWidth: 1, borderColor: colors.border, padding: 15 }, modalTitle: { color: colors.text, fontSize: 18, fontWeight: '800', marginBottom: 12 }, input: { height: 44, color: colors.text, backgroundColor: colors.input, borderRadius: 7, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 10, marginBottom: 9 }, commentInput: { height: 82, paddingTop: 10, textAlignVertical: 'top' }, choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 9 }, choice: { minHeight: 35, paddingHorizontal: 9, alignItems: 'center', justifyContent: 'center', borderRadius: 6, backgroundColor: colors.input, borderWidth: 1, borderColor: colors.border }, choiceActive: { backgroundColor: colors.primary, borderColor: colors.primary }, choiceText: { color: colors.muted, fontSize: 11, fontWeight: '700' }, choiceTextActive: { color: colors.onPrimary }, selector: { marginTop: 4 }, selectorLabel: { color: colors.muted, fontSize: 11, fontWeight: '800', marginBottom: 6 }, lineForm: { flexDirection: 'row', gap: 7 }, quantityInput: { flex: 1 }, lineAdd: { height: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10, borderRadius: 7, backgroundColor: colors.primary }, lineAddText: { color: colors.onPrimary, fontSize: 11, fontWeight: '800' }, draftLine: { minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: colors.border }, removeLine: { color: colors.danger, fontSize: 11, fontWeight: '700' }, modalActions: { flexDirection: 'row', gap: 8, marginTop: 14 }, cancelButton: { flex: 1, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 7, borderWidth: 1, borderColor: colors.border }, cancelText: { color: colors.secondary, fontWeight: '700' }, saveButton: { flex: 1, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 7, backgroundColor: colors.primary }, saveText: { color: colors.onPrimary, fontWeight: '800' }, disabled: { opacity: 0.5 },
});
