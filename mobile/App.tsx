import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useAuthStore } from './src/store/authStore';
import { initApi, hasSavedUrl } from './src/api/client';
import { ServerSetupScreen } from './src/screens/ServerSetupScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { TicketsScreen } from './src/screens/TicketsScreen';
import { TicketDetailScreen } from './src/screens/TicketDetailScreen';
import { CompleteTicketScreen } from './src/screens/CompleteTicketScreen';
import { TicketResponse } from './src/api/types';

type Page = 'setup' | 'login' | 'tickets' | 'detail' | 'complete';

export default function App() {
  const [isReady, setIsReady] = useState(false);
  const [page, setPage] = useState<Page>('login');
  const [selectedTicket, setSelectedTicket] = useState<TicketResponse | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const { token, restoreSession } = useAuthStore();

  useEffect(() => {
    (async () => {
      await initApi();
      const configured = await hasSavedUrl();
      if (!configured) {
        setPage('setup');
        setIsReady(true);
        return;
      }
      await restoreSession();
      setIsReady(true);
    })();
  }, []);

  useEffect(() => {
    if (!isReady) return;
    if (page === 'setup') return;
    setPage(token ? 'tickets' : 'login');
  }, [token, isReady]);

  if (!isReady) {
    return (
      <SafeAreaProvider>
        <View style={{ flex: 1, backgroundColor: '#080a12', justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color="#8b5cf6" />
        </View>
      </SafeAreaProvider>
    );
  }

  if (page === 'setup') return <SafeAreaProvider><ServerSetupScreen onDone={() => setPage('login')} /></SafeAreaProvider>;
  if (!token) return <SafeAreaProvider><LoginScreen /></SafeAreaProvider>;

  const openDetail = (t: TicketResponse) => { setSelectedTicket(t); setPage('detail'); };
  const openComplete = (t: TicketResponse) => { setSelectedTicket(t); setPage('complete'); };
  const backToTickets = () => { setPage('tickets'); setRefreshKey((k) => k + 1); };

  return (
    <SafeAreaProvider>
      {page === 'tickets' && <TicketsScreen key={refreshKey} onOpen={openDetail} />}
      {page === 'detail' && selectedTicket && (
        <TicketDetailScreen ticket={selectedTicket} onBack={() => setPage('tickets')}
          onStatusChange={() => setRefreshKey((k) => k + 1)} onComplete={openComplete} />
      )}
      {page === 'complete' && selectedTicket && (
        <CompleteTicketScreen ticket={selectedTicket} onBack={() => setPage('detail')} onSubmitted={backToTickets} />
      )}
    </SafeAreaProvider>
  );
}
