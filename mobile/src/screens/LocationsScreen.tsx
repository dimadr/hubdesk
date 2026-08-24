import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Platform, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { api, getApiError } from '../api/client';
import { LocationContact, LocationResponse, STATUS_LABELS, TicketResponse, UserInfo, UserListItem } from '../api/types';
import { ThemeColors, useAppTheme } from '../theme/ThemeContext';

interface CustomerRow { id: number; name: string; }
interface Props { user: UserInfo; onBack: () => void; onOpenTicket: (ticket: TicketResponse) => void; }

export const LocationsScreen: React.FC<Props> = ({ user, onBack, onOpenTicket }) => {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [locations, setLocations] = useState<LocationResponse[]>([]);
  const [selected, setSelected] = useState<LocationResponse | null>(null);
  const [editing, setEditing] = useState(false);
  const [tickets, setTickets] = useState<TicketResponse[]>([]);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [engineers, setEngineers] = useState<UserListItem[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [worksLoading, setWorksLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const { data } = await api.get<LocationResponse[]>('/locations');
      setLocations(data);
    } catch (e) {
      setError(getApiError(e, 'Не удалось загрузить объекты'));
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openLocation = async (location: LocationResponse) => {
    setSelected(location); setEditing(false); setTickets([]); setWorksLoading(true); setError('');
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

  const beginEdit = async () => {
    setEditing(true);
    const [usersResult, customersResult] = await Promise.allSettled([
      api.get<UserListItem[]>('/users/list'), api.get<CustomerRow[]>('/admin/customers'),
    ]);
    if (usersResult.status === 'fulfilled') setEngineers(usersResult.value.data.filter((item) => item.role === 'engineer'));
    if (customersResult.status === 'fulfilled') setCustomers(customersResult.value.data);
  };

  const closeModal = () => { setSelected(null); setEditing(false); setError(''); };
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
            <Text style={styles.cardTitle}>{item.name}</Text><Text style={styles.cardMeta}>{item.customer_name}</Text><Text style={styles.cardMeta}>{item.address}</Text>
            {item.assigned_engineer_name ? <Text style={styles.cardFoot}>Инженер: {item.assigned_engineer_name}</Text> : null}
          </TouchableOpacity>
        )} />
      )}
      <Modal visible={Boolean(selected)} animationType="slide" onRequestClose={closeModal}>
        <SafeAreaView style={styles.container}>
          <View style={styles.header}>
            <TouchableOpacity onPress={editing ? () => setEditing(false) : closeModal}><Text style={styles.back}>Назад</Text></TouchableOpacity>
            <Text style={styles.headerTitle} numberOfLines={1}>{selected?.name}</Text>
            {selected && !editing ? <TouchableOpacity onPress={beginEdit}><Text style={styles.edit}>Изменить</Text></TouchableOpacity> : <View style={styles.spacer} />}
          </View>
          {selected && editing ? (
            <LocationEditor location={selected} user={user} customers={customers} engineers={engineers} onSaved={(updated) => { setSelected(updated); setLocations((current) => current.map((item) => item.id === updated.id ? updated : item)); setEditing(false); }} />
          ) : (
            <ScrollView contentContainerStyle={styles.modalContent}>
              {selected ? <LocationDetails location={selected} styles={styles} /> : null}
              <Text style={styles.sectionTitle}>Работы ({tickets.length})</Text>
              {error ? <Text style={styles.error}>{error}</Text> : null}
              {worksLoading ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : tickets.map((ticket) => (
                <TouchableOpacity key={ticket.id} style={styles.ticket} onPress={() => { closeModal(); onOpenTicket(ticket); }}>
                  <Text style={styles.ticketNumber}>#{ticket.number} · {STATUS_LABELS[ticket.status]}</Text><Text style={styles.ticketTitle}>{ticket.subject}</Text><Text style={styles.cardMeta}>{ticket.assignee_name || 'Исполнитель не назначен'} · {new Date(ticket.created_at).toLocaleDateString('ru-RU')}</Text>
                </TouchableOpacity>
              ))}
              {!worksLoading && !tickets.length && !error ? <Text style={styles.empty}>По объекту нет заявок</Text> : null}
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
};

const LocationDetails = ({ location, styles }: { location: LocationResponse; styles: ReturnType<typeof createStyles> }) => (
  <View style={styles.locationInfo}>
    <Text style={styles.cardTitle}>{location.name}</Text><Text style={styles.cardMeta}>{location.customer_name}</Text><Text style={styles.cardMeta}>{location.address}</Text>
    {location.inn ? <Text style={styles.cardMeta}>ИНН: {location.inn}</Text> : null}
    {location.contact_name ? <Text style={styles.cardFoot}>{location.contact_name}{location.contact_phone ? ` · ${location.contact_phone}` : ''}</Text> : null}
    {location.contact_email ? <Text style={styles.cardMeta}>{location.contact_email}</Text> : null}
    {location.assigned_engineer_name ? <Text style={styles.cardFoot}>Инженер: {location.assigned_engineer_name}</Text> : null}
    {location.contract_number ? <Text style={styles.cardMeta}>Договор: {location.contract_number}</Text> : null}
  </View>
);

const LocationEditor = ({ location, user, customers, engineers, onSaved }: { location: LocationResponse; user: UserInfo; customers: CustomerRow[]; engineers: UserListItem[]; onSaved: (location: LocationResponse) => void }) => {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [name, setName] = useState(location.name); const [address, setAddress] = useState(location.address); const [inn, setInn] = useState(location.inn || '');
  const [contactName, setContactName] = useState(location.contact_name || ''); const [contactPhone, setContactPhone] = useState(location.contact_phone || ''); const [contactEmail, setContactEmail] = useState(location.contact_email || '');
  const [contacts, setContacts] = useState<LocationContact[]>(location.contacts_list || []); const [customerId, setCustomerId] = useState(location.customer_id); const [engineerId, setEngineerId] = useState<number | null>(location.assigned_engineer_id);
  const [contractNumber, setContractNumber] = useState(location.contract_number || ''); const [contractFrom, setContractFrom] = useState(location.contract_valid_from || ''); const [contractTo, setContractTo] = useState(location.contract_valid_to || '');
  const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  const canChangeCustomer = ['admin', 'director', 'dispatcher'].includes(user.role) && customers.length > 0;
  const canChangeEngineer = ['admin', 'director', 'dispatcher', 'accountant'].includes(user.role);
  const updateContact = (index: number, field: keyof LocationContact, value: string) => setContacts((current) => current.map((contact, itemIndex) => itemIndex === index ? { ...contact, [field]: value } : contact));
  const addContact = () => setContacts((current) => [...current, { name: '', phone: null, email: null, position: null, is_primary: current.length === 0 }]);
  const removeContact = (index: number) => setContacts((current) => current.filter((_, itemIndex) => itemIndex !== index).map((contact, itemIndex) => ({ ...contact, is_primary: itemIndex === 0 })));

  const save = async () => {
    if (!name.trim()) { setError('Название объекта обязательно'); return; }
    const normalizedContacts = contacts.filter((contact) => contact.name.trim()).map((contact, index) => ({ name: contact.name.trim(), phone: contact.phone?.trim() || null, email: contact.email?.trim() || null, position: contact.position?.trim() || null, is_primary: index === 0 }));
    const payload: Record<string, unknown> = { name: name.trim(), address: address.trim(), inn: inn.trim() || null, contact_name: contactName.trim() || null, contact_phone: contactPhone.trim() || null, contact_email: contactEmail.trim() || null, contacts_list: normalizedContacts, contract_number: contractNumber.trim() || null, contract_valid_from: contractFrom.trim() || null, contract_valid_to: contractTo.trim() || null };
    if (canChangeCustomer) payload.customer_id = customerId;
    if (canChangeEngineer) payload.assigned_engineer_id = engineerId;
    setSaving(true); setError('');
    try { const { data } = await api.patch<LocationResponse>(`/locations/${location.id}`, payload); onSaved(data); }
    catch (e) { setError(getApiError(e, 'Не удалось сохранить объект')); }
    finally { setSaving(false); }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
        <Field label="Название" value={name} onChangeText={setName} styles={styles} /><Field label="Адрес" value={address} onChangeText={setAddress} styles={styles} /><Field label="ИНН" value={inn} onChangeText={setInn} keyboardType="number-pad" styles={styles} />
        <Text style={styles.label}>Клиент</Text>{canChangeCustomer ? <View style={styles.choiceList}>{customers.map((customer) => <Choice key={customer.id} label={customer.name} active={customerId === customer.id} onPress={() => setCustomerId(customer.id)} styles={styles} />)}</View> : <ReadOnly value={location.customer_name} styles={styles} />}
        <Text style={styles.label}>Ответственный инженер</Text>{canChangeEngineer ? <View style={styles.choiceList}><Choice label="Не назначен" active={!engineerId} onPress={() => setEngineerId(null)} styles={styles} />{engineers.map((engineer) => <Choice key={engineer.id} label={[engineer.name, engineer.patronymic].filter(Boolean).join(' ')} active={engineerId === engineer.id} onPress={() => setEngineerId(engineer.id)} styles={styles} />)}</View> : <ReadOnly value={location.assigned_engineer_name || 'Не назначен'} styles={styles} />}
        <Text style={styles.sectionTitle}>Основной контакт</Text><Field label="Имя" value={contactName} onChangeText={setContactName} styles={styles} /><Field label="Телефон" value={contactPhone} onChangeText={setContactPhone} keyboardType="phone-pad" styles={styles} /><Field label="Email" value={contactEmail} onChangeText={setContactEmail} keyboardType="email-address" autoCapitalize="none" styles={styles} />
        <Text style={styles.sectionTitle}>Дополнительные контакты</Text>
        {contacts.map((contact, index) => <View key={contact.id ?? `new-${index}`} style={styles.contactBlock}><Field label={index === 0 ? 'Основной контакт' : `Контакт ${index + 1}`} value={contact.name} onChangeText={(value: string) => updateContact(index, 'name', value)} styles={styles} /><Field label="Телефон" value={contact.phone || ''} onChangeText={(value: string) => updateContact(index, 'phone', value)} keyboardType="phone-pad" styles={styles} /><Field label="Email" value={contact.email || ''} onChangeText={(value: string) => updateContact(index, 'email', value)} keyboardType="email-address" autoCapitalize="none" styles={styles} /><Field label="Должность" value={contact.position || ''} onChangeText={(value: string) => updateContact(index, 'position', value)} styles={styles} /><TouchableOpacity style={styles.removeButton} onPress={() => removeContact(index)}><Text style={styles.removeText}>Убрать контакт</Text></TouchableOpacity></View>)}
        <TouchableOpacity style={styles.outlineButton} onPress={addContact}><Text style={styles.outlineText}>Добавить контакт</Text></TouchableOpacity>
        <Text style={styles.sectionTitle}>Договор</Text><Field label="Номер" value={contractNumber} onChangeText={setContractNumber} styles={styles} /><Field label="Действует с" value={contractFrom} onChangeText={setContractFrom} placeholder="ГГГГ-ММ-ДД" styles={styles} /><Field label="Действует до" value={contractTo} onChangeText={setContractTo} placeholder="ГГГГ-ММ-ДД" styles={styles} />
        {error ? <Text style={styles.formError}>{error}</Text> : null}<TouchableOpacity style={[styles.saveButton, saving && styles.disabled]} onPress={save} disabled={saving}>{saving ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.saveText}>Сохранить</Text>}</TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const Field = ({ label, styles, ...props }: any) => <View><Text style={styles.label}>{label}</Text><TextInput {...props} style={styles.input} placeholderTextColor={styles.placeholder.color} /></View>;
const ReadOnly = ({ value, styles }: { value: string; styles: ReturnType<typeof createStyles> }) => <View style={styles.readOnly}><Text style={styles.readOnlyText}>{value}</Text></View>;
const Choice = ({ label, active, onPress, styles }: { label: string; active: boolean; onPress: () => void; styles: ReturnType<typeof createStyles> }) => <TouchableOpacity style={[styles.choice, active && styles.choiceActive]} onPress={onPress}><Text style={[styles.choiceText, active && styles.choiceTextActive]}>{label}</Text></TouchableOpacity>;

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background }, flex: { flex: 1 }, header: { height: 52, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.border },
  back: { color: colors.primary, width: 70, fontWeight: '700' }, edit: { color: colors.primary, width: 70, fontWeight: '700', textAlign: 'right' }, headerTitle: { flex: 1, color: colors.text, fontSize: 17, fontWeight: '800', textAlign: 'center' }, spacer: { width: 70 },
  search: { height: 44, margin: 14, marginBottom: 8, backgroundColor: colors.input, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12, color: colors.text }, list: { padding: 14, paddingTop: 6, paddingBottom: 28, flexGrow: 1 }, loader: { marginTop: 36 }, error: { color: colors.danger, textAlign: 'center', margin: 14 }, empty: { color: colors.subtle, textAlign: 'center', marginTop: 32 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 13, marginBottom: 8 }, cardTitle: { color: colors.text, fontSize: 15, fontWeight: '800' }, cardMeta: { color: colors.muted, fontSize: 12, marginTop: 4 }, cardFoot: { color: colors.secondary, fontSize: 12, marginTop: 8 }, modalContent: { padding: 14, paddingBottom: 32 }, locationInfo: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 13 },
  sectionTitle: { color: colors.subtle, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', marginTop: 20, marginBottom: 8 }, ticket: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 12, marginBottom: 7 }, ticketNumber: { color: colors.muted, fontSize: 11, fontWeight: '700' }, ticketTitle: { color: colors.text, fontSize: 14, fontWeight: '700', marginTop: 4 },
  form: { padding: 14, paddingBottom: 36, gap: 13 }, label: { color: colors.muted, fontSize: 12, fontWeight: '700', marginBottom: 6 }, input: { minHeight: 44, color: colors.text, backgroundColor: colors.input, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12 }, placeholder: { color: colors.subtle }, readOnly: { minHeight: 44, justifyContent: 'center', backgroundColor: colors.surface, borderRadius: 8, paddingHorizontal: 12 }, readOnlyText: { color: colors.secondary, fontSize: 13 },
  choiceList: { gap: 7 }, choice: { minHeight: 40, justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 7, paddingHorizontal: 11 }, choiceActive: { backgroundColor: colors.primary, borderColor: colors.primary }, choiceText: { color: colors.secondary, fontSize: 12, fontWeight: '700' }, choiceTextActive: { color: colors.onPrimary }, contactBlock: { gap: 9, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 11 }, removeButton: { alignSelf: 'flex-start', paddingVertical: 4 }, removeText: { color: colors.danger, fontSize: 12, fontWeight: '700' }, outlineButton: { height: 42, borderWidth: 1, borderColor: colors.primary, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }, outlineText: { color: colors.primary, fontWeight: '700' },
  formError: { color: colors.danger, fontSize: 13 }, saveButton: { height: 50, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.success, borderRadius: 8 }, saveText: { color: colors.onPrimary, fontWeight: '800' }, disabled: { opacity: 0.55 },
});
