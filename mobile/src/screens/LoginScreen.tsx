import React, { useState, useRef } from 'react';
import { 
  View, 
  Text, 
  TextInput, 
  TouchableOpacity, 
  StyleSheet, 
  Alert, 
  ActivityIndicator,
  KeyboardAvoidingView,
  ScrollView,
  Platform
} from 'react-native';
import { useAuthStore } from '../store/authStore';
import { SafeAreaView } from 'react-native-safe-area-context';

export const LoginScreen: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const login = useAuthStore((s) => s.login);

  const passwordInputRef = useRef<TextInput>(null);

  const handleLogin = async () => {
    const cleanEmail = email.trim();

    if (!cleanEmail || !password) { 
      Alert.alert('Ошибка', 'Введите email и пароль'); 
      return; 
    }
    
    setLoading(true);
    try {
      await login(cleanEmail, password);
    } catch (e: any) {
      console.error(e);
      Alert.alert('Ошибка', e.response?.data?.detail || 'Неверный email или пароль');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'android' ? 'height' : 'padding'} 
        style={styles.keyboardView}
      >
        <ScrollView 
          contentContainerStyle={styles.scrollContainer}
          keyboardShouldPersistTaps="handled" 
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.card}>
            <Text style={styles.title}>HUB Desk</Text>
            
            <TextInput 
              style={styles.input} 
              placeholder="Email" 
              placeholderTextColor="#5f6690"
              value={email} 
              onChangeText={setEmail} 
              autoCapitalize="none" 
              keyboardType="email-address"
              autoCorrect={false}
              returnKeyType="next"
              onSubmitEditing={() => passwordInputRef.current?.focus()} 
              blurOnSubmit={false}
              editable={!loading}
            />
            
            <TextInput 
              ref={passwordInputRef}
              style={styles.input} 
              placeholder="Пароль" 
              placeholderTextColor="#5f6690"
              value={password} 
              onChangeText={setPassword} 
              secureTextEntry 
              returnKeyType="done"
              onSubmitEditing={handleLogin}
              editable={!loading}
            />
            
            <TouchableOpacity 
              style={[styles.button, loading && styles.buttonDisabled]} 
              onPress={handleLogin} 
              disabled={loading}
            >
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Войти</Text>}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080a12' },
  keyboardView: { flex: 1 },
  scrollContainer: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  card: { backgroundColor: '#111527', borderRadius: 16, padding: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,.07)' },
  title: { fontSize: 28, fontWeight: '800', color: '#eaf0ff', textAlign: 'center', marginBottom: 32, letterSpacing: -0.5 },
  input: { backgroundColor: '#0d1020', borderRadius: 10, padding: 14, fontSize: 16, color: '#eaf0ff', marginBottom: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,.07)' },
  button: { backgroundColor: '#8b5cf6', borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 8 },
  buttonDisabled: { backgroundColor: '#6d28d9', opacity: 0.7 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
