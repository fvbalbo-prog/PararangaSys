import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { colors, spacing, radius, typography } from '@/src/theme';
import { formatMoney as money } from '@/src/format';
import { api } from '@/src/api';
import type { MarinaRequest, ConvenienceOrder, Emergency, WeeklyDay } from '@/src/api';
import { StatusBadge } from '@/src/components/StatusBadge';
import { useAdminLayout } from '@/src/hooks/useAdminLayout';

function pad(n: number) { return n.toString().padStart(2, '0'); }
function todayISO() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

type NavItem = { key: string; label: string; icon: keyof typeof Ionicons.glyphMap; route?: string };
const NAV: NavItem[] = [
  { key: 'inicio', label: 'Visão Geral', icon: 'grid-outline' },
  { key: 'movimentacoes', label: 'Movimentações', icon: 'list-outline', route: '/admin-status' },
  { key: 'solicitacoes', label: 'Solicitações', icon: 'receipt-outline', route: '/admin-solicitacoes' },
  { key: 'cadastros', label: 'Cadastros', icon: 'people-outline', route: '/admin-clientes' },
  { key: 'produtos', label: 'Conveniência', icon: 'pricetags-outline', route: '/admin-produtos' },
  { key: 'faturamento', label: 'Faturamento', icon: 'bar-chart-outline', route: '/admin-relatorio' },
];

export default function AdminDesktopScreen() {
  const router = useRouter();
  const { isDesktop, ready, setMode } = useAdminLayout();
  const [items, setItems] = useState<MarinaRequest[]>([]);
  const [orders, setOrders] = useState<ConvenienceOrder[]>([]);
  const [emergencies, setEmergencies] = useState<Emergency[]>([]);
  const [weekly, setWeekly] = useState<WeeklyDay[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (ready && !isDesktop) router.replace('/admin');
  }, [ready, isDesktop, router]);

  const iso = todayISO();
  const load = useCallback(async () => {
    const raw = await AsyncStorage.getItem('user');
    if (!raw) return router.replace('/');
    try {
      const [reqs, ords, emgs] = await Promise.all([
        api.dayRequests(iso),
        api.listOrders().catch(() => []),
        api.listEmergencies().catch(() => []),
      ]);
      setItems(reqs);
      setOrders(ords);
      setEmergencies(emgs);
      api.weeklyReport().then(setWeekly).catch(() => {});
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [iso, router]);

  useFocusEffect(useCallback(() => {
    load();
    const interval = setInterval(load, 20000);
    return () => clearInterval(interval);
  }, [load]));

  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const toMin = (hhmm?: string | null) => { if (!hhmm) return null; const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

  const descidas = items.filter((i) => i.type === 'descida' && i.status !== 'cancelada').length;
  const subidas = items.filter((i) => i.type === 'subida' && i.status !== 'cancelada').length;
  const concluidas = items.filter((i) => i.status === 'concluida').length;
  const aguardando = items.filter((i) => i.status === 'agendada').length;
  const atrasos = items.filter((i) => {
    if (i.type !== 'subida' || i.status !== 'agendada') return false;
    const ref = toMin(i.time);
    return ref != null && nowMin > ref + 15;
  }).length;
  const openEmg = emergencies.filter((e) => e.status === 'aberta');

  const convTotal = orders.filter((o) => o.status !== 'cancelada' && o.created_at?.startsWith(iso)).reduce((s, o) => s + o.total, 0);
  const reboqueTotal = emergencies.filter((e) => e.kind === 'reboque' && e.billed_amount != null && e.billed_at?.startsWith(iso)).reduce((s, e) => s + (e.billed_amount || 0), 0);
  const faturamento = convTotal + reboqueTotal;

  const dayList = [...items].sort((a, b) => a.time.localeCompare(b.time));

  const doComplete = async (id: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setItems((prev) => prev.map((r) => (r.id === id ? { ...r, status: 'concluida' } : r)));
    try { await api.completeRequest(id); } catch { load(); }
  };

  const logout = async () => { await AsyncStorage.removeItem('user'); router.replace('/'); };
  const go = (item: NavItem) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (item.route) router.push(item.route);
  };

  const stats: { label: string; value: number; icon: keyof typeof Ionicons.glyphMap; color: string }[] = [
    { label: 'Descidas', value: descidas, icon: 'boat', color: colors.brandPrimary },
    { label: 'Subidas', value: subidas, icon: 'arrow-up-circle', color: '#0E7490' },
    { label: 'Concluídas', value: concluidas, icon: 'checkmark-done-circle', color: colors.success },
    { label: 'Aguardando', value: aguardando, icon: 'hourglass', color: '#B45309' },
    { label: 'Atrasos', value: atrasos, icon: 'warning', color: colors.error },
    { label: 'Emergências', value: openEmg.length, icon: 'alert-circle', color: colors.error },
  ];

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']} testID="admin-desktop-screen">
      <View style={styles.shell}>
        {/* Sidebar */}
        <View style={styles.sidebar}>
          <View style={styles.brand}>
            <View style={styles.brandLogo}><Ionicons name="boat" size={20} color={colors.onBrandPrimary} /></View>
            <View>
              <Text style={styles.brandName}>Marina Pararanga</Text>
              <Text style={styles.brandRole}>Painel administrativo</Text>
            </View>
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: spacing.md }}>
            {NAV.map((n) => {
              const active = n.key === 'inicio';
              return (
                <Pressable key={n.key} testID={`nav-${n.key}`} onPress={() => go(n)} style={({ pressed }) => [styles.navItem, active && styles.navItemActive, pressed && { opacity: 0.9 }]}>
                  <Ionicons name={n.icon} size={20} color={active ? colors.onBrandPrimary : colors.brandSecondary} />
                  <Text style={[styles.navText, active && styles.navTextActive]}>{n.label}</Text>
                  {n.key === 'solicitacoes' && openEmg.length > 0 ? (
                    <View style={styles.navBadge}><Text style={styles.navBadgeText}>{openEmg.length}</Text></View>
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
          <Pressable testID="switch-mobile" onPress={() => { Haptics.selectionAsync(); setMode('mobile'); }} style={styles.footerBtn}>
            <Ionicons name="phone-portrait-outline" size={18} color={colors.brandSecondary} />
            <Text style={styles.footerText}>Ver no celular</Text>
          </Pressable>
          <Pressable testID="desktop-logout" onPress={logout} style={styles.footerBtn}>
            <Ionicons name="log-out-outline" size={18} color={colors.brandSecondary} />
            <Text style={styles.footerText}>Sair</Text>
          </Pressable>
        </View>

        {/* Main */}
        <ScrollView style={styles.main} contentContainerStyle={styles.mainContent} showsVerticalScrollIndicator={false}>
          <View style={styles.topbar}>
            <View>
              <Text style={styles.pageTitle} testID="desktop-title">Visão Geral</Text>
              <Text style={styles.pageSub}>{new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}</Text>
            </View>
            <Pressable testID="desktop-refresh" onPress={() => { setLoading(true); load(); }} style={styles.refreshBtn}>
              <Ionicons name="refresh" size={18} color={colors.brandPrimary} />
              <Text style={styles.refreshText}>Atualizar</Text>
            </Pressable>
          </View>

          {loading ? (
            <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
          ) : (
            <>
              {/* Faturamento + stats */}
              <View style={styles.gridTop}>
                <View style={styles.fatCard} testID="desktop-faturamento">
                  <Text style={styles.fatLabel}>FATURAMENTO DE HOJE</Text>
                  <Text style={styles.fatValue}>{money(faturamento)}</Text>
                  <Text style={styles.fatBreak}>Conveniência {money(convTotal)} • Reboque {money(reboqueTotal)}</Text>
                </View>
                <View style={styles.statsWrap}>
                  {stats.map((s) => (
                    <View key={s.label} style={styles.statCard} testID={`desktop-stat-${s.label}`}>
                      <View style={[styles.statIcon, { backgroundColor: s.color }]}><Ionicons name={s.icon} size={18} color="#FFFFFF" /></View>
                      <Text style={[styles.statValue, s.label === 'Atrasos' && atrasos > 0 && { color: colors.error }]}>{s.value}</Text>
                      <Text style={styles.statLabel}>{s.label}</Text>
                    </View>
                  ))}
                </View>
              </View>

              {/* Two columns: movimentações + emergências */}
              <View style={styles.columns}>
                <View style={styles.colWide}>
                  <View style={styles.panel}>
                    <View style={styles.panelHead}>
                      <Text style={styles.panelTitle}>Movimentações de hoje</Text>
                      <Pressable onPress={() => router.push('/admin-status')} testID="see-all-movs"><Text style={styles.panelLink}>Ver tudo</Text></Pressable>
                    </View>
                    {dayList.length === 0 ? (
                      <Text style={styles.emptyLine}>Nenhuma movimentação hoje.</Text>
                    ) : (
                      dayList.slice(0, 12).map((r) => (
                        <View key={r.id} style={styles.movRow} testID={`desktop-mov-${r.id}`}>
                          <View style={[styles.movTime, r.type === 'subida' && { backgroundColor: colors.brandSecondary }]}>
                            <Text style={styles.movTimeText}>{r.time}</Text>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.movBoat}>{r.boat_name} <Text style={styles.movType}>· {r.type === 'descida' ? 'Descida' : 'Subida'}</Text></Text>
                            <Text style={styles.movUser}>{r.user_name}</Text>
                          </View>
                          <StatusBadge status={r.status} />
                          {r.status === 'agendada' ? (
                            <Pressable testID={`desktop-complete-${r.id}`} onPress={() => doComplete(r.id)} style={styles.confirmBtn}>
                              <Ionicons name="checkmark" size={16} color="#FFFFFF" />
                            </Pressable>
                          ) : null}
                        </View>
                      ))
                    )}
                  </View>
                </View>

                <View style={styles.colNarrow}>
                  <View style={[styles.panel, openEmg.length > 0 && styles.panelAlert]}>
                    <View style={styles.panelHead}>
                      <Text style={styles.panelTitle}>Emergências abertas</Text>
                      {openEmg.length > 0 ? <View style={styles.navBadge}><Text style={styles.navBadgeText}>{openEmg.length}</Text></View> : null}
                    </View>
                    {openEmg.length === 0 ? (
                      <Text style={styles.emptyLine}>Nenhuma emergência aberta. 🎉</Text>
                    ) : (
                      openEmg.slice(0, 6).map((e) => (
                        <Pressable key={e.id} onPress={() => router.push('/admin-solicitacoes')} style={styles.emgRow} testID={`desktop-emg-${e.id}`}>
                          <Ionicons name={e.kind === 'reboque' ? 'boat' : 'alert-circle'} size={18} color={colors.error} />
                          <View style={{ flex: 1 }}>
                            <Text style={styles.emgName}>{e.user_name} · {e.boat_name}</Text>
                            <Text style={styles.emgMeta}>{e.location || (e.kind === 'reboque' ? `Reboque ${e.distance_nm} MN` : 'Socorro')} • {fmtTime(e.created_at)}</Text>
                          </View>
                          <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceTertiary} />
                        </Pressable>
                      ))
                    )}
                  </View>
                </View>
              </View>

              {/* Resumo semanal */}
              <View style={[styles.panel, { marginTop: spacing.lg }]} testID="desktop-weekly">
                <View style={styles.panelHead}>
                  <Text style={styles.panelTitle}>Resumo dos últimos 7 dias</Text>
                </View>
                {(() => {
                  const maxMov = Math.max(1, ...weekly.map((w) => w.movements));
                  const maxRev = Math.max(1, ...weekly.map((w) => w.revenue));
                  return (
                    <>
                      <View style={styles.chartLegend}>
                        <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: colors.brandPrimary }]} /><Text style={styles.legendText}>Movimentações</Text></View>
                        <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: colors.success }]} /><Text style={styles.legendText}>Faturamento</Text></View>
                      </View>
                      <View style={styles.chartRow}>
                        {weekly.map((w) => (
                          <View key={w.date} style={styles.chartCol} testID={`weekly-${w.date}`}>
                            <Text style={styles.chartValTop}>{w.movements}</Text>
                            <View style={styles.barsWrap}>
                              <View style={[styles.bar, { height: Math.max(4, (w.movements / maxMov) * 120), backgroundColor: colors.brandPrimary }]} />
                              <View style={[styles.bar, { height: Math.max(4, (w.revenue / maxRev) * 120), backgroundColor: colors.success }]} />
                            </View>
                            <Text style={styles.chartDay}>{w.label}</Text>
                            <Text style={styles.chartRev}>{money(w.revenue)}</Text>
                          </View>
                        ))}
                      </View>
                    </>
                  );
                })()}
              </View>
            </>
          )}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0B1F3A' },
  shell: { flex: 1, flexDirection: 'row' },
  sidebar: { width: 250, backgroundColor: '#0B1F3A', paddingVertical: spacing.lg, borderRightWidth: 1, borderRightColor: 'rgba(255,255,255,0.08)' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)' },
  brandLogo: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.brandPrimary, alignItems: 'center', justifyContent: 'center' },
  brandName: { color: '#FFFFFF', fontSize: typography.base, fontWeight: '800' },
  brandRole: { color: colors.brandSecondary, fontSize: typography.sm, marginTop: 2 },
  navItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, marginHorizontal: spacing.sm, borderRadius: radius.md },
  navItemActive: { backgroundColor: colors.brandPrimary },
  navText: { color: '#CBD5E1', fontSize: typography.base, fontWeight: '600', flex: 1 },
  navTextActive: { color: colors.onBrandPrimary, fontWeight: '800' },
  navBadge: { backgroundColor: colors.error, borderRadius: radius.pill, minWidth: 20, height: 20, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center' },
  navBadgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  footerBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, marginHorizontal: spacing.sm, borderRadius: radius.md },
  footerText: { color: '#CBD5E1', fontSize: typography.base, fontWeight: '600' },
  main: { flex: 1, backgroundColor: colors.surface },
  mainContent: { padding: spacing.xl, paddingBottom: spacing.xxxl },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xl },
  pageTitle: { color: colors.onSurface, fontSize: 26, fontWeight: '800' },
  pageSub: { color: colors.onSurfaceSecondary, fontSize: typography.base, marginTop: 2, textTransform: 'capitalize' },
  refreshBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary },
  refreshText: { color: colors.brandPrimary, fontWeight: '700', fontSize: typography.base },
  center: { paddingVertical: spacing.xxxl, alignItems: 'center' },
  gridTop: { flexDirection: 'row', gap: spacing.lg, flexWrap: 'wrap', marginBottom: spacing.lg },
  fatCard: { flexGrow: 1, minWidth: 260, backgroundColor: colors.brandPrimary, borderRadius: radius.md, padding: spacing.xl, justifyContent: 'center' },
  fatLabel: { color: colors.brandSecondary, fontSize: typography.sm, fontWeight: '700', letterSpacing: 1 },
  fatValue: { color: colors.onBrandPrimary, fontSize: 36, fontWeight: '800', marginTop: spacing.xs },
  fatBreak: { color: colors.onBrandPrimary, opacity: 0.85, fontSize: typography.sm, marginTop: spacing.sm },
  statsWrap: { flexGrow: 2, minWidth: 320, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  statCard: { flexGrow: 1, minWidth: 100, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, alignItems: 'center', gap: 2 },
  statIcon: { width: 34, height: 34, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  statValue: { color: colors.onSurface, fontSize: typography.xxl, fontWeight: '800' },
  statLabel: { color: colors.onSurfaceSecondary, fontSize: typography.sm, fontWeight: '600' },
  columns: { flexDirection: 'row', gap: spacing.lg, flexWrap: 'wrap' },
  colWide: { flexGrow: 3, flexBasis: 420, minWidth: 320 },
  colNarrow: { flexGrow: 1, flexBasis: 280, minWidth: 260 },
  panel: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
  panelAlert: { borderColor: colors.error, borderWidth: 1.5 },
  panelHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md, gap: spacing.sm },
  panelTitle: { color: colors.onSurface, fontSize: typography.lg, fontWeight: '800', flex: 1 },
  panelLink: { color: colors.brandPrimary, fontSize: typography.base, fontWeight: '700' },
  emptyLine: { color: colors.onSurfaceSecondary, fontSize: typography.base, paddingVertical: spacing.md },
  movRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  movTime: { backgroundColor: colors.brandPrimary, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 6, minWidth: 58, alignItems: 'center' },
  movTimeText: { color: colors.onBrandPrimary, fontWeight: '800', fontSize: typography.base },
  movBoat: { color: colors.onSurface, fontSize: typography.base, fontWeight: '800' },
  movType: { color: colors.onSurfaceSecondary, fontWeight: '600' },
  movUser: { color: colors.onSurfaceSecondary, fontSize: typography.sm, marginTop: 2 },
  confirmBtn: { width: 34, height: 34, borderRadius: radius.sm, backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center' },
  emgRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  emgName: { color: colors.onSurface, fontSize: typography.base, fontWeight: '800' },
  emgMeta: { color: colors.onSurfaceSecondary, fontSize: typography.sm, marginTop: 2 },
  chartLegend: { flexDirection: 'row', gap: spacing.lg, marginBottom: spacing.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 12, height: 12, borderRadius: 3 },
  legendText: { color: colors.onSurfaceSecondary, fontSize: typography.sm, fontWeight: '600' },
  chartRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: spacing.sm },
  chartCol: { flex: 1, alignItems: 'center', gap: 4 },
  chartValTop: { color: colors.onSurfaceSecondary, fontSize: typography.sm, fontWeight: '700' },
  barsWrap: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 128 },
  bar: { width: 14, borderTopLeftRadius: 3, borderTopRightRadius: 3 },
  chartDay: { color: colors.onSurface, fontSize: typography.sm, fontWeight: '700', marginTop: 4 },
  chartRev: { color: colors.onSurfaceTertiary, fontSize: 11 },
});
