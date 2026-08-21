import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { api, getApiError } from '../api/client';
import { uploadTicketPhoto } from '../api/uploads';
import { AttachmentResponse, ChecklistResponse, TicketResponse } from '../api/types';
import { ThemeColors, useAppTheme } from '../theme/ThemeContext';

interface Props {
  ticket: TicketResponse;
  onBack: () => void;
  onSubmitted: () => void;
}

export const CompleteTicketScreen: React.FC<Props> = ({ ticket, onBack, onSubmitted }) => {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [comment, setComment] = useState('');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [checklists, setChecklists] = useState<ChecklistResponse[]>([]);
  const [attachments, setAttachments] = useState<AttachmentResponse[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get<ChecklistResponse[]>(`/tickets/${ticket.id}/checklists`),
      api.get<AttachmentResponse[]>('/attachments', { params: { ticket_id: ticket.id } }),
    ]).then(([checklistResult, attachmentResult]) => {
      setChecklists(checklistResult.data);
      setAttachments(attachmentResult.data);
    }).catch((e) => Alert.alert('Не удалось проверить заявку', getApiError(e))).finally(() => setLoadingData(false));
  }, [ticket.id]);

  const pickImage = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Нет доступа', 'Разрешите приложению использовать камеру');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.75 });
    if (!result.canceled && result.assets[0]) setImageUri(result.assets[0].uri);
  };

  const getChecklistProblem = () => {
    const missing = checklists.flatMap((checklist) => checklist.fields.filter((field) => {
      if (!field.is_mandatory || field.field_type === 'photo') return false;
      const value = (field.value || '').trim().toLowerCase();
      return !value || ['false', 'нет', '0', '-'].includes(value);
    }).map((field) => field.label));
    if (missing.length) return `Заполните обязательные поля: ${missing.join(', ')}`;
    const requiredPhotos = checklists.flatMap((checklist) => checklist.fields).filter((field) => field.is_mandatory && field.field_type === 'photo').length;
    const availablePhotos = attachments.filter((attachment) => attachment.content_type.startsWith('image/')).length + (imageUri ? 1 : 0);
    if (availablePhotos < requiredPhotos) return `Не хватает обязательных фотографий: ${requiredPhotos - availablePhotos}`;
    return '';
  };

  const submit = async () => {
    if (submitting) return;
    const checklistProblem = getChecklistProblem();
    if (checklistProblem) {
      Alert.alert('Заявку нельзя завершить', checklistProblem);
      return;
    }
    setSubmitting(true);
    try {
      if (imageUri) await uploadTicketPhoto(ticket.id, imageUri);
      await api.post(`/tickets/${ticket.id}/complete`, { comment: comment.trim() });
      onSubmitted();
    } catch (e) {
      Alert.alert('Заявка не завершена', getApiError(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}><TouchableOpacity onPress={onBack} disabled={submitting}><Text style={styles.back}>Назад</Text></TouchableOpacity><Text style={styles.headerTitle}>Завершение</Text><View style={styles.spacer} /></View>
      {loadingData ? <ActivityIndicator color={colors.primary} size="large" style={styles.loader} /> : (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.number}>Заявка #{ticket.number}</Text>
          <Text style={styles.subject}>{ticket.subject}</Text>
          <Text style={styles.label}>Отчет о выполненной работе</Text>
          <TextInput style={styles.textarea} value={comment} onChangeText={setComment} placeholder="Что выполнено" placeholderTextColor={colors.subtle} multiline editable={!submitting} />
          <Text style={styles.label}>Фотография</Text>
          <TouchableOpacity style={styles.photoButton} onPress={pickImage} disabled={submitting}><Text style={styles.photoText}>{imageUri ? 'Переснять' : 'Сделать фото'}</Text></TouchableOpacity>
          {imageUri && <Image source={{ uri: imageUri }} style={styles.preview} />}
          <TouchableOpacity style={[styles.submit, submitting && styles.disabled]} onPress={submit} disabled={submitting}>
            {submitting ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.submitText}>Завершить заявку</Text>}
          </TouchableOpacity>
        </ScrollView>
      )}
    </SafeAreaView>
  );
};

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background }, header: { height: 52, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.border }, back: { color: colors.primary, width: 70, fontWeight: '700' }, headerTitle: { flex: 1, color: colors.text, fontSize: 17, fontWeight: '800', textAlign: 'center' }, spacer: { width: 70 }, loader: { marginTop: 44 },
  content: { padding: 14, paddingBottom: 32 }, number: { color: colors.subtle, fontSize: 12, fontWeight: '700' }, subject: { color: colors.text, fontSize: 21, fontWeight: '800', lineHeight: 27, marginTop: 4, marginBottom: 22 }, label: { color: colors.muted, fontSize: 12, fontWeight: '800', marginBottom: 6, marginTop: 12 }, textarea: { minHeight: 120, backgroundColor: colors.input, borderRadius: 8, padding: 12, color: colors.text, textAlignVertical: 'top', borderWidth: 1, borderColor: colors.border },
  photoButton: { height: 46, backgroundColor: colors.surface, borderRadius: 8, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.primary }, photoText: { color: colors.primarySoft, fontWeight: '700' }, preview: { width: '100%', height: 220, borderRadius: 8, marginTop: 9 }, submit: { height: 52, backgroundColor: colors.success, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginTop: 24 }, submitText: { color: colors.onPrimary, fontSize: 16, fontWeight: '800' }, disabled: { opacity: 0.55 },
});
