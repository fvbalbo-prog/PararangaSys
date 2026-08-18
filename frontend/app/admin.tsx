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

  const filtered = items.filter((i) => (filter === 'todas' ? true : i.type === filter));
  const descidas = items.filter((i) => i.type === 'descida' && i.status !== 'cancelada').length;
  const subidas = items.filter((i) => i.type === 'subida' && i.status !== 'cancelada').length;
  const retornos = items.filter((i) => i.status === 'concluida').length;

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>PAINEL DA MARINA</Text>
          <Text style={styles.title} testID="admin-title">Movimentação do dia</Text>
        </View>
        <Pressable onPress={handleLogout} hitSlop={12} testID="admin-logout" style={styles.logoutBtn}>
          <Ionicons name="log-out-outline" size={22} color={colors.onBrandPrimary} />
        </Pressable>
      </View>

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
            renderItem={({ item }) => (
              <View style={styles.card} testID={`admin-row-${item.id}`}>
                <View style={[styles.timeBlock, item.status === 'cancelada' && { backgroundColor: colors.onSurfaceTertiary }]}>
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
                  <View style={{ marginTop: spacing.sm }}>
                    <StatusBadge status={item.status} />
                  </View>
                </View>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
  },
  kicker: { color: colors.brandSecondary, letterSpacing: 3, fontSize: 11, fontWeight: '700' },
  title: { color: colors.onBrandPrimary, fontSize: 26, fontWeight: '800', marginTop: 4 },
  logoutBtn: { padding: spacing.sm, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.08)' },
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
    flexDirection: 'row',
    gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
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
