import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DarkTheme, DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { hasSavedUrl, initApi } from './src/api/client';
import { TicketResponse } from './src/api/types';
import { useAuthStore } from './src/store/authStore';
import { AdminOverviewScreen } from './src/screens/AdminOverviewScreen';
import { CompleteTicketScreen } from './src/screens/CompleteTicketScreen';
import { DeviceSessionsScreen } from './src/screens/DeviceSessionsScreen';
import { KanbanScreen } from './src/screens/KanbanScreen';
import { LockScreen } from './src/screens/LockScreen';
import { LocationsScreen } from './src/screens/LocationsScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { MoreScreen } from './src/screens/MoreScreen';
import { ReportsScreen } from './src/screens/ReportsScreen';
import { SecuritySetupScreen } from './src/screens/SecuritySetupScreen';
import { ServerSetupScreen } from './src/screens/ServerSetupScreen';
import { TicketDetailScreen } from './src/screens/TicketDetailScreen';
import { TicketFormScreen } from './src/screens/TicketFormScreen';
import { TicketsScreen } from './src/screens/TicketsScreen';
import { ThemeProvider, useAppTheme } from './src/theme/ThemeContext';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function MainTabs({ navigation }: any) {
  const user = useAuthStore((state) => state.user)!;
  const { colors } = useAppTheme();
  const openTicket = (ticket: TicketResponse) => navigation.navigate('TicketDetail', { ticketId: ticket.id });

  return (
    <Tab.Navigator screenOptions={{
      headerShown: false,
      tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border, height: 58, paddingBottom: 5 },
      tabBarActiveTintColor: colors.primary,
      tabBarInactiveTintColor: colors.subtle,
      tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
    }}>
      <Tab.Screen name="TicketsTab" options={{ tabBarLabel: 'Заявки', tabBarIcon: ({ color }) => <Text style={{ fontSize: 18, color }}>▤</Text> }}>
        {() => <TicketsScreen user={user} onOpen={openTicket} onCreate={() => navigation.navigate('TicketForm')} onSettings={() => navigation.navigate('ServerSettings')} />}
      </Tab.Screen>
      <Tab.Screen name="KanbanTab" options={{ tabBarLabel: 'Моя доска', tabBarIcon: ({ color }) => <Text style={{ fontSize: 18, color }}>▦</Text> }}>
        {() => <KanbanScreen user={user} onOpen={openTicket} />}
      </Tab.Screen>
      <Tab.Screen name="MoreTab" options={{ tabBarLabel: 'Ещё', tabBarIcon: ({ color }) => <Text style={{ fontSize: 19, color }}>•••</Text> }}>
        {() => <MoreScreen user={user} onAdmin={() => navigation.navigate('AdminOverview')} onLocations={() => navigation.navigate('Locations')} onReports={() => navigation.navigate('Reports')} onDeviceSessions={() => navigation.navigate('DeviceSessions')} onServerSettings={() => navigation.navigate('ServerSettings')} />}
      </Tab.Screen>
    </Tab.Navigator>
  );
}

function AppContent() {
  const [ready, setReady] = useState(false);
  const [configured, setConfigured] = useState(false);
  const { user, phase, quickUnlockEnabled, lockTimeoutSeconds, restoreSession, lock, logout } = useAuthStore();
  const { colors, mode } = useAppTheme();
  const backgroundAt = useRef<number | null>(null);
  const navigationTheme = useMemo(() => ({
    ...(mode === 'dark' ? DarkTheme : DefaultTheme),
    colors: {
      ...(mode === 'dark' ? DarkTheme.colors : DefaultTheme.colors),
      primary: colors.primary,
      background: colors.background,
      card: colors.surface,
      text: colors.text,
      border: colors.border,
      notification: colors.danger,
    },
  }), [colors, mode]);

  useEffect(() => {
    (async () => {
      try {
        await initApi();
        const hasServer = await hasSavedUrl();
        setConfigured(hasServer);
        if (hasServer) await restoreSession();
      } finally {
        setReady(true);
      }
    })();
  }, [restoreSession]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (!quickUnlockEnabled || phase !== 'unlocked') return;
      if (nextState === 'background') {
        backgroundAt.current = Date.now();
        if (lockTimeoutSeconds === 0) lock();
        return;
      }
      if (nextState === 'active' && backgroundAt.current !== null) {
        const elapsedSeconds = (Date.now() - backgroundAt.current) / 1000;
        backgroundAt.current = null;
        if (elapsedSeconds >= lockTimeoutSeconds) lock();
      }
    });
    return () => subscription.remove();
  }, [lock, lockTimeoutSeconds, phase, quickUnlockEnabled]);

  if (!ready) return <View style={{ flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={colors.primary} size="large" /></View>;

  return (
    <>
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      <NavigationContainer theme={navigationTheme}>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          {!configured ? (
            <Stack.Screen name="ServerSetup">{() => <ServerSetupScreen onDone={() => setConfigured(true)} />}</Stack.Screen>
          ) : phase === 'signed_out' || !user ? (
            <Stack.Screen name="Login" component={LoginScreen} />
          ) : phase === 'security_setup' ? (
            <Stack.Screen name="SecuritySetup" component={SecuritySetupScreen} />
          ) : phase === 'locked' ? (
            <Stack.Screen name="Lock" component={LockScreen} />
          ) : (
            <>
              <Stack.Screen name="HomeTabs" component={MainTabs} />
              <Stack.Screen name="TicketDetail">
                {({ route, navigation }: any) => <TicketDetailScreen ticketId={route.params.ticketId} user={user} onBack={() => navigation.goBack()} onEdit={(ticket) => navigation.navigate('TicketForm', { ticket })} onComplete={(ticket) => navigation.navigate('CompleteTicket', { ticket })} />}
              </Stack.Screen>
              <Stack.Screen name="TicketForm">
                {({ route, navigation }: any) => <TicketFormScreen ticket={route.params?.ticket} user={user} onBack={() => navigation.goBack()} onSaved={(ticket) => route.params?.ticket ? navigation.goBack() : navigation.replace('TicketDetail', { ticketId: ticket.id })} />}
              </Stack.Screen>
              <Stack.Screen name="CompleteTicket">
                {({ route, navigation }: any) => <CompleteTicketScreen ticket={route.params.ticket} onBack={() => navigation.goBack()} onSubmitted={() => navigation.popToTop()} />}
              </Stack.Screen>
              <Stack.Screen name="AdminOverview">{({ navigation }: any) => <AdminOverviewScreen onBack={() => navigation.goBack()} />}</Stack.Screen>
              <Stack.Screen name="Locations">{({ navigation }: any) => <LocationsScreen onBack={() => navigation.goBack()} onOpenTicket={(ticket) => navigation.navigate('TicketDetail', { ticketId: ticket.id })} />}</Stack.Screen>
              <Stack.Screen name="Reports">{({ navigation }: any) => <ReportsScreen onBack={() => navigation.goBack()} />}</Stack.Screen>
              <Stack.Screen name="DeviceSessions">{({ navigation }: any) => <DeviceSessionsScreen onBack={() => navigation.goBack()} />}</Stack.Screen>
              <Stack.Screen name="ServerSettings">{({ navigation }: any) => <ServerSetupScreen onCancel={() => navigation.goBack()} onBeforeSave={logout} onDone={() => {}} onLogout={logout} />}</Stack.Screen>
            </>
          )}
        </Stack.Navigator>
      </NavigationContainer>
    </>
  );
}

export default function App() {
  return <SafeAreaProvider><ThemeProvider><AppContent /></ThemeProvider></SafeAreaProvider>;
}
