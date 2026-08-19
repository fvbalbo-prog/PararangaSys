import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, spacing, radius, typography } from '@/src/theme';
import { api } from '@/src/api';
import type { ConsumoReport, ConsumoClient } from '@/src/api';

import { formatMoney as money } from '@/src/format';
const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function currentMonth() {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

export default function AdminRelatorioScreen() {
  const router = useRouter();
  const [{ year, month }, setYm] = useState(currentMonth());
  const [report, setReport] = useState<ConsumoReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const monthStr = `${year}-${String(month).padStart(2, '0')}`;

  const load = useCallback(async () => {
    try {
      setReport(await api.consumoReport(monthStr));
    } catch {
      setReport(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [monthStr]);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  const shiftMonth = (delta: number) => {
    Haptics.selectionAsync();
    let m = month + delta, y = year;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    setYm({ year: y, month: m });
    setExpanded(null);
  };

  const renderClient = ({ item }: { item: ConsumoClient }) => {
    const open = expanded === item.cpf;
    return (
      <Pressable style={styles.card} testID={`consumo-${item.cpf}`} onPress={() => setExpanded(open ? null : item.cpf)}>
        <View style={styles.cardTop}>
          <Text style={styles.clientName}>{item.name}</Text>
          <Text style={styles.clientTotal}>{money(item.total)}</Text>
        </View>
        <View style={styles.breakdown}>
          <View style={styles.bItem}>
            <Ionicons name="cart-outline" size={14} color={colors.brandPrimary} />
            <Text style={styles.bText}>Conveniência {money(item.convenience_total)}</Text>
          </View>
          {item.reboque_total > 0 ? (
            <View style={styles.bItem}>
              <Ionicons name="boat-outline" size={14} color={colors.brandPrimary} />
              <Text style={styles.bText}>Reboque {money(item.reboque_total)}</Text>
            </View>
          ) : null}
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={colors.onSurfaceTertiary} style={{ marginLeft: 'auto' }} />
        </View>
        {open ? (
          <View style={styles.detail}>
            {item.orders.map((o) => (
              <View key={o.id} style={styles.detailRow}>
                <Text style={styles.detailText} numberOfLines={1}>
                  🛒 {o.items.map((i) => `${i.qty}x ${i.name}`).join(', ')}
                </Text>
                <Text style={styles.detailVal}>{money(o.total)}</Text>
              </View>
            ))}
            {item.reboques.map((r) => (
              <View key={r.id} style={styles.detailRow}>
                <Text style={styles.detailText} numberOfLines={1}>⚓ Reboque {r.boat_name || ''}</Text>
                <Text style={styles.detailVal}>{money(r.amount)}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={16} testID="back-button" style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.onBrandPrimary} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>COBRANÇA MENSAL</Text>
          <Text style={styles.title} testID="relatorio-title">Consumo por Cliente</Text>
        </View>
      </View>

      <View style={styles.sheet}>
        <View style={styles.monthNav}>
          <Pressable testID="month-prev" onPress={() => shiftMonth(-1)} hitSlop={10} style={styles.navBtn}>
            <Ionicons name="chevron-back" size={20} color={colors.brandPrimary} />
          </Pressable>
          <Text style={styles.monthLabel} testID="month-label">{MONTHS[month - 1]} / {year}</Text>
          <Pressable testID="month-next" onPress={() => shiftMonth(1)} hitSlop={10} style={styles.navBtn}>
            <Ionicons name="chevron-forward" size={20} color={colors.brandPrimary} />
          </Pressable>
        </View>

        <View style={styles.grandCard}>
          <Text style={styles.grandLabel}>Total do mês</Text>
          <Text style={styles.grandValue} testID="grand-total">{money(report?.grand_total || 0)}</Text>
        </View>

        {loading ? (
          <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
        ) : (
          <FlatList
            data={report?.clients || []}
            keyExtractor={(c) => c.cpf}
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
            ListEmptyComponent={<Text style={styles.empty}>Nenhum consumo neste mês.</Text>}
            renderItem={renderClient}
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
  monthNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xl, marginBottom: spacing.md },
  navBtn: { padding: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary },
  monthLabel: { color: colors.onSurface, fontSize: typography.lg, fontWeight: '800', minWidth: 120, textAlign: 'center' },
  grandCard: { marginHorizontal: spacing.lg, marginBottom: spacing.md, backgroundColor: colors.brandPrimary, borderRadius: radius.md, padding: spacing.lg, alignItems: 'center' },
  grandLabel: { color: colors.brandSecondary, fontSize: typography.sm, fontWeight: '700', letterSpacing: 0.5 },
  grandValue: { color: colors.onBrandPrimary, fontSize: 28, fontWeight: '800', marginTop: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.sm },
  empty: { color: colors.onSurfaceSecondary, fontSize: typography.base, textAlign: 'center', marginTop: spacing.xxl },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  clientName: { color: colors.onSurface, fontSize: typography.lg, fontWeight: '800', flex: 1 },
  clientTotal: { color: colors.brandPrimary, fontSize: typography.lg, fontWeight: '800' },
  breakdown: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm },
  bItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  bText: { color: colors.onSurfaceSecondary, fontSize: typography.sm, fontWeight: '600' },
  detail: { marginTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, gap: spacing.xs },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  detailText: { color: colors.onSurfaceSecondary, fontSize: typography.sm, flex: 1 },
  detailVal: { color: colors.onSurface, fontSize: typography.sm, fontWeight: '700' },
});
