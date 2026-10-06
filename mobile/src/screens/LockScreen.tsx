import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../store/authStore';
import { ThemeColors, useAppTheme } from '../theme/ThemeContext';

export const LockScreen: React.FC = () => {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { user, unlock, logout } = useAuthStore();
  const [loading, setLoading] = useState(false);

  const handleUnlock = async () => {
    setLoading(true);
    try {
      await unlock();
    } catch (error) {
      Alert.alert('Не удалось разблокировать', error instanceof Error ? error.message : 'Повторите попытку');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.brand}>Абие</Text>
        <Text style={styles.locked}>Приложение заблокировано</Text>
        <Text style={styles.user}>{user?.name}</Text>
        <TouchableOpacity style={[styles.primary, loading && styles.disabled]} onPress={handleUnlock} disabled={loading}>
          {loading ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.primaryText}>Разблокировать</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondary} onPress={logout} disabled={loading}>
          <Text style={styles.secondaryText}>Войти под другой учётной записью</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, justifyContent: 'center', padding: 24 },
  content: { alignItems: 'center' },
  brand: { color: colors.text, fontSize: 30, fontWeight: '800' },
  locked: { color: colors.secondary, fontSize: 17, fontWeight: '700', marginTop: 18 },
  user: { color: colors.muted, fontSize: 13, marginTop: 7, marginBottom: 28 },
  primary: { width: '100%', height: 52, backgroundColor: colors.primary, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: colors.onPrimary, fontSize: 15, fontWeight: '800' },
  secondary: { minHeight: 46, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  secondaryText: { color: colors.muted, fontSize: 13, fontWeight: '700', textAlign: 'center' },
  disabled: { opacity: 0.6 },
});
