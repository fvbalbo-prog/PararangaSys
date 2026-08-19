import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors, spacing, radius, typography } from '@/src/theme';
import { formatMoney as money } from '@/src/format';
import { api } from '@/src/api';
import type { User, ConsumoClient, Statement } from '@/src/api';

const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
function monthLabel(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS[(m || 1) - 1]} / ${y}`;
}

export default function FaturaScreen() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [{ year, month }, setYm] = useState(() => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() + 1 }; });
  const [current, setCurrent] = useState<ConsumoClient | null>(null);
  const [statements, setStatements] = useState<Statement[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const monthStr = `${year}-${String(month).padStart(2, '0')}`;
  const now = new Date();
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;

  const load = useCallback(async () => {
    const raw = await AsyncStorage.getItem('user');
    if (!raw) return router.replace('/');
    const u: User = JSON.parse(raw);
    setUser(u);
    try {
      const [rep, sts] = await Promise.all([
        api.consumoReport(monthStr, u.cpf),
        api.listStatements(u.cpf),
      ]);
      setCurrent(rep.clients[0] || null);
      setStatements(sts);
      const unread = sts.filter((s) => !s.read);
      for (const s of unread) api.readStatement(s.id).catch(() => {});
    } catch {
      setCurrent(null);
      setStatements([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [router, monthStr]);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  const shiftMonth = (delta: number) => {
    let m = month + delta, y = year;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    setYm({ year: y, month: m });
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']} testID="fatura-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={16} testID="back-button">
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Minha Fatura</Text>
          <Text style={styles.subtitle}>Conveniência e reboques</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
        >
          <View style={styles.monthNav}>
            <Pressable testID="fatura-month-prev" onPress={() => shiftMonth(-1)} hitSlop={10} style={styles.navBtn}>
              <Ionicons name="chevron-back" size={20} color={colors.brandPrimary} />
            </Pressable>
            <Text style={styles.monthLabel} testID="fatura-month-label">{MONTHS[month - 1]} / {year}</Text>
            <Pressable testID="fatura-month-next" onPress={() => shiftMonth(1)} hitSlop={10} disabled={isCurrentMonth} style={[styles.navBtn, isCurrentMonth && { opacity: 0.3 }]}>
              <Ionicons name="chevron-forward" size={20} color={colors.brandPrimary} />
            </Pressable>
          </View>

          <Text style={styles.sectionLabel}>{isCurrentMonth ? 'Mês atual (parcial)' : 'Consumo do mês'}</Text>
          <View style={styles.bigCard}>
            <Text style={styles.bigLabel}>Total{isCurrentMonth ? ' até agora' : ''}</Text>
            <Text style={styles.bigValue} testID="fatura-current-total">{money(current?.total || 0)}</Text>
            <View style={styles.splitRow}>
              <Text style={styles.splitText}>Conveniência: {money(current?.convenience_total || 0)}</Text>
              <Text style={styles.splitText}>Reboque: {money(current?.reboque_total || 0)}</Text>
            </View>
          </View>

          {statements.length > 0 ? (
            <>
              <Text style={styles.sectionLabel}>Resumos enviados pela marina</Text>
              {statements.map((s) => (
                <View key={s.id} style={styles.card} testID={`statement-${s.id}`}>
                  <View style={styles.cardTop}>
                    <Text style={styles.cardMonth}>{monthLabel(s.month)}</Text>
                    <Text style={styles.cardTotal}>{money(s.total)}</Text>
                  </View>
                  <Text style={styles.cardInfo}>Este valor será cobrado na sua fatura mensal.</Text>
                  {s.orders.map((o) => (
                    <View key={o.id} style={styles.line}>
                      <Text style={styles.lineText} numberOfLines={1}>🛒 {o.items.map((i) => `${i.qty}x ${i.name}`).join(', ')}</Text>
                      <Text style={styles.lineVal}>{money(o.total)}</Text>
                    </View>
                  ))}
                  {s.reboques.map((r) => (
                    <View key={r.id} style={styles.line}>
                      <Text style={styles.lineText} numberOfLines={1}>⚓ Reboque {r.boat_name || ''}</Text>
                      <Text style={styles.lineVal}>{money(r.amount)}</Text>
                    </View>
                  ))}
                </View>
              ))}
            </>
          ) : (
            <Text style={styles.empty}>Nenhum resumo enviado ainda.</Text>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg, gap: spacing.md },
  title: { color: colors.onSurface, fontSize: typography.xxl, fontWeight: '800' },
  subtitle: { color: colors.onSurfaceSecondary, fontSize: typography.sm, marginTop: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  monthNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xl, marginBottom: spacing.md },
  navBtn: { padding: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary },
  monthLabel: { color: colors.onSurface, fontSize: typography.lg, fontWeight: '800', minWidth: 130, textAlign: 'center' },
  sectionLabel: { color: colors.brandPrimary, fontWeight: '700', fontSize: typography.sm, letterSpacing: 1, textTransform: 'uppercase', marginBottom: spacing.md, marginTop: spacing.sm },
  bigCard: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, padding: spacing.xl, marginBottom: spacing.lg },
  bigLabel: { color: colors.brandSecondary, fontSize: typography.sm, fontWeight: '700' },
  bigValue: { color: colors.onBrandPrimary, fontSize: 32, fontWeight: '800', marginTop: 2 },
  splitRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.md },
  splitText: { color: colors.onBrandPrimary, opacity: 0.9, fontSize: typography.sm, fontWeight: '600' },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.sm },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardMonth: { color: colors.onSurface, fontSize: typography.lg, fontWeight: '800' },
  cardTotal: { color: colors.brandPrimary, fontSize: typography.lg, fontWeight: '800' },
  cardInfo: { color: colors.onSurfaceSecondary, fontSize: typography.sm, marginTop: 2, marginBottom: spacing.sm },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, paddingVertical: 2 },
  lineText: { color: colors.onSurfaceSecondary, fontSize: typography.sm, flex: 1 },
  lineVal: { color: colors.onSurface, fontSize: typography.sm, fontWeight: '700' },
  empty: { color: colors.onSurfaceSecondary, fontSize: typography.base, textAlign: 'center', marginTop: spacing.xl },
});
