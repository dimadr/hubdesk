import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getApiError } from '../api/client';
import { useAuthStore } from '../store/authStore';
import { ThemeColors, useAppTheme } from '../theme/ThemeContext';

export const SecuritySetupScreen: React.FC = () => {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const user = useAuthStore((state) => state.user);
  const enableQuickUnlock = useAuthStore((state) => state.enableQuickUnlock);
  const skipQuickUnlock = useAuthStore((state) => state.skipQuickUnlock);
  const [loading, setLoading] = useState(false);

  const enable = async () => {
    setLoading(true);
    try {
      await enableQuickUnlock();
    } catch (error) {
      Alert.alert('Не удалось включить', getApiError(error, error instanceof Error ? error.message : 'Проверьте защиту устройства'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Быстрая разблокировка</Text>
        <Text style={styles.user}>{user?.name}</Text>
        <Text style={styles.description}>Используйте отпечаток, распознавание лица или системный код устройства вместо повторного ввода пароля.</Text>
        <TouchableOpacity style={[styles.primary, loading && styles.disabled]} onPress={enable} disabled={loading}>
          {loading ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.primaryText}>Включить</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondary} onPress={skipQuickUnlock} disabled={loading}>
          <Text style={styles.secondaryText}>Не сейчас</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, justifyContent: 'center', padding: 24 },
  content: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 22 },
  title: { color: colors.text, fontSize: 22, fontWeight: '800', textAlign: 'center' },
  user: { color: colors.secondary, fontSize: 14, fontWeight: '700', textAlign: 'center', marginTop: 8 },
  description: { color: colors.muted, fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 18, marginBottom: 22 },
  primary: { height: 50, backgroundColor: colors.primary, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: colors.onPrimary, fontSize: 15, fontWeight: '800' },
  secondary: { height: 46, alignItems: 'center', justifyContent: 'center', marginTop: 5 },
  secondaryText: { color: colors.muted, fontSize: 14, fontWeight: '700' },
  disabled: { opacity: 0.6 },
});
