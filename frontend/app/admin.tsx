import { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { colors, spacing, radius, typography } from '@/src/theme';
import { api } from '@/src/api';
import type { MarinaRequest, RequestType } from '@/src/api';
import { StatusBadge } from '@/src/components/StatusBadge';

type Filter = 'todas' | RequestType;

function pad(n: number) {
  return n.toString().padStart(2, '0');
}
function toISO(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function labelForDate(d: Date) {
  const today = new Date();
  const isToday = toISO(d) === toISO(today);
  const weekdays = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  const prefix = isToday ? 'Hoje • ' : '';
  return `${prefix}${weekdays[d.getDay()]}, ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
}

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'todas', label: 'Todas' },
  { key: 'descida', label: 'Descidas' },
  { key: 'subida', label: 'Subidas' },
];

export default function AdminScreen() {
  const router = useRouter();
  const [day, setDay] = useState(new Date());
  const [filter, setFilter] = useState<Filter>('todas');
  const [mode, setMode] = useState<'lista' | 'quadro'>('lista');
  const [items, setItems] = useState<MarinaRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem('user');
      if (!raw) return router.replace('/');
      const data = await api.dayRequests(toISO(day));
      setItems(data);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [day, router]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
    }, [load])
  );

  const shiftDay = (delta: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const nd = new Date(day);
    nd.setDate(nd.getDate() + delta);
    setDay(nd);
  };

  const handleLogout = async () => {
    await AsyncStorage.removeItem('user');
    router.replace('/');
  };

  const doComplete = async (id: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const now = new Date().toISOString();
    setItems((prev) => prev.map((r) => (r.id === id ? { ...r, status: 'concluida', returned_at: now } : r)));
    try {
      await api.completeRequest(id);
    } catch {
      load();
    }
  };

  const doCancel = async (id: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    setItems((prev) => prev.map((r) => (r.id === id ? { ...r, status: 'cancelada' } : r)));
    try {
      await api.cancelRequest(id);
    } catch {
      load();
    }
  };

  const isToday = toISO(day) === toISO(new Date());
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const toMin = (hhmm?: string | null) => {
    if (!hhmm) return null;
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  };
  // Late if today, 15+ min past the reference time and not concluded
  const isLate = (refTime?: string | null, concluded?: boolean) => {
    const ref = toMin(refTime);
    return isToday && !concluded && ref != null && nowMin > ref + 15;
  };

  const filtered = items.filter((i) => (filter === 'todas' ? true : i.type === filter));
  const descidas = items.filter((i) => i.type === 'descida' && i.status !== 'cancelada').length;
  const subidas = items.filter((i) => i.type === 'subida' && i.status !== 'cancelada').length;
  const retornos = items.filter((i) => i.status === 'concluida').length;

  // Quadro de Horários: for each descida, find its boat's subida time
  const activeSubidas = items.filter((i) => i.type === 'subida' && i.status !== 'cancelada');
  const quadroRows = items
    .filter((i) => i.type === 'descida' && i.status !== 'cancelada')
    .sort((a, b) => a.time.localeCompare(b.time))
    .map((d) => {
      const sub = activeSubidas.find((s) => s.boat_name === d.boat_name);
      const refTime = sub ? sub.time : d.expected_return_time;
      const concluded = sub ? sub.status === 'concluida' : d.status === 'concluida';
      return {
        id: d.id,
        boat: d.boat_name || '—',
        descida: d.time,
        subida: sub ? sub.time : d.expected_return_time ? `${d.expected_return_time}*` : '—',
        concluida: concluded,
        late: isLate(refTime, concluded),
      };
    });

  const lateCount = quadroRows.filter((r) => r.late).length;

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>PAINEL DA MARINA</Text>
          <Text style={styles.title} testID="admin-title">Movimentação do dia</Text>
        </View>
        <Pressable
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/admin-status'); }}
          hitSlop={12}
          testID="admin-status-button"
          style={styles.logoutBtn}
        >
          <Ionicons name="eye-outline" size={22} color={colors.onBrandPrimary} />
        </Pressable>
        <Pressable
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/admin-clientes'); }}
          hitSlop={12}
          testID="admin-clientes-button"
          style={[styles.logoutBtn, { marginLeft: spacing.sm }]}
        >
          <Ionicons name="people-outline" size={22} color={colors.onBrandPrimary} />
        </Pressable>
        <Pressable onPress={handleLogout} hitSlop={12} testID="admin-logout" style={[styles.logoutBtn, { marginLeft: spacing.sm }]}>
          <Ionicons name="log-out-outline" size={22} color={colors.onBrandPrimary} />
        </Pressable>
      </View>

      {isToday && lateCount > 0 ? (
        <Pressable
          testID="late-alert-banner"
          onPress={() => setMode('quadro')}
          style={styles.alertBanner}
        >
          <Ionicons name="warning" size={18} color="#FFFFFF" />
          <Text style={styles.alertText}>
            {lateCount} {lateCount === 1 ? 'lancha atrasada' : 'lanchas atrasadas'} — ainda não retornou
          </Text>
        </Pressable>
      ) : null}

      <View style={styles.dateNav}>
        <Pressable onPress={() => shiftDay(-1)} testID="prev-day" style={styles.navBtn} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={colors.onBrandPrimary} />
        </Pressable>
        <Text style={styles.dateLabel} testID="admin-date-label">{labelForDate(day)}</Text>
        <Pressable onPress={() => shiftDay(1)} testID="next-day" style={styles.navBtn} hitSlop={8}>
          <Ionicons name="chevron-forward" size={22} color={colors.onBrandPrimary} />
        </Pressable>
      </View>

      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{descidas}</Text>
          <Text style={styles.statLabel}>Descidas</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{subidas}</Text>
          <Text style={styles.statLabel}>Subidas</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statValue, { color: colors.success }]}>{retornos}</Text>
          <Text style={styles.statLabel}>Retornos</Text>
        </View>
      </View>

      <View style={styles.sheet}>
        <View style={styles.modeToggle}>
          <Pressable
            testID="mode-lista"
            onPress={() => { setMode('lista'); try { Haptics.selectionAsync(); } catch {} }}
            style={[styles.modeBtn, mode === 'lista' && styles.modeBtnActive]}
          >
            <Ionicons name="list-outline" size={18} color={mode === 'lista' ? colors.onBrandPrimary : colors.onSurfaceSecondary} />
            <Text style={[styles.modeText, mode === 'lista' && styles.modeTextActive]}>Movimentação</Text>
          </Pressable>
          <Pressable
            testID="mode-quadro"
            onPress={() => { setMode('quadro'); try { Haptics.selectionAsync(); } catch {} }}
            style={[styles.modeBtn, mode === 'quadro' && styles.modeBtnActive]}
          >
            <Ionicons name="grid-outline" size={18} color={mode === 'quadro' ? colors.onBrandPrimary : colors.onSurfaceSecondary} />
            <Text style={[styles.modeText, mode === 'quadro' && styles.modeTextActive]}>Quadro de Horários</Text>
          </Pressable>
        </View>

        {mode === 'quadro' ? (
          loading ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.brandPrimary} />
            </View>
          ) : quadroRows.length === 0 ? (
            <View style={styles.center}>
              <View style={styles.emptyIcon}>
                <Ionicons name="grid-outline" size={44} color={colors.brandSecondary} />
              </View>
              <Text style={styles.emptyTitle}>Nenhuma descida hoje</Text>
              <Text style={styles.emptySubtitle}>O quadro mostra as descidas do dia.</Text>
            </View>
          ) : (
            <FlatList
              data={quadroRows}
              keyExtractor={(r) => r.id}
              contentContainerStyle={styles.quadroList}
              ListHeaderComponent={
                <View style={styles.quadroHead}>
                  <Text style={[styles.quadroHeadText, { flex: 2 }]}>Lancha</Text>
                  <Text style={[styles.quadroHeadText, styles.quadroCol]}>Descida</Text>
                  <Text style={[styles.quadroHeadText, styles.quadroCol]}>Subida</Text>
                </View>
              }
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={() => { setRefreshing(true); load(); }}
                  tintColor={colors.brandPrimary}
                />
              }
              renderItem={({ item, index }) => (
                <View
                  style={[
                    styles.quadroRow,
                    index % 2 === 1 && { backgroundColor: colors.surfaceSecondary },
                    item.late && styles.quadroRowLate,
                  ]}
                  testID={`quadro-row-${item.id}`}
                >
                  <View style={{ flex: 2, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                    <Ionicons name={item.late ? 'warning' : 'boat'} size={16} color={item.late ? colors.error : colors.brandPrimary} />
                    <View style={{ flexShrink: 1 }}>
                      <Text style={styles.quadroBoat} numberOfLines={1}>{item.boat}</Text>
                      {item.late ? <Text style={styles.quadroLateText} testID={`quadro-late-${item.id}`}>Atrasada</Text> : null}
                    </View>
                  </View>
                  <Text style={[styles.quadroTime, styles.quadroCol]}>{item.descida}</Text>
                  <Text
                    style={[
                      styles.quadroTime,
                      styles.quadroCol,
                      item.concluida && { color: colors.success },
                      item.late && { color: colors.error },
                    ]}
                  >
                    {item.subida}
                  </Text>
                </View>
              )}
              ListFooterComponent={
                <Text style={styles.quadroNote}>* horário previsto de retorno (sem solicitação de subida)</Text>
              }
            />
          )
        ) : (
          <>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipRow}
              style={styles.chipScroller}
            >
              {FILTERS.map((f) => {
                const active = filter === f.key;
                return (
                  <Pressable
                    key={f.key}
                    testID={`filter-${f.key}`}
                    onPress={() => {
                      setFilter(f.key);
                      try {
                        Haptics.selectionAsync();
                      } catch {}
                    }}
                    style={[styles.chip, active && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{f.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {loading ? (
              <View style={styles.center}>
                <ActivityIndicator color={colors.brandPrimary} />
              </View>
            ) : filtered.length === 0 ? (
              <View style={styles.center}>
                <View style={styles.emptyIcon}>
                  <Ionicons name="compass-outline" size={44} color={colors.brandSecondary} />
                </View>
                <Text style={styles.emptyTitle}>Nenhuma movimentação</Text>
                <Text style={styles.emptySubtitle}>Não há solicitações para este dia.</Text>
              </View>
            ) : (
              <FlatList
                data={filtered}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.list}
                refreshControl={
                  <RefreshControl
                    refreshing={refreshing}
                    onRefresh={() => {
                      setRefreshing(true);
                      load();
                    }}
                    tintColor={colors.brandPrimary}
                  />
                }
                renderItem={({ item }) => {
                  const rowLate =
                    item.type === 'subida' && isLate(item.time, item.status === 'concluida');
                  return (
                  <View style={[styles.card, rowLate && styles.cardLate]} testID={`admin-row-${item.id}`}>
                    <View style={styles.cardMain}>
                      <View style={[styles.timeBlock, item.status === 'cancelada' && { backgroundColor: colors.onSurfaceTertiary }, rowLate && { backgroundColor: colors.error }]}>
                        <Text style={styles.timeText}>{item.time}</Text>
                        <Text style={styles.timeLabel}>{item.type === 'descida' ? 'DESCIDA' : 'SUBIDA'}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.cardTitle} numberOfLines={1}>
                          {item.user_name} • {item.boat_name}
                        </Text>
                        {item.type === 'descida' ? (
                          <Text style={styles.cardMeta} numberOfLines={1}>
                            {item.destination} • {item.passengers} pax • Ret. {item.expected_return_time}
                          </Text>
                        ) : (
                          <Text style={styles.cardMeta}>Retorno agendado</Text>
                        )}
                        {item.responsible ? (
                          <Text style={styles.cardMeta}>Resp.: {item.responsible}</Text>
                        ) : null}
                        <View style={{ marginTop: spacing.sm, flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
                          <StatusBadge status={item.status} />
                          {rowLate ? (
                            <View style={styles.lateBadge} testID={`late-badge-${item.id}`}>
                              <Ionicons name="warning" size={11} color="#FFFFFF" />
                              <Text style={styles.lateBadgeText}>Atrasada</Text>
                            </View>
                          ) : null}
                        </View>
                      </View>
                    </View>
                    {item.status === 'agendada' ? (
                      <View style={styles.adminActions}>
                        <Pressable
                          testID={`admin-complete-${item.id}`}
                          style={({ pressed }) => [styles.adminActionBtn, styles.completeBtn, pressed && { opacity: 0.85 }]}
                          onPress={() => doComplete(item.id)}
                        >
                          <Ionicons name="checkmark-circle-outline" size={16} color={colors.success} />
                          <Text style={[styles.adminActionText, { color: colors.success }]}>Concluir</Text>
                        </Pressable>
                        <Pressable
                          testID={`admin-cancel-${item.id}`}
                          style={({ pressed }) => [styles.adminActionBtn, pressed && { opacity: 0.85 }]}
                          onPress={() => doCancel(item.id)}
                        >
                          <Ionicons name="close-circle-outline" size={16} color={colors.error} />
                          <Text style={[styles.adminActionText, { color: colors.error }]}>Cancelar</Text>
                        </Pressable>
                      </View>
                    ) : null}
                  </View>
                  );
                }}
              />
            )}
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.brandPrimary },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
  },
  kicker: { color: colors.brandSecondary, letterSpacing: 3, fontSize: 11, fontWeight: '700' },
  title: { color: colors.onBrandPrimary, fontSize: 26, fontWeight: '800', marginTop: 4 },
  logoutBtn: { padding: spacing.sm, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.08)' },
  alertBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.error,
    marginHorizontal: spacing.xl,
    marginTop: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
  },
  alertText: { color: '#FFFFFF', fontSize: typography.base, fontWeight: '700', flex: 1 },
  dateNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    marginTop: spacing.lg,
  },
  navBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateLabel: { color: colors.onBrandPrimary, fontSize: typography.lg, fontWeight: '700' },
  statsRow: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    marginTop: spacing.lg,
    marginBottom: spacing.lg,
  },
  statCard: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  statValue: { color: colors.onBrandPrimary, fontSize: typography.xxl, fontWeight: '800' },
  statLabel: { color: colors.onBrandPrimary, opacity: 0.8, fontSize: typography.sm, marginTop: 2 },
  sheet: {
    flex: 1,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingTop: spacing.lg,
  },
  modeToggle: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.xs,
  },
  modeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
    borderRadius: radius.sm,
  },
  modeBtnActive: { backgroundColor: colors.brandPrimary },
  modeText: { color: colors.onSurfaceSecondary, fontSize: typography.sm, fontWeight: '700' },
  modeTextActive: { color: colors.onBrandPrimary },
  quadroList: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl },
  quadroHead: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.brandPrimary,
    borderTopLeftRadius: radius.md,
    borderTopRightRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  quadroHeadText: { color: colors.onBrandPrimary, fontSize: typography.sm, fontWeight: '800' },
  quadroCol: { flex: 1, textAlign: 'center' },
  quadroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  quadroBoat: { color: colors.onSurface, fontSize: typography.base, fontWeight: '700', flexShrink: 1 },
  quadroTime: { color: colors.onSurface, fontSize: typography.lg, fontWeight: '700' },
  quadroNote: { color: colors.onSurfaceTertiary, fontSize: typography.sm, marginTop: spacing.md, textAlign: 'center' },
  chipScroller: { maxHeight: 56 },
  chipRow: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  chip: {
    height: 36,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontSize: typography.base, fontWeight: '600' },
  chipTextActive: { color: colors.onBrandPrimary },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  emptyIcon: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.brandTertiary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  emptyTitle: { color: colors.onSurface, fontSize: typography.xl, fontWeight: '700' },
  emptySubtitle: { color: colors.onSurfaceSecondary, fontSize: typography.base, marginTop: spacing.sm },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.md },
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  cardLate: { borderColor: colors.error, borderWidth: 1.5 },
  cardMain: { flexDirection: 'row', gap: spacing.md, padding: spacing.md },
  adminActions: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  adminActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
  },
  completeBtn: { borderRightWidth: 1, borderRightColor: colors.border },
  adminActionText: { fontSize: typography.base, fontWeight: '700' },
  lateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.error,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  lateBadgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  quadroRowLate: { backgroundColor: '#FEF2F2' },
  quadroLateText: { color: colors.error, fontSize: 11, fontWeight: '700' },
  timeBlock: {
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    alignItems: 'center',
    minWidth: 72,
    alignSelf: 'flex-start',
  },
  timeText: { color: colors.onBrandPrimary, fontSize: typography.lg, fontWeight: '800' },
  timeLabel: { color: colors.brandSecondary, fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  cardTitle: { color: colors.onSurface, fontSize: typography.base, fontWeight: '700' },
  cardMeta: { color: colors.onSurfaceSecondary, fontSize: typography.sm, marginTop: 2 },
});
