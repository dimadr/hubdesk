import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, getApiError } from '../api/client';
import { LocationResponse, TicketPriority, TicketResponse, UserInfo, UserListItem } from '../api/types';
import { ThemeColors, useAppTheme } from '../theme/ThemeContext';

interface Props {
  ticket?: TicketResponse;
  user: UserInfo;
  onBack: () => void;
  onSaved: (ticket: TicketResponse) => void;
}

const TYPES = [
  ['repair', 'Ремонт'], ['installation', 'Монтаж'], ['maintenance', 'ТО'],
  ['inspection', 'Инспекция'], ['verification', 'Поверка'], ['emergency', 'Авария'],
] as const;
const PRIORITIES: Array<[TicketPriority, string]> = [
  ['low', 'Низкий'], ['medium', 'Средний'], ['high', 'Высокий'], ['critical', 'Критический'],
];

const isoDate = (value: string | null | undefined) => value?.slice(0, 10) || '';

const endOfDayIso = (value: string): string | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day, 23, 59, 59, 999);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date.toISOString();
};

export const TicketFormScreen: React.FC<Props> = ({ ticket, user, onBack, onSaved }) => {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const editing = Boolean(ticket);
  const canAssign = ['admin', 'director', 'dispatcher', 'accountant'].includes(user.role);
  const [isInternal, setIsInternal] = useState(ticket?.is_internal || false);
  const [subject, setSubject] = useState(ticket?.subject || '');
  const [body, setBody] = useState(ticket?.body || '');
  const [addition, setAddition] = useState(ticket?.source_description || '');
  const [deadline, setDeadline] = useState(isoDate(ticket?.resolution_deadline));
  const [type, setType] = useState(ticket?.type || '');
  const [priority, setPriority] = useState<TicketPriority>(ticket?.priority || 'medium');
  const [contactName, setContactName] = useState(ticket?.site_contact_name || '');
  const [contactPhone, setContactPhone] = useState(ticket?.site_contact_phone || '');
  const [locations, setLocations] = useState<LocationResponse[]>([]);
  const [engineers, setEngineers] = useState<UserListItem[]>([]);
  const [locationId, setLocationId] = useState<number | null>(ticket?.location_id || null);
  const [assigneeId, setAssigneeId] = useState<number | null>(ticket?.assignee_id || (user.role === 'engineer' ? user.user_id : null));
  const [locationQuery, setLocationQuery] = useState('');
  const [loadingLocations, setLoadingLocations] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.allSettled([
      api.get<LocationResponse[]>('/locations'),
      canAssign ? api.get<UserListItem[]>('/users/list') : Promise.resolve({ data: [] as UserListItem[] }),
    ]).then(([locationsResult, usersResult]) => {
      if (locationsResult.status === 'fulfilled') setLocations(locationsResult.value.data);
      else setError(getApiError(locationsResult.reason, 'Не удалось загрузить объекты'));
      if (usersResult.status === 'fulfilled') setEngineers(usersResult.value.data.filter((item) => item.role === 'engineer' && item.status === 'active'));
      setLoadingLocations(false);
    });
  }, [canAssign]);

  const filteredLocations = useMemo(() => {
    const query = locationQuery.trim().toLowerCase();
    if (!query) return locations.slice(0, 20);
    return locations.filter((location) =>
      location.name.toLowerCase().includes(query)
      || location.address.toLowerCase().includes(query)
      || location.customer_name.toLowerCase().includes(query),
    ).slice(0, 20);
  }, [locationQuery, locations]);

  const selectLocation = (location: LocationResponse) => {
    setLocationId(location.id);
    setLocationQuery('');
    if (!contactName) setContactName(location.contact_name || '');
    if (!contactPhone) setContactPhone(location.contact_phone || '');
  };

  const submit = async () => {
    setError('');
    const deadlineValue = deadline.trim() ? endOfDayIso(deadline) : null;
    if (deadline.trim() && !deadlineValue) {
      setError('Укажите дату в формате ГГГГ-ММ-ДД');
      return;
    }
    if (isInternal) {
      if (!body.trim() || !deadlineValue || !assigneeId) {
        setError('Заполните описание, дедлайн и исполнителя');
        return;
      }
    } else if (!subject.trim() || (!editing && !locationId)) {
      setError('Заполните тему и выберите объект');
      return;
    }

    setSaving(true);
    try {
      let payload: Record<string, unknown>;
      if (isInternal) {
        payload = {
          body: body.trim(),
          resolution_deadline: deadlineValue,
        };
        if (!editing) payload.is_internal = true;
        if (canAssign) payload.assignee_id = assigneeId;
        else if (!editing) payload.assignee_id = user.user_id;
      } else if (editing) {
        payload = {
          subject: subject.trim(),
          body,
          source_description: addition || null,
          resolution_deadline: deadlineValue,
          site_contact_name: contactName || null,
          site_contact_phone: contactPhone || null,
        };
        if (canAssign) {
          const location = locations.find((item) => item.id === locationId);
          payload.location_id = locationId;
          payload.customer_id = location?.customer_id || ticket!.customer_id;
          payload.type = type || null;
          payload.priority = priority;
          payload.assignee_id = assigneeId;
        }
      } else {
        const location = locations.find((item) => item.id === locationId);
        if (!location) throw new Error('Выбранный объект не найден');
        payload = {
          subject: subject.trim(),
          body,
          source_description: addition || undefined,
          customer_id: location.customer_id,
          location_id: location.id,
          type: type || undefined,
          priority,
          resolution_deadline: deadlineValue || undefined,
          assignee_id: canAssign ? assigneeId : user.user_id,
          site_contact_name: contactName || undefined,
          site_contact_phone: contactPhone || undefined,
        };
      }
      const response = editing
        ? await api.patch<TicketResponse>(`/tickets/${ticket!.id}`, payload)
        : await api.post<TicketResponse>('/tickets', payload);
      onSaved(response.data);
    } catch (e: any) {
      setError(e?.message === 'Выбранный объект не найден' ? e.message : getApiError(e, 'Не удалось сохранить заявку'));
    } finally {
      setSaving(false);
    }
  };

  const selectedLocation = locations.find((item) => item.id === locationId);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} disabled={saving}><Text style={styles.back}>Назад</Text></TouchableOpacity>
        <Text style={styles.title}>{editing ? `Заявка #${ticket!.number}` : 'Новая заявка'}</Text>
        <View style={styles.headerSpacer} />
      </View>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
          {!editing && (
            <View style={styles.segment}>
              <TouchableOpacity style={[styles.segmentButton, !isInternal && styles.segmentActive]} onPress={() => setIsInternal(false)}>
                <Text style={[styles.segmentText, !isInternal && styles.segmentTextActive]}>Обычная</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.segmentButton, isInternal && styles.segmentActive]} onPress={() => setIsInternal(true)}>
                <Text style={[styles.segmentText, isInternal && styles.segmentTextActive]}>Внутренняя</Text>
              </TouchableOpacity>
            </View>
          )}

          {!isInternal && (
            <>
              <Field label="Тема *" value={subject} onChangeText={setSubject} placeholder="Что необходимо сделать" />
              {editing && !canAssign ? (
                <ReadOnly label="Объект" value={[ticket?.location_name, ticket?.location_address].filter(Boolean).join(', ') || '—'} />
              ) : (
                <View>
                  <Text style={styles.label}>Объект *</Text>
                  {selectedLocation ? (
                    <TouchableOpacity style={styles.selected} onPress={() => setLocationId(null)}>
                      <Text style={styles.selectedTitle}>{selectedLocation.name}</Text>
                      <Text style={styles.selectedText}>{selectedLocation.address}</Text>
                      <Text style={styles.changeText}>Изменить</Text>
                    </TouchableOpacity>
                  ) : (
                    <>
                      <TextInput style={styles.input} value={locationQuery} onChangeText={setLocationQuery} placeholder="Название или адрес" placeholderTextColor={colors.subtle} />
                      {loadingLocations ? <ActivityIndicator color={colors.primary} /> : (
                        <ScrollView style={styles.locationList} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                          {filteredLocations.map((location) => (
                            <TouchableOpacity key={location.id} style={styles.locationRow} onPress={() => selectLocation(location)}>
                              <Text style={styles.locationName}>{location.name}</Text>
                              <Text style={styles.locationMeta}>{location.address} · {location.customer_name}</Text>
                            </TouchableOpacity>
                          ))}
                          {!filteredLocations.length && <Text style={styles.empty}>Объекты не найдены</Text>}
                        </ScrollView>
                      )}
                    </>
                  )}
                </View>
              )}
            </>
          )}

          <Field label={isInternal ? 'Описание *' : 'Описание'} value={body} onChangeText={setBody} multiline placeholder="Описание работ" />
          {!isInternal && <Field label="Примечание" value={addition} onChangeText={setAddition} multiline placeholder="Дополнительная информация" />}

          {!isInternal && (!editing || canAssign) && (
            <>
              <Text style={styles.label}>Тип</Text>
              <View style={styles.chips}>{TYPES.map(([value, label]) => <Chip key={value} label={label} active={type === value} onPress={() => setType(type === value ? '' : value)} />)}</View>
              <Text style={styles.label}>Приоритет</Text>
              <View style={styles.chips}>{PRIORITIES.map(([value, label]) => <Chip key={value} label={label} active={priority === value} onPress={() => setPriority(value)} />)}</View>
            </>
          )}

          <Field label={isInternal ? 'Дедлайн *' : 'Дедлайн'} value={deadline} onChangeText={setDeadline} placeholder="ГГГГ-ММ-ДД" keyboardType="numbers-and-punctuation" />
          {canAssign ? (
            <View><Text style={styles.label}>Исполнитель {isInternal ? '*' : ''}</Text><View style={styles.choiceList}><Choice label="Не назначен" active={!assigneeId} onPress={() => setAssigneeId(null)} styles={styles} />{engineers.map((engineer) => <Choice key={engineer.id} label={[engineer.name, engineer.patronymic].filter(Boolean).join(' ')} active={assigneeId === engineer.id} onPress={() => setAssigneeId(engineer.id)} styles={styles} />)}</View></View>
          ) : <ReadOnly label="Исполнитель" value={ticket?.assignee_name || user.name} />}

          {!isInternal && (
            <>
              <Field label="Контактное лицо" value={contactName} onChangeText={setContactName} placeholder="ФИО" />
              <Field label="Телефон" value={contactPhone} onChangeText={setContactPhone} placeholder="+7..." keyboardType="phone-pad" />
            </>
          )}

          {error ? <Text style={styles.error}>{error}</Text> : null}
          <TouchableOpacity style={[styles.save, saving && styles.disabled]} onPress={submit} disabled={saving}>
            {saving ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.saveText}>{editing ? 'Сохранить' : 'Создать заявку'}</Text>}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const Field = ({ label, multiline, ...props }: any) => {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return <View><Text style={styles.label}>{label}</Text><TextInput {...props} multiline={multiline} textAlignVertical={multiline ? 'top' : 'center'} style={[styles.input, multiline && styles.textarea]} placeholderTextColor={colors.subtle} /></View>;
};
const ReadOnly = ({ label, value }: { label: string; value: string }) => {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return <View><Text style={styles.label}>{label}</Text><View style={styles.readOnly}><Text style={styles.readOnlyText}>{value}</Text></View></View>;
};
const Chip = ({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) => {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return <TouchableOpacity style={[styles.chip, active && styles.chipActive]} onPress={onPress}><Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text></TouchableOpacity>;
};
const Choice = ({ label, active, onPress, styles }: { label: string; active: boolean; onPress: () => void; styles: ReturnType<typeof createStyles> }) => <TouchableOpacity style={[styles.choice, active && styles.choiceActive]} onPress={onPress}><Text style={[styles.choiceText, active && styles.choiceTextActive]}>{label}</Text></TouchableOpacity>;

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background }, flex: { flex: 1 },
  header: { height: 52, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.border },
  back: { color: colors.primary, fontWeight: '700', width: 56 }, title: { flex: 1, color: colors.text, fontSize: 18, fontWeight: '800', textAlign: 'center' }, headerSpacer: { width: 56 },
  form: { padding: 14, paddingBottom: 40, gap: 14 },
  segment: { flexDirection: 'row', backgroundColor: colors.input, borderRadius: 8, padding: 3 }, segmentButton: { flex: 1, padding: 10, alignItems: 'center', borderRadius: 6 }, segmentActive: { backgroundColor: colors.primary }, segmentText: { color: colors.muted, fontWeight: '700' }, segmentTextActive: { color: colors.onPrimary },
  label: { color: colors.muted, fontSize: 12, fontWeight: '700', marginBottom: 6 },
  input: { minHeight: 44, backgroundColor: colors.input, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12, color: colors.text, fontSize: 14 }, textarea: { minHeight: 92, paddingTop: 12 },
  readOnly: { minHeight: 44, justifyContent: 'center', backgroundColor: colors.surface, borderRadius: 8, paddingHorizontal: 12 }, readOnlyText: { color: colors.secondary, fontSize: 14 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, chip: { backgroundColor: colors.surface, borderRadius: 6, paddingHorizontal: 11, paddingVertical: 8, borderWidth: 1, borderColor: colors.border }, chipActive: { backgroundColor: colors.primary, borderColor: colors.primary }, chipText: { color: colors.muted, fontSize: 12, fontWeight: '600' }, chipTextActive: { color: colors.onPrimary },
  selected: { backgroundColor: colors.surface, borderRadius: 8, padding: 12, borderWidth: 1, borderColor: colors.primary }, selectedTitle: { color: colors.text, fontWeight: '700' }, selectedText: { color: colors.muted, fontSize: 12, marginTop: 3 }, changeText: { color: colors.primary, fontSize: 12, fontWeight: '700', marginTop: 7 },
  locationList: { maxHeight: 220, backgroundColor: colors.surface, borderRadius: 8, overflow: 'hidden', marginTop: 6 }, locationRow: { padding: 11, borderBottomWidth: 1, borderBottomColor: colors.border }, locationName: { color: colors.text, fontSize: 13, fontWeight: '700' }, locationMeta: { color: colors.muted, fontSize: 11, marginTop: 3 }, empty: { color: colors.subtle, textAlign: 'center', padding: 16 },
  choiceList: { gap: 7 }, choice: { minHeight: 40, justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 7, paddingHorizontal: 11 }, choiceActive: { backgroundColor: colors.primary, borderColor: colors.primary }, choiceText: { color: colors.secondary, fontSize: 12, fontWeight: '700' }, choiceTextActive: { color: colors.onPrimary },
  error: { color: colors.danger, fontSize: 13 }, save: { height: 50, backgroundColor: colors.success, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }, saveText: { color: colors.onPrimary, fontWeight: '800', fontSize: 15 }, disabled: { opacity: 0.6 },
});
