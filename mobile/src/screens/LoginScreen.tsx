import React, { useMemo, useState, useRef } from 'react';
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
import { getApiError } from '../api/client';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ThemeColors, useAppTheme } from '../theme/ThemeContext';

export const LoginScreen: React.FC = () => {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
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
      Alert.alert('Ошибка', getApiError(e, 'Неверный email или пароль'));
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
            <Text style={styles.title}>Абие</Text>
            
            <TextInput 
              style={styles.input} 
              placeholder="Email" 
              placeholderTextColor={colors.subtle}
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
              placeholderTextColor={colors.subtle}
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
              {loading ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.btnText}>Войти</Text>}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  keyboardView: { flex: 1 },
  scrollContainer: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  card: { backgroundColor: colors.surface, borderRadius: 8, padding: 24, borderWidth: 1, borderColor: colors.border },
  title: { fontSize: 28, fontWeight: '800', color: colors.text, textAlign: 'center', marginBottom: 32 },
  input: { backgroundColor: colors.input, borderRadius: 8, padding: 14, fontSize: 16, color: colors.text, marginBottom: 12, borderWidth: 1, borderColor: colors.border },
  button: { backgroundColor: colors.primary, borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 8 },
  buttonDisabled: { opacity: 0.7 },
  btnText: { color: colors.onPrimary, fontSize: 16, fontWeight: '700' },
});
