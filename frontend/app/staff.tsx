import { useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  Vibration,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { useAudioPlayer } from 'expo-audio';
import { colors, spacing, radius, typography } from '@/src/theme';
import { api } from '@/src/api';
import type { MarinaRequest } from '@/src/api';
import { StatusBadge } from '@/src/components/StatusBadge';

const alertSound = require('@/assets/sounds/alert.wav');

export default function StaffScreen() {
  const router = useRouter();
  const [items, setItems] = useState<MarinaRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [openEmergencies, setOpenEmergencies] = useState(0);
  const prevEmgRef = useRef<number | null>(null);
  const player = useAudioPlayer(alertSound);

  const alertNewEmergency = useCallback(() => {
    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Vibration.vibrate([0, 400, 200, 400, 200, 400]);
      player.seekTo(0);
      player.play();
    } catch {}
  }, [player]);

  const load = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem('user');
      if (!raw) return router.replace('/');
      const [data, emgs] = await Promise.all([
        api.dayRequests(),
        api.listEmergencies(undefined, 'aberta').catch(() => []),
      ]);
      setItems(data);
      const count = emgs.length;
      setOpenEmergencies(count);
      if (prevEmgRef.current !== null && count > prevEmgRef.current) {
        alertNewEmergency();
      }
      prevEmgRef.current = count;
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [router, alertNewEmergency]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
      const interval = setInterval(load, 15000);
      return () => clearInterval(interval);
    }, [load])
  );

  const confirm = async (id: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const now = new Date().toISOString();
    setItems((prev) => prev.map((r) => (r.id === id ? { ...r, status: 'concluida', returned_at: now } : r)));
    try {
      await api.completeRequest(id);
    } catch {
      load();
    }
  };

  const reopen = async (id: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    setItems((prev) => prev.map((r) => (r.id === id ? { ...r, status: 'agendada', returned_at: null } : r)));
    try {
      await api.reopenRequest(id);
    } catch {
      load();
    }
  };

  const cancel = async (id: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    setItems((prev) => prev.map((r) => (r.id === id ? { ...r, status: 'cancelada' } : r)));
    try {
      await api.cancelRequest(id);
    } catch {
      load();
    }
  };

  const logout = async () => {
    await AsyncStorage.removeItem('user');
    router.replace('/');
  };

  const sorted = [...items].sort((a, b) => a.time.localeCompare(b.time));

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>FUNCIONÁRIOS</Text>
          <Text style={styles.title} testID="staff-title">Confirmar movimentações</Text>
        </View>
        <Pressable onPress={logout} hitSlop={12} testID="staff-logout" style={styles.logoutBtn}>
          <Ionicons name="log-out-outline" size={22} color={colors.onBrandPrimary} />
        </Pressable>
      </View>

      <View style={styles.sheet}>
        {openEmergencies > 0 ? (
          <Pressable
            testID="staff-emergency-banner"
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); router.push('/admin-solicitacoes'); }}
            style={({ pressed }) => [styles.emgBanner, pressed && { opacity: 0.9 }]}
          >
            <Ionicons name="alert-circle" size={24} color="#FFFFFF" />
            <View style={{ flex: 1 }}>
              <Text style={styles.emgTitle}>
                {openEmergencies === 1 ? '1 emergência aberta!' : `${openEmergencies} emergências abertas!`}
              </Text>
              <Text style={styles.emgSub}>Toque para atender agora</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#FFFFFF" />
          </Pressable>
        ) : null}
        {loading ? (
          <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
        ) : sorted.length === 0 ? (
          <View style={styles.center}>
            <View style={styles.emptyIcon}><Ionicons name="boat-outline" size={44} color={colors.brandSecondary} /></View>
            <Text style={styles.emptyTitle}>Nenhuma movimentação hoje</Text>
          </View>
        ) : (
          <FlatList
            data={sorted}
            keyExtractor={(i) => i.id}
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
            renderItem={({ item }) => (
              <View style={styles.card} testID={`staff-row-${item.id}`}>
                <View style={styles.cardMain}>
                  <View style={[styles.timeBlock, item.type === 'subida' && { backgroundColor: colors.brandSecondary }]}>
                    <Text style={styles.timeText}>{item.time}</Text>
                    <Text style={styles.timeLabel}>{item.type === 'descida' ? 'DESCIDA' : 'SUBIDA'}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.boat} numberOfLines={1}>{item.boat_name}</Text>
                    <Text style={styles.meta} numberOfLines={1}>{item.user_name}</Text>
                    <View style={{ marginTop: spacing.sm }}><StatusBadge status={item.status} /></View>
                  </View>
                </View>
                {item.status === 'agendada' ? (
                  <Pressable
                    testID={`staff-confirm-${item.id}`}
                    style={({ pressed }) => [styles.confirmBtn, pressed && { opacity: 0.85 }]}
                    onPress={() => confirm(item.id)}
                  >
                    <Ionicons name="checkmark-circle" size={18} color="#FFFFFF" />
                    <Text style={styles.confirmText}>Confirmar {item.type === 'descida' ? 'descida' : 'subida'}</Text>
                  </Pressable>
                ) : item.status === 'concluida' ? (
                  <View style={styles.correctRow}>
                    <Pressable
                      testID={`staff-reopen-${item.id}`}
                      style={({ pressed }) => [styles.correctBtn, { borderRightWidth: 1, borderRightColor: colors.border }, pressed && { opacity: 0.85 }]}
                      onPress={() => reopen(item.id)}
                    >
                      <Ionicons name="arrow-undo-outline" size={16} color={colors.info} />
                      <Text style={[styles.correctText, { color: colors.info }]}>Voltar p/ Aguardando</Text>
                    </Pressable>
                    <Pressable
                      testID={`staff-cancel-${item.id}`}
                      style={({ pressed }) => [styles.correctBtn, pressed && { opacity: 0.85 }]}
                      onPress={() => cancel(item.id)}
                    >
                      <Ionicons name="close-circle-outline" size={16} color={colors.error} />
                      <Text style={[styles.correctText, { color: colors.error }]}>Cancelar</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            )}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.brandPrimary },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.lg },
  kicker: { color: colors.brandSecondary, letterSpacing: 3, fontSize: 11, fontWeight: '700' },
  title: { color: colors.onBrandPrimary, fontSize: 24, fontWeight: '800', marginTop: 4 },
  logoutBtn: { padding: spacing.sm, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.08)' },
  sheet: { flex: 1, backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingTop: spacing.lg },
  emgBanner: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.error, marginHorizontal: spacing.lg, marginBottom: spacing.md, padding: spacing.lg, borderRadius: radius.md },
  emgTitle: { color: '#FFFFFF', fontSize: typography.lg, fontWeight: '800' },
  emgSub: { color: '#FFFFFF', opacity: 0.9, fontSize: typography.sm, marginTop: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  emptyIcon: { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg },
  emptyTitle: { color: colors.onSurface, fontSize: typography.xl, fontWeight: '700' },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.md },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  cardMain: { flexDirection: 'row', gap: spacing.md, padding: spacing.md },
  timeBlock: { backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.sm, alignItems: 'center', minWidth: 72, alignSelf: 'flex-start' },
  timeText: { color: colors.onBrandPrimary, fontSize: typography.lg, fontWeight: '800' },
  timeLabel: { color: '#FFFFFF', fontSize: 10, fontWeight: '700', letterSpacing: 1, opacity: 0.9 },
  boat: { color: colors.onSurface, fontSize: typography.lg, fontWeight: '800' },
  meta: { color: colors.onSurfaceSecondary, fontSize: typography.sm, marginTop: 2 },
  confirmBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, backgroundColor: colors.success, paddingVertical: spacing.md },
  confirmText: { color: '#FFFFFF', fontSize: typography.base, fontWeight: '700' },
  correctRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.border },
  correctBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingVertical: spacing.md },
  correctText: { fontSize: typography.sm, fontWeight: '700' },
});
