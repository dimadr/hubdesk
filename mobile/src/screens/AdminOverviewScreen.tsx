import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { api, getApiError } from '../api/client';
import { UserListItem } from '../api/types';
import { ThemeColors, useAppTheme } from '../theme/ThemeContext';

interface Stats {
  total_users: number;
  total_customers: number;
  total_locations: number;
  total_warehouses: number;
  total_tickets: number;
  open_tickets: number;
  overdue_tickets: number;
  completed_tickets: number;
  user_breakdown: { role: string; count: number }[];
}

interface CustomerRow { id: number; name: string; }

const ROLE_LABELS: Record<string, string> = {
  admin: 'Администратор', director: 'Директор', dispatcher: 'Диспетчер', engineer: 'Инженер',
  customer: 'Заказчик', storekeeper: 'Кладовщик', viewer: 'Наблюдатель', metrologist: 'Метролог', accountant: 'Бухгалтер',
};

export const AdminOverviewScreen: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserListItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const [statsResponse, usersResponse, customersResponse] = await Promise.all([
        api.get<Stats>('/admin/stats'),
        api.get<UserListItem[]>('/users/list'),
        api.get<CustomerRow[]>('/admin/customers'),
      ]);
      setStats(statsResponse.data);
      setUsers(usersResponse.data);
      setCustomers(customersResponse.data);
    } catch (e) {
      setError(getApiError(e, 'Не удалось загрузить админку'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}><TouchableOpacity onPress={onBack}><Text style={styles.back}>Назад</Text></TouchableOpacity><Text style={styles.headerTitle}>Админка</Text><View style={styles.spacer} /></View>
      {loading ? <ActivityIndicator color={colors.primary} size="large" style={styles.loader} /> : (
        <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} colors={[colors.primary]} tintColor={colors.primary} />}>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {stats && (
            <>
              <View style={styles.kpiGrid}>
                <Kpi label="Пользователей" value={stats.total_users} styles={styles} />
                <Kpi label="Клиентов" value={stats.total_customers} styles={styles} />
                <Kpi label="Объектов" value={stats.total_locations} styles={styles} />
                <Kpi label="Заявок" value={stats.total_tickets} styles={styles} />
                <Kpi label="Открыто" value={stats.open_tickets} styles={styles} />
                <Kpi label="Просрочено" value={stats.overdue_tickets} danger styles={styles} />
              </View>
              <Text style={styles.sectionTitle}>Пользователи по ролям</Text>
              {stats.user_breakdown.map((item) => <View key={item.role} style={styles.summaryRow}><Text style={styles.summaryLabel}>{ROLE_LABELS[item.role] || item.role}</Text><Text style={styles.summaryValue}>{item.count}</Text></View>)}
            </>
          )}
          <Text style={styles.sectionTitle}>Пользователи</Text>
          {users.map((user) => (
            <TouchableOpacity key={user.id} style={styles.userCard} onPress={() => setSelectedUser(user)} activeOpacity={0.75}>
              <Text style={styles.userName}>{user.name} {user.patronymic || ''}</Text>
              <Text style={styles.userMeta}>{ROLE_LABELS[user.role] || user.role}{user.status ? ` · ${user.status}` : ''}</Text>
              <Text style={styles.userMeta}>{user.email}{user.phone ? ` · ${user.phone}` : ''}</Text>
              <Text style={styles.editHint}>Изменить</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
      <UserEditModal
        user={selectedUser}
        customers={customers}
        onClose={() => setSelectedUser(null)}
        onSaved={() => { setSelectedUser(null); load(); }}
      />
    </SafeAreaView>
  );
};

const Kpi = ({ label, value, danger, styles }: { label: string; value: number; danger?: boolean; styles: ReturnType<typeof createStyles> }) => (
  <View style={styles.kpi}><Text style={styles.kpiLabel}>{label}</Text><Text style={[styles.kpiValue, danger && styles.danger]}>{value}</Text></View>
);

const UserEditModal = ({ user, customers, onClose, onSaved }: { user: UserListItem | null; customers: CustomerRow[]; onClose: () => void; onSaved: () => void }) => {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [name, setName] = useState('');
  const [patronymic, setPatronymic] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState('');
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) return;
    setName(user.name || '');
    setPatronymic(user.patronymic || '');
    setEmail(user.email || '');
    setPhone(user.phone || '');
    setRole(user.role);
    setCustomerId(user.customer_id);
    setPassword('');
    setError('');
  }, [user]);

  const save = async () => {
    if (!user) return;
    if (!name.trim() || !email.trim()) { setError('Имя и email обязательны'); return; }
    if (password && password.length < 12) { setError('Пароль должен быть не менее 12 символов'); return; }
    const payload: Record<string, unknown> = {};
    if (name.trim() !== user.name) payload.name = name.trim();
    if (patronymic.trim() !== (user.patronymic || '')) payload.patronymic = patronymic.trim();
    if (email.trim() !== user.email) payload.email = email.trim();
    if (phone.trim() !== (user.phone || '')) payload.phone = phone.trim();
    if (role !== user.role) payload.role = role;
    const nextCustomerId = role === 'customer' ? customerId : null;
    if ((nextCustomerId || 0) !== (user.customer_id || 0)) payload.customer_id = nextCustomerId || 0;
    if (password) payload.password = password;
    if (!Object.keys(payload).length) { onClose(); return; }
    setSaving(true);
    setError('');
    try {
      await api.patch(`/admin/users/${user.id}`, payload);
      onSaved();
    } catch (e) {
      setError(getApiError(e, 'Не удалось сохранить пользователя'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={Boolean(user)} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container}>
        <View style={styles.header}><TouchableOpacity onPress={onClose} disabled={saving}><Text style={styles.back}>Назад</Text></TouchableOpacity><Text style={styles.headerTitle}>Пользователь</Text><View style={styles.spacer} /></View>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
            <EditField label="Имя" value={name} onChangeText={setName} styles={styles} />
            <EditField label="Отчество" value={patronymic} onChangeText={setPatronymic} styles={styles} />
            <EditField label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" styles={styles} />
            <EditField label="Телефон" value={phone} onChangeText={setPhone} keyboardType="phone-pad" styles={styles} />
            <Text style={styles.label}>Роль</Text>
            <View style={styles.choices}>{Object.entries(ROLE_LABELS).map(([value, label]) => <Choice key={value} label={label} active={role === value} onPress={() => setRole(value)} styles={styles} />)}</View>
            {role === 'customer' ? <><Text style={styles.label}>Заказчик</Text><View style={styles.choiceList}><Choice label="Не привязан" active={!customerId} onPress={() => setCustomerId(null)} styles={styles} />{customers.map((customer) => <Choice key={customer.id} label={customer.name} active={customerId === customer.id} onPress={() => setCustomerId(customer.id)} styles={styles} />)}</View></> : null}
            <EditField label="Новый пароль" value={password} onChangeText={setPassword} secureTextEntry placeholder="Оставьте пустым, чтобы не менять" styles={styles} />
            {error ? <Text style={styles.formError}>{error}</Text> : null}
            <TouchableOpacity style={[styles.saveButton, saving && styles.disabled]} onPress={save} disabled={saving}>{saving ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.saveText}>Сохранить</Text>}</TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
};

const EditField = ({ label, styles, ...props }: any) => <View><Text style={styles.label}>{label}</Text><TextInput {...props} style={styles.input} placeholderTextColor={styles.placeholder.color} /></View>;
const Choice = ({ label, active, onPress, styles }: { label: string; active: boolean; onPress: () => void; styles: ReturnType<typeof createStyles> }) => <TouchableOpacity style={[styles.choice, active && styles.choiceActive]} onPress={onPress}><Text style={[styles.choiceText, active && styles.choiceTextActive]}>{label}</Text></TouchableOpacity>;

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background }, flex: { flex: 1 },
  header: { height: 52, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.border },
  back: { color: colors.primary, width: 70, fontWeight: '700' },
  headerTitle: { flex: 1, color: colors.text, fontSize: 17, fontWeight: '800', textAlign: 'center' },
  spacer: { width: 70 }, loader: { marginTop: 44 },
  content: { padding: 14, paddingBottom: 32 }, error: { color: colors.danger, textAlign: 'center', marginBottom: 12 },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  kpi: { width: '48%', minHeight: 78, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 12 },
  kpiLabel: { color: colors.muted, fontSize: 11, fontWeight: '700' }, kpiValue: { color: colors.text, fontSize: 25, fontWeight: '800', marginTop: 7 }, danger: { color: colors.danger },
  sectionTitle: { color: colors.subtle, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', marginTop: 20, marginBottom: 8 },
  summaryRow: { minHeight: 38, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.border },
  summaryLabel: { flex: 1, color: colors.secondary, fontSize: 13 }, summaryValue: { color: colors.text, fontWeight: '800' },
  userCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 12, marginBottom: 7 },
  userName: { color: colors.text, fontSize: 14, fontWeight: '700' }, userMeta: { color: colors.muted, fontSize: 11, marginTop: 4 }, editHint: { color: colors.primary, fontSize: 11, fontWeight: '700', marginTop: 8 },
  form: { padding: 14, paddingBottom: 36, gap: 14 }, label: { color: colors.muted, fontSize: 12, fontWeight: '700', marginBottom: 6 },
  input: { minHeight: 44, color: colors.text, backgroundColor: colors.input, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12 }, placeholder: { color: colors.subtle },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, choiceList: { gap: 7 }, choice: { minHeight: 38, justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 7, paddingHorizontal: 11, paddingVertical: 7 }, choiceActive: { backgroundColor: colors.primary, borderColor: colors.primary }, choiceText: { color: colors.secondary, fontSize: 12, fontWeight: '700' }, choiceTextActive: { color: colors.onPrimary },
  formError: { color: colors.danger, fontSize: 13 }, saveButton: { height: 50, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.success, borderRadius: 8 }, saveText: { color: colors.onPrimary, fontWeight: '800' }, disabled: { opacity: 0.55 },
});
