import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, Linking, RefreshControl, ScrollView, StyleSheet, Text,
  TextInput, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { api, getApiError } from '../api/client';
import { uploadTicketPhoto } from '../api/uploads';
import {
  AttachmentResponse, BTN_LABELS, ChecklistField, ChecklistResponse, CommentResponse,
  NEXT_STATUS, PRIORITY_LABELS, STATUS_LABELS, TicketResponse, TYPE_LABELS, UserInfo,
} from '../api/types';
import { ThemeColors, useAppTheme } from '../theme/ThemeContext';
import { buildCommentWithLink, isHttpUrl } from '../utils/ticketContent';

interface Props {
  ticketId: number;
  user: UserInfo;
  onBack: () => void;
  onEdit: (ticket: TicketResponse) => void;
  onComplete: (ticket: TicketResponse) => void;
}

const fmtDate = (value: string | null) => value
  ? new Date(value).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  : '—';

export const TicketDetailScreen: React.FC<Props> = ({ ticketId, user, onBack, onEdit, onComplete }) => {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [ticket, setTicket] = useState<TicketResponse | null>(null);
  const [comments, setComments] = useState<CommentResponse[]>([]);
  const [attachments, setAttachments] = useState<AttachmentResponse[]>([]);
  const [checklists, setChecklists] = useState<ChecklistResponse[]>([]);
  const [fieldValues, setFieldValues] = useState<Record<number, string>>({});
  const [newComment, setNewComment] = useState('');
  const [linkTitle, setLinkTitle] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [ticketResult, commentResult, attachmentResult, checklistResult] = await Promise.all([
        api.get<TicketResponse>(`/tickets/${ticketId}`),
        api.get<CommentResponse[]>(`/tickets/${ticketId}/comments`),
        api.get<AttachmentResponse[]>('/attachments', { params: { ticket_id: ticketId } }),
        api.get<ChecklistResponse[]>(`/tickets/${ticketId}/checklists`),
      ]);
      setTicket(ticketResult.data);
      setComments(commentResult.data);
      setAttachments(attachmentResult.data);
      setChecklists(checklistResult.data);
      setFieldValues(Object.fromEntries(checklistResult.data.flatMap((checklist) => checklist.fields.map((field) => [field.id, field.value || '']))));
    } catch (e) {
      setError(getApiError(e, 'Не удалось загрузить заявку'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [ticketId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const changeStatus = async () => {
    if (!ticket) return;
    const next = NEXT_STATUS[ticket.status];
    if (!next) return;
    if (next === 'COMPLETED') {
      onComplete(ticket);
      return;
    }
    setBusy(true);
    try {
      await api.patch(`/tickets/${ticket.id}/status`, { status: next });
      await load();
    } catch (e) {
      Alert.alert('Статус не изменен', getApiError(e));
    } finally {
      setBusy(false);
    }
  };

  const addComment = async () => {
    if (linkUrl.trim() && !isHttpUrl(linkUrl)) {
      Alert.alert('Неверная ссылка', 'Ссылка должна начинаться с http:// или https://');
      return;
    }
    const body = buildCommentWithLink(newComment, linkTitle, linkUrl);
    if (!body || !ticket) return;
    setBusy(true);
    try {
      await api.post(`/tickets/${ticket.id}/comments`, { body, is_internal: false });
      setNewComment('');
      setLinkTitle('');
      setLinkUrl('');
      await load();
    } catch (e) {
      Alert.alert('Комментарий не добавлен', getApiError(e));
    } finally {
      setBusy(false);
    }
  };

  const addPhoto = async (source: 'camera' | 'library', field?: { checklistId: number; field: ChecklistField }) => {
    if (!ticket) return;
    const permission = source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Нет доступа', source === 'camera' ? 'Разрешите приложению использовать камеру' : 'Разрешите приложению выбирать фотографии');
      return;
    }
    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync({ quality: 0.75, mediaTypes: ImagePicker.MediaTypeOptions.Images })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.75, mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsMultipleSelection: false });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setBusy(true);
    try {
      const attachment = await uploadTicketPhoto(
        ticket.id,
        asset.uri,
        asset.fileName || `photo-${Date.now()}.jpg`,
        asset.mimeType || 'image/jpeg',
      );
      if (field) {
        await api.patch(`/tickets/${ticket.id}/checklist/${field.checklistId}/field/${field.field.id}`, {
          value: `Фото: ${attachment.filename}`,
        });
      }
      await load();
    } catch (e) {
      Alert.alert('Фото не загружено', getApiError(e));
    } finally {
      setBusy(false);
    }
  };

  const saveField = async (checklistId: number, field: ChecklistField, value: string) => {
    if (!ticket) return;
    setBusy(true);
    try {
      await api.patch(`/tickets/${ticket.id}/checklist/${checklistId}/field/${field.id}`, { value });
      setFieldValues((current) => ({ ...current, [field.id]: value }));
    } catch (e) {
      Alert.alert('Поле не сохранено', getApiError(e));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <SafeAreaView style={styles.container}><ActivityIndicator color={colors.primary} size="large" style={styles.loader} /></SafeAreaView>;
  if (!ticket) return <SafeAreaView style={styles.container}><View style={styles.center}><Text style={styles.error}>{error || 'Заявка не найдена'}</Text><TouchableOpacity onPress={load}><Text style={styles.retry}>Повторить</Text></TouchableOpacity></View></SafeAreaView>;

  const canModify = ['admin', 'director', 'dispatcher', 'accountant'].includes(user.role)
    || (user.role === 'engineer' && ticket.assignee_id === user.user_id);
  const canChangeStatus = ['admin', 'director', 'accountant'].includes(user.role)
    || (user.role === 'engineer' && ticket.assignee_id === user.user_id)
    || (user.role === 'dispatcher' && ticket.status === 'IN_PROGRESS');
  const next = NEXT_STATUS[ticket.status];

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} disabled={busy}><Text style={styles.back}>Назад</Text></TouchableOpacity>
        <Text style={styles.headerTitle}>#{ticket.number}</Text>
        {canModify && <TouchableOpacity onPress={() => onEdit(ticket)} disabled={busy}><Text style={styles.edit}>Изменить</Text></TouchableOpacity>}
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} colors={[colors.primary]} />}
        keyboardShouldPersistTaps="handled"
      >
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Text style={styles.subject}>{ticket.subject}</Text>
        <View style={styles.summary}>
          <Info label="Статус" value={STATUS_LABELS[ticket.status]} />
          <Info label="Приоритет" value={PRIORITY_LABELS[ticket.priority]} />
          {ticket.type && <Info label="Тип" value={TYPE_LABELS[ticket.type] || ticket.type} />}
          <Info label="Создана" value={fmtDate(ticket.created_at)} />
          <Info label="Дедлайн" value={fmtDate(ticket.resolution_deadline)} danger={ticket.resolution_overdue} />
          {ticket.assignee_name && <Info label="Исполнитель" value={ticket.assignee_name} />}
        </View>

        {!ticket.is_internal && (ticket.location_name || ticket.location_address) && (
          <Section title="Объект">
            {ticket.customer_name && <Text style={styles.primaryText}>{ticket.customer_name}</Text>}
            {ticket.location_name && <Text style={styles.primaryText}>{ticket.location_name}</Text>}
            {ticket.location_address && <Text style={styles.secondaryText}>{ticket.location_address}</Text>}
            {ticket.site_contact_name && <Text style={styles.secondaryText}>{ticket.site_contact_name}</Text>}
            {ticket.site_contact_phone && <TouchableOpacity onPress={() => Linking.openURL(`tel:${ticket.site_contact_phone}`)}><Text style={styles.phone}>{ticket.site_contact_phone}</Text></TouchableOpacity>}
          </Section>
        )}

        <Section title="Описание"><Text style={styles.body}>{ticket.body || '—'}</Text></Section>
        {ticket.source_description && <Section title={ticket.is_internal ? 'Дополнение по работам' : 'Примечание'}><Text style={styles.body}>{ticket.source_description}</Text></Section>}

        {checklists.map((checklist) => (
          <Section key={checklist.id} title={checklist.name}>
            {checklist.fields.map((field) => (
              <ChecklistInput
                key={field.id}
                field={field}
                value={fieldValues[field.id] || ''}
                disabled={busy || !canModify}
                onChange={(value) => setFieldValues((current) => ({ ...current, [field.id]: value }))}
                onSave={(value) => saveField(checklist.id, field, value)}
                onCamera={() => addPhoto('camera', { checklistId: checklist.id, field })}
                onGallery={() => addPhoto('library', { checklistId: checklist.id, field })}
              />
            ))}
          </Section>
        ))}

        <Section title={`Файлы · ${attachments.length}`}>
          {attachments.length ? attachments.map((attachment) => <Text key={attachment.id} style={styles.file}>• {attachment.filename}</Text>) : <Text style={styles.muted}>Нет файлов</Text>}
          {canModify && <View style={styles.fileActions}><TouchableOpacity style={styles.outlineButton} onPress={() => addPhoto('camera')} disabled={busy}><Text style={styles.outlineText}>Камера</Text></TouchableOpacity><TouchableOpacity style={styles.outlineButton} onPress={() => addPhoto('library')} disabled={busy}><Text style={styles.outlineText}>Галерея</Text></TouchableOpacity></View>}
        </Section>

        <Section title={`Комментарии · ${comments.length}`}>
          {comments.map((comment) => (
            <View key={comment.id} style={styles.comment}>
              <View style={styles.commentHeader}><Text style={styles.commentAuthor}>{comment.user_name || `Пользователь #${comment.user_id}`}</Text><Text style={styles.commentDate}>{fmtDate(comment.created_at)}</Text></View>
              <LinkedText body={comment.body} styles={styles} />
            </View>
          ))}
          {!comments.length && <Text style={styles.muted}>Нет комментариев</Text>}
          {canModify && (
            <View style={styles.commentForm}>
              <TextInput style={styles.commentInput} value={newComment} onChangeText={setNewComment} placeholder="Комментарий" placeholderTextColor={colors.subtle} multiline />
              <TextInput style={styles.linkInput} value={linkTitle} onChangeText={setLinkTitle} placeholder="Название ссылки (необязательно)" placeholderTextColor={colors.subtle} />
              <TextInput style={styles.linkInput} value={linkUrl} onChangeText={setLinkUrl} placeholder="https://..." placeholderTextColor={colors.subtle} autoCapitalize="none" autoCorrect={false} keyboardType="url" />
              <TouchableOpacity style={[styles.send, (!(newComment.trim() || linkUrl.trim()) || busy) && styles.disabled]} onPress={addComment} disabled={!(newComment.trim() || linkUrl.trim()) || busy}><Text style={styles.sendText}>Добавить</Text></TouchableOpacity>
            </View>
          )}
        </Section>
      </ScrollView>
      {canChangeStatus && next && (
        <TouchableOpacity style={[styles.action, busy && styles.disabled]} onPress={changeStatus} disabled={busy}>
          {busy ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.actionText}>{BTN_LABELS[next]}</Text>}
        </TouchableOpacity>
      )}
    </SafeAreaView>
  );
};

const Info = ({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) => {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return <View style={styles.info}><Text style={styles.infoLabel}>{label}</Text><Text style={[styles.infoValue, danger && styles.danger]}>{value}</Text></View>;
};
const Section = ({ title, children }: { title: string; children: React.ReactNode }) => {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return <View style={styles.section}><Text style={styles.sectionTitle}>{title}</Text>{children}</View>;
};

const LinkedText = ({ body, styles }: { body: string; styles: ReturnType<typeof createStyles> }) => {
  const pattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s]+)/gi;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body)) !== null) {
    if (match.index > lastIndex) parts.push(body.slice(lastIndex, match.index));
    const url = match[2] || match[3];
    const label = match[1] || url;
    parts.push(<Text key={`${match.index}-${url}`} style={styles.link} onPress={() => Linking.openURL(url)}>{label}</Text>);
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < body.length) parts.push(body.slice(lastIndex));
  return <Text style={styles.body}>{parts}</Text>;
};

const ChecklistInput = ({ field, value, disabled, onChange, onSave, onCamera, onGallery }: {
  field: ChecklistField; value: string; disabled: boolean; onChange: (value: string) => void; onSave: (value: string) => void; onCamera: () => void; onGallery: () => void;
}) => {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  if (field.field_type === 'photo') return (
    <View style={styles.checkRow}><View style={styles.checkLabelWrap}><Text style={styles.checkLabel}>{field.label}{field.is_mandatory ? ' *' : ''}</Text>{value ? <Text style={styles.saved}>{value}</Text> : null}</View><TouchableOpacity style={styles.smallButton} onPress={onCamera} disabled={disabled}><Text style={styles.smallButtonText}>Камера</Text></TouchableOpacity><TouchableOpacity style={styles.smallButton} onPress={onGallery} disabled={disabled}><Text style={styles.smallButtonText}>Галерея</Text></TouchableOpacity></View>
  );
  if (field.field_type === 'checkbox') {
    const checked = value.toLowerCase() === 'true' || value === '1' || value.toLowerCase() === 'да';
    return <TouchableOpacity style={styles.checkRow} onPress={() => onSave(checked ? 'false' : 'true')} disabled={disabled}><Text style={[styles.checkbox, checked && styles.checkboxOn]}>{checked ? '✓' : ''}</Text><Text style={styles.checkLabel}>{field.label}{field.is_mandatory ? ' *' : ''}</Text></TouchableOpacity>;
  }
  return (
    <View style={styles.fieldBlock}><Text style={styles.checkLabel}>{field.label}{field.is_mandatory ? ' *' : ''}</Text><View style={styles.fieldLine}><TextInput style={styles.fieldInput} value={value} onChangeText={onChange} editable={!disabled} keyboardType={field.field_type === 'number' ? 'numeric' : 'default'} /><TouchableOpacity style={styles.smallButton} onPress={() => onSave(value)} disabled={disabled}><Text style={styles.smallButtonText}>OK</Text></TouchableOpacity></View></View>
  );
};

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background }, loader: { marginTop: 44 }, center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  header: { height: 52, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.border }, back: { color: colors.primary, fontWeight: '700', width: 72 }, headerTitle: { flex: 1, textAlign: 'center', color: colors.text, fontSize: 17, fontWeight: '800' }, edit: { color: colors.primary, fontWeight: '700', width: 72, textAlign: 'right' },
  content: { padding: 14, paddingBottom: 100 }, subject: { color: colors.text, fontSize: 22, lineHeight: 28, fontWeight: '800', marginBottom: 14 },
  summary: { flexDirection: 'row', flexWrap: 'wrap', borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border, paddingVertical: 8 }, info: { width: '50%', paddingVertical: 6, paddingRight: 8 }, infoLabel: { color: colors.subtle, fontSize: 10, fontWeight: '700', textTransform: 'uppercase' }, infoValue: { color: colors.text, fontSize: 13, marginTop: 3 }, danger: { color: colors.danger },
  section: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border }, sectionTitle: { color: colors.muted, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', marginBottom: 8 }, primaryText: { color: colors.text, fontSize: 14, fontWeight: '700', marginBottom: 3 }, secondaryText: { color: colors.secondary, fontSize: 13, lineHeight: 19 }, phone: { color: colors.info, fontSize: 15, fontWeight: '700', marginTop: 5 }, body: { color: colors.text, fontSize: 14, lineHeight: 21 }, muted: { color: colors.subtle, fontSize: 13 },
  file: { color: colors.secondary, fontSize: 13, paddingVertical: 3 }, fileActions: { flexDirection: 'row', gap: 7, marginTop: 9 }, outlineButton: { flex: 1, height: 40, borderWidth: 1, borderColor: colors.primary, borderRadius: 7, alignItems: 'center', justifyContent: 'center' }, outlineText: { color: colors.primarySoft, fontWeight: '700' },
  comment: { backgroundColor: colors.surface, borderRadius: 7, padding: 10, marginBottom: 7 }, commentHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 }, commentAuthor: { color: colors.secondary, fontSize: 11, fontWeight: '700', flex: 1 }, commentDate: { color: colors.subtle, fontSize: 10 }, commentForm: { marginTop: 8 }, commentInput: { minHeight: 70, backgroundColor: colors.input, borderRadius: 7, padding: 10, color: colors.text, textAlignVertical: 'top' }, linkInput: { height: 42, backgroundColor: colors.input, borderRadius: 7, paddingHorizontal: 10, color: colors.text, marginTop: 7 }, link: { color: colors.info, textDecorationLine: 'underline' }, send: { height: 40, backgroundColor: colors.primary, borderRadius: 7, alignItems: 'center', justifyContent: 'center', marginTop: 7 }, sendText: { color: colors.onPrimary, fontWeight: '700' },
  checkRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 5, borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 6 }, checkLabelWrap: { flex: 1 }, checkLabel: { color: colors.text, fontSize: 13, flex: 1 }, saved: { color: colors.successBright, fontSize: 10, marginTop: 3 }, checkbox: { width: 24, height: 24, borderWidth: 1, borderColor: colors.subtle, borderRadius: 5, color: colors.onPrimary, textAlign: 'center', lineHeight: 22, marginRight: 9 }, checkboxOn: { backgroundColor: colors.success, borderColor: colors.success }, fieldBlock: { paddingVertical: 7 }, fieldLine: { flexDirection: 'row', gap: 7, marginTop: 5 }, fieldInput: { flex: 1, height: 40, backgroundColor: colors.input, borderRadius: 7, color: colors.text, paddingHorizontal: 10 }, smallButton: { minWidth: 48, height: 36, backgroundColor: colors.primary, borderRadius: 6, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 7 }, smallButtonText: { color: colors.onPrimary, fontSize: 10, fontWeight: '800' },
  action: { position: 'absolute', left: 14, right: 14, bottom: 12, height: 52, backgroundColor: colors.success, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }, actionText: { color: colors.onPrimary, fontSize: 16, fontWeight: '800' }, disabled: { opacity: 0.55 }, error: { color: colors.danger, fontSize: 13, marginBottom: 8, textAlign: 'center' }, retry: { color: colors.primary, fontWeight: '700' },
});
