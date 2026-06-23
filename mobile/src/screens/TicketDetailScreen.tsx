import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../api/client';
import { TicketResponse, STATUS_LABELS, PRIORITY_LABELS, TYPE_LABELS, NEXT_STATUS, BTN_LABELS } from '../api/types';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface Props {
  ticket: TicketResponse;
  onBack: () => void;
  onStatusChange: () => void;
  onComplete: (ticket: TicketResponse) => void;
}

export const TicketDetailScreen: React.FC<Props> = ({ ticket, onBack, onStatusChange, onComplete }) => {
  const [userId, setUserId] = useState<number>(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let isMounted = true;
    AsyncStorage.getItem('user').then((u) => {
      if (u && isMounted) {
        try {
          setUserId(JSON.parse(u).user_id || 0);
        } catch {
          setUserId(0);
        }
      }
    });
    return () => { isMounted = false; };
  }, []);

  const isAssignee = userId === ticket.assignee_id;
  const next = NEXT_STATUS[ticket.status];
  const canAct = ticket.status !== 'COMPLETED' && next && (isAssignee || ticket.status === 'REVIEW');

  const handleStatus = async () => {
    if (!next) return;
    
    if (next === 'COMPLETED') { 
      onComplete(ticket); 
      return; 
    }

    setLoading(true);
    try {
      await api.patch(`/tickets/${ticket.id}/status`, { status: next });
      onStatusChange();
    } catch (e: any) {
      console.error(e);
      Alert.alert('Ошибка', e.response?.data?.detail || 'Не удалось сменить статус');
    } finally {
      setLoading(false);
    }
  };

  const fmtDate = (d: string | null) => {
    if (!d) return '—';
    const date = new Date(d);
    if (isNaN(date.getTime())) {
      return d.replace('T', ' ').substring(0, 16); 
    }
    return date.toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  const isOverdue = ticket.resolution_deadline ? new Date(ticket.resolution_deadline) < new Date() : false;

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity onPress={onBack} style={styles.back} disabled={loading}>
        <Text style={[styles.backText, loading && { opacity: 0.5 }]}>← Назад</Text>
      </TouchableOpacity>
      
      <ScrollView showsVerticalScrollIndicator={false}>
        <Text style={styles.number}>#{ticket.number}</Text>
        <Text style={styles.subject}>{ticket.subject}</Text>

        <View style={styles.row}>
          <Text style={styles.label}>Статус</Text>
          <Text style={styles.value}>{STATUS_LABELS[ticket.status] || ticket.status}</Text>
        </View>
        
        <View style={styles.row}>
          <Text style={styles.label}>Приоритет</Text>
          <Text style={[styles.value, { color: ticket.priority === 'critical' ? '#f87171' : ticket.priority === 'high' ? '#fbbf24' : '#eaf0ff' }]}>
            {PRIORITY_LABELS[ticket.priority] || ticket.priority}
          </Text>
        </View>
        
        {ticket.type && (
          <View style={styles.row}>
            <Text style={styles.label}>Тип</Text>
            <Text style={styles.value}>{TYPE_LABELS[ticket.type] || ticket.type}</Text>
          </View>
        )}
        
        <View style={styles.divider} />
        
        <View style={styles.row}>
          <Text style={styles.label}>Создана</Text>
          <Text style={styles.value}>{fmtDate(ticket.created_at)}</Text>
        </View>
        
        {ticket.resolution_deadline && (
          <View style={styles.row}>
            <Text style={styles.label}>Срок</Text>
            <Text style={[styles.value, { color: isOverdue ? '#f87171' : '#eaf0ff' }]}>
              {fmtDate(ticket.resolution_deadline)}
            </Text>
          </View>
        )}
        
        {ticket.scheduled_end && (
          <View style={styles.row}>
            <Text style={styles.label}>Выезд до</Text>
            <Text style={styles.value}>{fmtDate(ticket.scheduled_end)}</Text>
          </View>
        )}
        
        <View style={styles.divider} />
        
        {ticket.site_contact_name && (
          <View style={styles.row}>
            <Text style={styles.label}>Контакты</Text>
            <Text style={styles.value}>
              {ticket.site_contact_name}{ticket.site_contact_phone ? `,\n${ticket.site_contact_phone}` : ''}
            </Text>
          </View>
        )}
        
        {ticket.source_description && (
          <View style={styles.row}>
            <Text style={styles.label}>Источник</Text>
            <Text style={styles.value}>{ticket.source_description}</Text>
          </View>
        )}

        <View style={styles.divider} />
        
        <Text style={styles.sectionTitle}>Описание</Text>
        <Text style={styles.body} selectable={true}>
          {ticket.body || '—'}
        </Text>
      </ScrollView>

      {canAct && (
        <TouchableOpacity 
          style={[styles.actionBtn, loading && { opacity: 0.7 }]} 
          onPress={handleStatus} 
          disabled={loading}
        >
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.actionText}>→ {BTN_LABELS[next] || next}</Text>}
        </TouchableOpacity>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080a12', paddingHorizontal: 14 },
  back: { marginTop: 10, marginBottom: 6, paddingVertical: 4 }, 
  backText: { color: '#8b5cf6', fontSize: 15, fontWeight: '600' },
  number: { fontSize: 12, color: '#5f6690', fontWeight: '700', marginBottom: 2 },
  subject: { fontSize: 22, fontWeight: '700', color: '#eaf0ff', marginBottom: 16 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 8 },
  label: { fontSize: 13, color: '#9097b8', marginRight: 10 }, 
  value: { fontSize: 14, color: '#eaf0ff', flex: 1, textAlign: 'right' },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,.06)', marginVertical: 10 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: '#9097b8', marginBottom: 6 },
  body: { fontSize: 14, color: '#eaf0ff', lineHeight: 22, marginBottom: 30 },
  actionBtn: { backgroundColor: '#34d399', borderRadius: 12, padding: 16, alignItems: 'center', marginBottom: 20, marginTop: 8 },
  actionText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
