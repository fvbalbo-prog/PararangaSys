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
  TextInput,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAudioPlayer } from 'expo-audio';
import { colors, spacing, radius, typography } from '@/src/theme';
import { api, isAuthValidOn, authValidityLabel } from '@/src/api';
import type { Authorization, Emergency } from '@/src/api';

const alertSound = require('@/assets/sounds/alert.wav');

type Tab = 'autorizacoes' | 'emergencias';
import { formatMoney as money } from '@/src/format';
const fmt = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

export default function AdminSolicitacoesScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('autorizacoes');
  const [authScope, setAuthScope] = useState<'hoje' | 'todas'>('hoje');
  const [auths, setAuths] = useState<Authorization[]>([]);
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
      const [a, e] = await Promise.all([
        api.listAuthorizations(),
        api.listEmergencies(),
      ]);
      setAuths(a);
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

  const openEmergencies = emergencies.filter((e) => e.status === 'aberta').length;

  const todayISO = (() => {
    const d = new Date();
    const p = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  })();
  const visibleAuths =
    authScope === 'hoje'
      ? auths.filter((a) => a.status === 'ativa' && isAuthValidOn(a, todayISO))
      : auths;

  const cancelAuth = async (id: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    setAuths((prev) => prev.map((a) => (a.id === id ? { ...a, status: 'cancelada' } : a)));
    try { await api.cancelAuthorization(id); } catch { load(); }
  };
  const resolveEmergency = async (id: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setEmergencies((prev) => prev.map((e) => (e.id === id ? { ...e, status: 'atendida' } : e)));
    try { await api.resolveEmergency(id); } catch { load(); }
  };
  const checkinAuth = async (id: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const nowIso = new Date().toISOString();
    setAuths((prev) => prev.map((a) => (a.id === id ? { ...a, entered_at: nowIso } : a)));
    try { await api.checkinAuthorization(id); } catch { load(); }
  };
  const billReboque = async (id: string, estimated: number) => {
    const raw = billAmounts[id];
    const amount = raw != null && raw !== '' ? parseFloat(raw.replace(',', '.')) : estimated;
    if (isNaN(amount) || amount < 0) { Alert.alert('Valor inválido'); return; }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setEmergencies((prev) => prev.map((e) => (e.id === id ? { ...e, billed_amount: amount, billed_at: new Date().toISOString() } : e)));
    try { await api.billEmergency(id, amount); } catch { load(); }
  };

  const TABS: { key: Tab; label: string; badge?: number }[] = [
    { key: 'autorizacoes', label: 'Autorizações' },
    { key: 'emergencias', label: 'Emergências', badge: openEmergencies },
  ];

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={16} testID="back-button" style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.onBrandPrimary} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>MARINA</Text>
          <Text style={styles.title} testID="solicitacoes-title">Autorizações & Chamados</Text>
        </View>
      </View>

      <View style={styles.sheet}>
        <View style={styles.tabs}>
          {TABS.map((t) => (
            <Pressable
              key={t.key}
              testID={`tab-${t.key}`}
              onPress={() => { setTab(t.key); Haptics.selectionAsync(); }}
              style={[styles.tab, tab === t.key && styles.tabActive]}
            >
              <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>{t.label}</Text>
              {t.badge ? <View style={styles.tabBadge}><Text style={styles.tabBadgeText}>{t.badge}</Text></View> : null}
            </Pressable>
          ))}
        </View>

        {loading ? (
          <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
        ) : tab === 'autorizacoes' ? (
          <FlatList
            data={visibleAuths}
            keyExtractor={(a) => a.id}
            contentContainerStyle={styles.list}
            ListHeaderComponent={
              <View style={styles.scopeRow}>
                {(['hoje', 'todas'] as const).map((s) => (
                  <Pressable
                    key={s}
                    testID={`auth-scope-${s}`}
                    onPress={() => { setAuthScope(s); Haptics.selectionAsync(); }}
                    style={[styles.scopeBtn, authScope === s && styles.scopeBtnActive]}
                  >
                    <Text style={[styles.scopeText, authScope === s && styles.scopeTextActive]}>
                      {s === 'hoje' ? 'Válidas hoje' : 'Todas'}
                    </Text>
                  </Pressable>
                ))}
              </View>
            }
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
            ListEmptyComponent={<Text style={styles.empty}>{authScope === 'hoje' ? 'Nenhuma autorização válida para hoje.' : 'Nenhuma autorização.'}</Text>}
            renderItem={({ item }) => (
              <View style={styles.card} testID={`auth-${item.id}`}>
                <View style={styles.cardTop}>
                  <Text style={styles.cardName}>{item.person_name}</Text>
                  <Text style={styles.cardMeta}>{authValidityLabel(item)}</Text>
                </View>
                <Text style={styles.cardMeta}>Lancha: {item.boat_name} • Titular: {item.user_name}</Text>
                <Text style={styles.cardMeta}>Descer a lancha: {item.can_lower ? 'Sim' : 'Não'}{item.service ? ` • Serviço: ${item.service}` : ''}</Text>
                {item.entered_at ? (
                  <View style={styles.enteredTag}>
                    <Ionicons name="log-in-outline" size={14} color={colors.success} />
                    <Text style={styles.enteredText}>Entrou às {fmtTime(item.entered_at)}</Text>
                  </View>
                ) : null}
                {item.status === 'ativa' ? (
                  <View style={styles.actions}>
                    {!item.entered_at ? (
                      <Pressable testID={`auth-checkin-${item.id}`} onPress={() => checkinAuth(item.id)} style={[styles.actionBtn, { borderRightWidth: 1, borderRightColor: colors.border }]}>
                        <Ionicons name="log-in-outline" size={16} color={colors.success} />
                        <Text style={[styles.actionText, { color: colors.success }]}>Registrar entrada</Text>
                      </Pressable>
                    ) : null}
                    <Pressable testID={`auth-cancel-${item.id}`} onPress={() => cancelAuth(item.id)} style={styles.actionBtn}>
                      <Ionicons name="close-circle-outline" size={16} color={colors.error} />
                      <Text style={[styles.actionText, { color: colors.error }]}>Cancelar</Text>
                    </Pressable>
                  </View>
                ) : (
                  <View style={[styles.statusTag, { backgroundColor: colors.surfaceTertiary }]}>
                    <Text style={[styles.statusTagText, { color: colors.onSurfaceTertiary }]}>Cancelada</Text>
                  </View>
                )}
              </View>
            )}
          />
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
  tabs: { flexDirection: 'row', gap: spacing.sm, marginHorizontal: spacing.lg, marginBottom: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.xs },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: spacing.md, borderRadius: radius.sm },
  tabActive: { backgroundColor: colors.brandPrimary },
  tabText: { color: colors.onSurfaceSecondary, fontSize: typography.sm, fontWeight: '700' },
  tabTextActive: { color: colors.onBrandPrimary },
  tabBadge: { backgroundColor: colors.error, borderRadius: radius.pill, minWidth: 18, height: 18, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  tabBadgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.md },
  empty: { color: colors.onSurfaceSecondary, fontSize: typography.base, textAlign: 'center', marginTop: spacing.xxl },
  enteredTag: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: spacing.sm },
  enteredText: { color: colors.success, fontSize: typography.sm, fontWeight: '700' },
  scopeRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  scopeBtn: { flex: 1, paddingVertical: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, alignItems: 'center', backgroundColor: colors.surface },
  scopeBtnActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  scopeText: { color: colors.onSurfaceSecondary, fontSize: typography.sm, fontWeight: '700' },
  scopeTextActive: { color: colors.onBrandPrimary },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
  cardAlert: { borderColor: colors.error, borderWidth: 1.5, backgroundColor: '#FEF2F2' },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs },
  cardName: { color: colors.onSurface, fontSize: typography.lg, fontWeight: '800' },
  cardMeta: { color: colors.onSurfaceSecondary, fontSize: typography.base, marginTop: 2 },
  cardTime: { color: colors.onSurfaceTertiary, fontSize: typography.sm, marginTop: 4 },
  actions: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.border, marginTop: spacing.md },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingVertical: spacing.md },
  actionText: { fontSize: typography.base, fontWeight: '700' },
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
