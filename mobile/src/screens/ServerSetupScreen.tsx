import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { saveUrl, initApi, getSavedUrl } from '../api/client';

interface Props {
  onDone: () => void;
}

export const ServerSetupScreen: React.FC<Props> = ({ onDone }) => {
  const [url, setUrl] = useState('http://192.168.0.178:8002/api');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function loadCurrentUrl() {
      try {
        const saved = await getSavedUrl();
        if (saved) setUrl(saved);
      } catch (e) {
        console.error(e);
      }
    }
    loadCurrentUrl();
  }, []);

  const testConnection = async () => {
    const cleanUrl = url.trim().replace(/\/+$/, '');
    
    if (!cleanUrl) { 
      Alert.alert('Ошибка', 'Введите адрес сервера'); 
      return; 
    }
    
    setLoading(true);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 7000);

    try {
      const resp = await fetch(`${cleanUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'test@hubdesk.local', password: 'test123' }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (resp.ok) {
        await saveUrl(cleanUrl);
        await initApi();
        Alert.alert('Готово', 'Сервер подключён');
        onDone();
      } else {
        if (resp.status === 401) {
          await saveUrl(cleanUrl);
          await initApi();
          Alert.alert('Сервер доступен', 'Введите свои данные для входа');
          onDone();
        } else {
          let detail = 'Сервер недоступен';
          try {
            const data = await resp.json();
            detail = data.detail || detail;
          } catch {}
          Alert.alert('Ошибка сервера', `Код: ${resp.status}\n${detail}`);
        }
      }
    } catch (e: any) {
      clearTimeout(timeoutId);
      console.error(e);
      
      if (e.name === 'AbortError') {
        Alert.alert('Ошибка таймаута', 'Сервер не ответил за отведенное время. Проверьте сеть или IP.');
      } else {
        Alert.alert('Ошибка подключения', 'Не удалось соединиться с сервером. Проверьте правильность адреса и Wi-Fi.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>HUB Desk</Text>
        <Text style={styles.subtitle}>Настройка подключения</Text>
        
        <TextInput 
          style={styles.input} 
          placeholder="http://192.168.0.178:8002/api"
          placeholderTextColor="#5f6690" 
          value={url} 
          onChangeText={setUrl}
          autoCapitalize="none" 
          keyboardType="url"
          autoCorrect={false}
          editable={!loading}
        />
        
        <TouchableOpacity 
          style={[styles.button, loading && styles.buttonDisabled]} 
          onPress={testConnection} 
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.btnText}>Подключиться</Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080a12', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: '#111527', borderRadius: 16, padding: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,.07)' },
  title: { fontSize: 28, fontWeight: '800', color: '#eaf0ff', textAlign: 'center', marginBottom: 6 },
  subtitle: { fontSize: 14, color: '#9097b8', textAlign: 'center', marginBottom: 24 },
  input: { backgroundColor: '#0d1020', borderRadius: 10, padding: 14, fontSize: 15, color: '#eaf0ff', marginBottom: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,.07)' },
  button: { backgroundColor: '#8b5cf6', borderRadius: 10, padding: 14, alignItems: 'center' },
  buttonDisabled: { backgroundColor: '#6d28d9', opacity: 0.7 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
