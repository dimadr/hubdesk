import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { useAuthStore } from './src/store/authStore';
import { initApi, hasSavedUrl } from './src/api/client';
import { ServerSetupScreen } from './src/screens/ServerSetupScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { TicketsScreen } from './src/screens/TicketsScreen';
import { TicketDetailScreen } from './src/screens/TicketDetailScreen';
import { CompleteTicketScreen } from './src/screens/CompleteTicketScreen';
import { KanbanScreen } from './src/screens/KanbanScreen';
import { WarehouseScreen } from './src/screens/WarehouseScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function LocationsPlaceholder() {
  return (
    <View style={{ flex: 1, backgroundColor: '#080a12', justifyContent: 'center', alignItems: 'center' }}>
      <Text style={{ color: '#5f6690', fontSize: 14 }}>Объекты — скоро</Text>
    </View>
  );
}

function MainTabs({ navigation }: any) {
  return (
    <Tab.Navigator screenOptions={{
      headerShown: false,
      tabBarStyle: { backgroundColor: '#111527', borderTopColor: 'rgba(255,255,255,.07)', paddingBottom: 4, height: 56 },
      tabBarActiveTintColor: '#8b5cf6',
      tabBarInactiveTintColor: '#5f6690',
      tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
    }}>
      <Tab.Screen name="TicketsTab" options={{ tabBarLabel: 'Заявки', tabBarIcon: ({ color }) => <Text style={{ fontSize: 18, color }}>🎫</Text> }}>
        {() => <TicketsScreen onOpen={(ticket) => navigation.navigate('TicketDetail', { ticket })} />}
      </Tab.Screen>
      <Tab.Screen name="Kanban" component={KanbanScreen} options={{ tabBarLabel: 'Доска', tabBarIcon: ({ color }) => <Text style={{ fontSize: 18, color }}>📋</Text> }} />
      <Tab.Screen name="Locations" component={LocationsPlaceholder} options={{ tabBarLabel: 'Объекты', tabBarIcon: ({ color }) => <Text style={{ fontSize: 18, color }}>🏢</Text> }} />
      <Tab.Screen name="Warehouse" component={WarehouseScreen} options={{ tabBarLabel: 'Склад', tabBarIcon: ({ color }) => <Text style={{ fontSize: 18, color }}>📦</Text> }} />
    </Tab.Navigator>
  );
}

export default function App() {
  const [isReady, setIsReady] = useState(false);
  const [isConfigured, setIsConfigured] = useState(false);
  const { token, restoreSession } = useAuthStore();

  useEffect(() => {
    (async () => {
      try {
        await initApi();
        const configured = await hasSavedUrl();
        setIsConfigured(configured);
        if (configured) {
          await restoreSession();
        }
      } catch (e) {
        console.error("Initialization error:", e);
      } finally {
        setIsReady(true);
      }
    })();
  }, []);

  if (!isReady) {
    return (
      <SafeAreaProvider>
        <View style={{ flex: 1, backgroundColor: '#080a12', justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color="#8b5cf6" />
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          {!isConfigured && (
            <Stack.Screen name="ServerSetup">
              {() => <ServerSetupScreen onDone={() => setIsConfigured(true)} />}
            </Stack.Screen>
          )}
          {!token ? (
            <Stack.Screen name="Login" component={LoginScreen} />
          ) : (
            <>
              <Stack.Screen name="HomeTabs" component={MainTabs} />
              <Stack.Screen name="TicketDetail">
                {({ route, navigation }: any) => (
                  <TicketDetailScreen
                    ticket={route.params.ticket}
                    onBack={() => navigation.goBack()}
                    onStatusChange={() => {}}
                    onComplete={(t) => navigation.navigate('CompleteTicket', { ticket: t })}
                  />
                )}
              </Stack.Screen>
              <Stack.Screen name="CompleteTicket">
                {({ route, navigation }: any) => (
                  <CompleteTicketScreen
                    ticket={route.params.ticket}
                    onBack={() => navigation.goBack()}
                    onSubmitted={() => navigation.navigate('HomeTabs')}
                  />
                )}
              </Stack.Screen>
            </>
          )}
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
