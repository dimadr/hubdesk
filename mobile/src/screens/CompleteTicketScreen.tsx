import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Image, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../api/client';
import { TicketResponse } from '../api/types';
import * as ImagePicker from 'expo-image-picker';

interface Props {
  ticket: TicketResponse;
  onBack: () => void;
  onSubmitted: () => void;
}

export const CompleteTicketScreen: React.FC<Props> = ({ ticket, onBack, onSubmitted }) => {
  const [comment, setComment] = useState('');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const pickImage = async () => {
    if (loading) return; 

    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') { 
      Alert.alert('Доступ запрещен', 'Нет доступа к камере для создания снимка.'); 
      return; 
    }
    
    const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
    if (!result.canceled && result.assets[0]) {
      setImageUri(result.assets[0].uri);
    }
  };

  const submit = async () => {
    if (loading) return;
    setLoading(true);

    try {
      let photoUrl = '';
      
      if (imageUri) {
        const form = new FormData();
        
        const fileData = {
          uri: imageUri,
          type: 'image/jpeg',
          name: 'photo.jpg',
        };
        form.append('file', fileData as unknown as Blob);
        form.append('ticket_id', String(ticket.id));

        const resp = await api.post('/attachments', form, { 
          headers: { 'Content-Type': 'multipart/form-data' } 
        });
        photoUrl = resp.data?.file_url || '(фото)';
      }

      const fullComment = [comment, photoUrl ? `Фото: ${photoUrl}` : ''].filter(Boolean).join('\n\n');
      
      if (fullComment) {
        await api.post(`/tickets/${ticket.id}/comments`, { body: fullComment, is_internal: true });
      }

      await api.patch(`/tickets/${ticket.id}/status`, { status: 'COMPLETED' });
      onSubmitted();
    } catch (e: any) {
      console.error(e);
      Alert.alert('Ошибка', e.response?.data?.detail || 'Не удалось завершить операцию. Проверьте сеть.');
    } finally { 
      setLoading(false); 
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity 
        onPress={onBack} 
        style={[styles.back, loading && { opacity: 0.5 }]} 
        disabled={loading}
      >
        <Text style={styles.backText}>← Назад</Text>
      </TouchableOpacity>

      <Text style={styles.title}>Завершить #{ticket.number}</Text>
      <Text style={styles.subtitle}>{ticket.subject}</Text>

      <Text style={styles.label}>Комментарий</Text>
      <TextInput 
        style={styles.textarea} 
        placeholder="Что сделано..." 
        placeholderTextColor="#5f6690"
        value={comment} 
        onChangeText={setComment} 
        multiline 
        numberOfLines={5}
        editable={!loading}
      />

      <TouchableOpacity 
        style={[styles.photoBtn, loading && { opacity: 0.7 }]} 
        onPress={pickImage}
        disabled={loading}
      >
        <Text style={styles.photoBtnText}>{imageUri ? '📷 Переснять' : '📷 Сделать фото'}</Text>
      </TouchableOpacity>
      
      {imageUri && <Image source={{ uri: imageUri }} style={styles.preview} />}

      <TouchableOpacity 
        style={[styles.submitBtn, loading && styles.submitBtnDisabled]} 
        onPress={submit} 
        disabled={loading}
      >
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>✓ Завершить</Text>}
      </TouchableOpacity>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080a12', paddingHorizontal: 14 },
  back: { marginTop: 10, marginBottom: 10 }, 
  backText: { color: '#8b5cf6', fontSize: 15, fontWeight: '600' },
  title: { fontSize: 22, fontWeight: '700', color: '#eaf0ff' },
  subtitle: { fontSize: 14, color: '#9097b8', marginBottom: 20 },
  label: { fontSize: 13, fontWeight: '700', color: '#9097b8', marginBottom: 6 },
  textarea: { backgroundColor: '#0d1020', borderRadius: 10, padding: 12, fontSize: 14, color: '#eaf0ff', minHeight: 100, borderWidth: 1, borderColor: 'rgba(255,255,255,.07)', textAlignVertical: 'top' },
  photoBtn: { backgroundColor: '#111527', borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,.07)' },
  photoBtnText: { color: '#eaf0ff', fontSize: 15, fontWeight: '600' },
  preview: { width: '100%', height: 200, borderRadius: 10, marginTop: 10, backgroundColor: '#0d1020' },
  submitBtn: { backgroundColor: '#34d399', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 20 },
  submitBtnDisabled: { backgroundColor: '#10b981', opacity: 0.6 },
  submitText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
