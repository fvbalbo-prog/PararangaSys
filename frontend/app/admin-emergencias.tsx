import { useCallback, useRef, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, RefreshControl, TextInput, Alert, Vibration } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAudioPlayer } from 'expo-audio';
import { colors, spacing, radius, typography } from '@/src/theme';
import { formatMoney as money } from '@/src/format';
import { api } from '@/src/api';
import type { Emergency } from '@/src/api';

const alertSound = require('@/assets/sounds/alert.wav');

const fmt = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export default function AdminEmergenciasScreen() {
  const router = useRouter();
  const [emergencies, setEmergencies] = useState<Emergency[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [billAmounts, setBillAmounts] = useState<Record<string, string>>({});
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
      const e = await api.listEmergencies();
      setEmergencies(e);
      const count = e.filter((x) => x.status === 'aberta').length;
      if (prevEmgRef.current !== null && count > prevEmgRef.current) alertNewEmergency();
      prevEmgRef.current = count;
    } catch {
      // keep previous
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [alertNewEmergency]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
      const interval = setInterval(load, 15000);
      return () => clearInterval(interval);
    }, [load])
  );

  const resolveEmergency = async (id: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setEmergencies((prev) => prev.map((e) => (e.id === id ? { ...e, status: 'atendida' } : e)));
    try { await api.resolveEmergency(id); } catch { load(); }
  };
  const billReboque = async (id: string, estimated: number) => {
    const raw = billAmounts[id];
    const amount = raw != null && raw !== '' ? parseFloat(raw.replace(',', '.')) : estimated;
    if (isNaN(amount) || amount < 0) { Alert.alert('Valor inválido'); return; }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setEmergencies((prev) => prev.map((e) => (e.id === id ? { ...e, billed_amount: amount, billed_at: new Date().toISOString() } : e)));
    try { await api.billEmergency(id, amount); } catch { load(); }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="admin-emergencias-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={16} testID="back-button" style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.onBrandPrimary} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>MARINA</Text>
          <Text style={styles.title} testID="emergencias-title">Emergências</Text>
        </View>
      </View>

      <View style={styles.sheet}>
        {loading ? (
          <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
        ) : (
          <FlatList
            data={emergencies}
            keyExtractor={(e) => e.id}
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
            ListEmptyComponent={<Text style={styles.empty}>Nenhuma emergência.</Text>}
            renderItem={({ item }) => (
              <View style={[styles.card, item.status === 'aberta' && styles.cardAlert]} testID={`emergency-${item.id}`}>
                <View style={styles.cardTop}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                    <Ionicons name="alert-circle" size={20} color={item.status === 'aberta' ? colors.error : colors.success} />
                    <Text style={styles.cardName}>{item.user_name}</Text>
                  </View>
                  <Text style={styles.cardTime}>{fmt(item.created_at)}</Text>
                </View>
                <Text style={styles.cardMeta}>Lancha: {item.boat_name}{item.phone ? ` • Tel.: ${item.phone}` : ''}</Text>
                {item.location ? <Text style={styles.cardMeta}>Local: {item.location}</Text> : null}
                {item.observation ? <Text style={styles.cardMeta}>{item.observation}</Text> : null}
                {item.kind === 'reboque' ? (
                  <View style={styles.reboqueBox}>
                    <View style={styles.reboqueHead}>
                      <Ionicons name="boat" size={14} color={colors.brandPrimary} />
                      <Text style={styles.reboqueTitle}>Reboque • {item.distance_nm} MN</Text>
                    </View>
                    <Text style={styles.cardMeta}>
                      Base {money(item.base_fee || 0)} + adicional {money(item.additional_fee || 0)} = estimado {money(item.estimated_total || 0)}
                    </Text>
                    {item.billed_amount != null ? (
                      <View style={[styles.statusTag, { backgroundColor: colors.success, marginTop: spacing.sm }]}>
                        <Text style={styles.statusTagText}>Lançado na conta: {money(item.billed_amount)}</Text>
                      </View>
                    ) : (
                      <View style={styles.billRow}>
                        <TextInput
                          testID={`reboque-bill-input-${item.id}`}
                          style={styles.billInput}
                          value={billAmounts[item.id] ?? String(item.estimated_total ?? '')}
                          onChangeText={(v) => setBillAmounts((prev) => ({ ...prev, [item.id]: v.replace(/[^\d.,]/g, '') }))}
                          keyboardType="decimal-pad"
                          placeholder="Valor final"
                          placeholderTextColor={colors.onSurfaceTertiary}
                        />
                        <Pressable testID={`reboque-bill-${item.id}`} onPress={() => billReboque(item.id, item.estimated_total || 0)} style={styles.billBtn}>
                          <Ionicons name="cash-outline" size={16} color="#FFFFFF" />
                          <Text style={styles.billBtnText}>Lançar na conta</Text>
                        </Pressable>
                      </View>
                    )}
                  </View>
                ) : null}
                {item.status === 'aberta' ? (
                  <Pressable testID={`emergency-resolve-${item.id}`} onPress={() => resolveEmergency(item.id)} style={styles.resolveBtn}>
                    <Ionicons name="checkmark-circle" size={18} color="#FFFFFF" />
                    <Text style={styles.resolveText}>Marcar como atendida</Text>
                  </Pressable>
                ) : (
                  <View style={[styles.statusTag, { backgroundColor: item.status === 'cancelada' ? colors.onSurfaceTertiary : colors.success }]}>
                    <Text style={styles.statusTagText}>{item.status === 'cancelada' ? 'Cancelada' : 'Atendida'}</Text>
                  </View>
                )}
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
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.lg },
  backBtn: { padding: spacing.sm, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.08)' },
  kicker: { color: colors.brandSecondary, letterSpacing: 3, fontSize: 11, fontWeight: '700' },
  title: { color: colors.onBrandPrimary, fontSize: 24, fontWeight: '800', marginTop: 4 },
  sheet: { flex: 1, backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingTop: spacing.lg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.md },
  empty: { color: colors.onSurfaceSecondary, fontSize: typography.base, textAlign: 'center', marginTop: spacing.xxl },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
  cardAlert: { borderColor: colors.error, borderWidth: 1.5, backgroundColor: '#FEF2F2' },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs },
  cardName: { color: colors.onSurface, fontSize: typography.lg, fontWeight: '800' },
  cardMeta: { color: colors.onSurfaceSecondary, fontSize: typography.base, marginTop: 2 },
  cardTime: { color: colors.onSurfaceTertiary, fontSize: typography.sm, marginTop: 4 },
  statusTag: { alignSelf: 'flex-start', paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.pill, marginTop: spacing.sm },
  statusTagText: { color: '#FFFFFF', fontSize: typography.sm, fontWeight: '700' },
  resolveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, backgroundColor: colors.success, paddingVertical: spacing.md, borderRadius: radius.sm, marginTop: spacing.md },
  resolveText: { color: '#FFFFFF', fontSize: typography.base, fontWeight: '700' },
  reboqueBox: { backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginTop: spacing.sm },
  reboqueHead: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
  reboqueTitle: { color: colors.brandPrimary, fontSize: typography.base, fontWeight: '800' },
  billRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  billInput: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: typography.base, color: colors.onSurface, backgroundColor: colors.surfaceSecondary },
  billBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.sm },
  billBtnText: { color: '#FFFFFF', fontSize: typography.sm, fontWeight: '700' },
});
