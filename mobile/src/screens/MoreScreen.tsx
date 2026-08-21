import React, { useMemo } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { UserInfo } from '../api/types';
import { ThemeColors, useAppTheme } from '../theme/ThemeContext';
import { useAuthStore } from '../store/authStore';

interface Props {
  user: UserInfo;
  onAdmin: () => void;
  onLocations: () => void;
  onReports: () => void;
  onDeviceSessions: () => void;
  onServerSettings: () => void;
}

export const MoreScreen: React.FC<Props> = ({ user, onAdmin, onLocations, onReports, onDeviceSessions, onServerSettings }) => {
  const { colors, mode, toggleMode } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { quickUnlockEnabled, lockTimeoutSeconds, setLockTimeoutSeconds, lock, logout } = useAuthStore();

  const disableQuickUnlock = () => {
    Alert.alert('Отключить быструю разблокировку?', 'Сессия этого устройства будет отозвана. Для следующего входа потребуется пароль.', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Отключить', style: 'destructive', onPress: () => { logout(); } },
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Ещё</Text>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.profile}>
          <Text style={styles.profileName}>{user.name}</Text>
          <Text style={styles.profileMeta}>{user.email}</Text>
        </View>

        <Text style={styles.sectionTitle}>Интерфейс</Text>
        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>Светлая тема</Text>
            <Text style={styles.rowMeta}>{mode === 'light' ? 'Включена' : 'Выключена'}</Text>
          </View>
          <Switch value={mode === 'light'} onValueChange={toggleMode} trackColor={{ false: colors.input, true: colors.primary }} thumbColor={colors.onPrimary} />
        </View>

        <Text style={styles.sectionTitle}>Безопасность</Text>
        <View style={styles.securityBlock}>
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>Быстрая разблокировка</Text>
            <Text style={styles.rowMeta}>{quickUnlockEnabled ? 'Включена' : 'Не включена'}</Text>
          </View>
          {quickUnlockEnabled ? <TouchableOpacity onPress={disableQuickUnlock}><Text style={styles.disableText}>Отключить</Text></TouchableOpacity> : null}
        </View>
        {quickUnlockEnabled ? (
          <>
            <Text style={styles.timeoutLabel}>Блокировать после ухода в фон</Text>
            <View style={styles.timeoutControl}>
              {([[0, 'Сразу'], [60, '1 мин'], [300, '5 мин']] as const).map(([seconds, label]) => (
                <TouchableOpacity key={seconds} style={[styles.timeoutButton, lockTimeoutSeconds === seconds && styles.timeoutActive]} onPress={() => setLockTimeoutSeconds(seconds)}>
                  <Text style={[styles.timeoutText, lockTimeoutSeconds === seconds && styles.timeoutTextActive]}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <MenuRow label="Доверенные устройства" detail="Просмотр и отзыв активных сессий" onPress={onDeviceSessions} styles={styles} />
            <MenuRow label="Заблокировать сейчас" detail="Сессия останется активной" onPress={lock} styles={styles} />
          </>
        ) : null}

        {user.role === 'admin' && (
          <>
            <Text style={styles.sectionTitle}>Управление</Text>
            <MenuRow label="Админка" detail="Сводка и пользователи" onPress={onAdmin} styles={styles} />
            <MenuRow label="Объекты" detail="Карточки и выполненные работы" onPress={onLocations} styles={styles} />
            <MenuRow label="Отчёты" detail="Заявки, объекты и инженеры" onPress={onReports} styles={styles} />
          </>
        )}

        <Text style={styles.sectionTitle}>Подключение</Text>
        <MenuRow label="Сервер и учётная запись" detail="Адрес сервера и выход" onPress={onServerSettings} styles={styles} />
      </ScrollView>
    </SafeAreaView>
  );
};

const MenuRow = ({ label, detail, onPress, styles }: { label: string; detail: string; onPress: () => void; styles: ReturnType<typeof createStyles> }) => (
  <TouchableOpacity style={styles.menuRow} onPress={onPress} activeOpacity={0.75}>
    <View style={styles.rowText}><Text style={styles.rowTitle}>{label}</Text><Text style={styles.rowMeta}>{detail}</Text></View>
    <Text style={styles.chevron}>›</Text>
  </TouchableOpacity>
);

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  title: { color: colors.text, fontSize: 25, fontWeight: '800', marginHorizontal: 14, marginTop: 10, marginBottom: 10 },
  content: { paddingHorizontal: 14, paddingBottom: 28 },
  profile: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 8, padding: 14 },
  profileName: { color: colors.text, fontSize: 17, fontWeight: '800' },
  profileMeta: { color: colors.muted, fontSize: 12, marginTop: 4 },
  sectionTitle: { color: colors.subtle, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', marginTop: 20, marginBottom: 7 },
  row: { minHeight: 58, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 8, paddingHorizontal: 13 },
  securityBlock: { minHeight: 58, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 8, paddingHorizontal: 13 },
  disableText: { color: colors.danger, fontSize: 12, fontWeight: '800', marginLeft: 12 },
  timeoutLabel: { color: colors.muted, fontSize: 11, fontWeight: '700', marginTop: 12, marginBottom: 6 },
  timeoutControl: { height: 40, flexDirection: 'row', backgroundColor: colors.input, borderRadius: 8, padding: 3, marginBottom: 8 },
  timeoutButton: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 6 },
  timeoutActive: { backgroundColor: colors.primary }, timeoutText: { color: colors.muted, fontSize: 12, fontWeight: '700' }, timeoutTextActive: { color: colors.onPrimary },
  menuRow: { minHeight: 62, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 8, paddingHorizontal: 13, marginBottom: 7 },
  rowText: { flex: 1 },
  rowTitle: { color: colors.text, fontSize: 14, fontWeight: '700' },
  rowMeta: { color: colors.muted, fontSize: 11, marginTop: 3 },
  chevron: { color: colors.subtle, fontSize: 28, marginLeft: 10 },
});
