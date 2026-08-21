import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { colors, spacing, radius, typography } from '@/src/theme';
import { formatMoney as money } from '@/src/format';
import { api, isAuthValidOn, authValidityLabel, PONTO_LABELS } from '@/src/api';
import type { MarinaRequest, ConvenienceOrder, Emergency, FinanceiroEntry, Authorization, PontoEntry, PontoType } from '@/src/api';

function pad(n: number) { return n.toString().padStart(2, '0'); }
function toISO(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function labelForDate(d: Date) {
  const isToday = toISO(d) === toISO(new Date());
  const weekdays = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  return `${isToday ? 'Hoje • ' : ''}${weekdays[d.getDay()]}, ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
}
function brDate(iso?: string | null) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
const PONTO_ORDER: PontoType[] = ['entrada', 'saida_almoco', 'retorno_almoco', 'saida_final'];

export default function AdminDashboardScreen() {
  const router = useRouter();
  const [day, setDay] = useState(new Date());
  const [items, setItems] = useState<MarinaRequest[]>([]);
  const [orders, setOrders] = useState<ConvenienceOrder[]>([]);
  const [emergencies, setEmergencies] = useState<Emergency[]>([]);
  const [contasPagar, setContasPagar] = useState<FinanceiroEntry[]>([]);
  const [authorizations, setAuthorizations] = useState<Authorization[]>([]);
  const [pontoHoje, setPontoHoje] = useState<PontoEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const iso = toISO(day);

  const load = useCallback(async () => {
    const raw = await AsyncStorage.getItem('user');
    if (!raw) return router.replace('/');
    try {
      const [reqs, ords, emgs, pagar, auths, ponto] = await Promise.all([
        api.dayRequests(iso),
        api.listOrders().catch(() => []),
        api.listEmergencies().catch(() => []),
        api.listFinanceiro({ kind: 'pagar' }).catch(() => []),
        api.listAuthorizations().catch(() => []),
        api.listPonto({ date_from: iso, date_to: iso }).catch(() => []),
      ]);
      setItems(reqs);
      setOrders(ords);
      setEmergencies(emgs);
      setContasPagar(pagar);
      setAuthorizations(auths);
      setPontoHoje(ponto);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [iso, router]);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    load();
    const interval = setInterval(load, 20000);
    return () => clearInterval(interval);
  }, [load]));

  const shiftDay = (delta: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const nd = new Date(day);
    nd.setDate(nd.getDate() + delta);
    setDay(nd);
  };

  const isToday = iso === toISO(new Date());
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const toMin = (hhmm?: string | null) => {
    if (!hhmm) return null;
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  };

  const descidas = items.filter((i) => i.type === 'descida' && i.status !== 'cancelada').length;
  const subidas = items.filter((i) => i.type === 'subida' && i.status !== 'cancelada').length;
  const retornos = items.filter((i) => i.status === 'concluida').length;
  const canceladas = items.filter((i) => i.status === 'cancelada').length;
  const atrasos = items.filter((i) => {
    if (!isToday || i.type !== 'subida' || i.status === 'concluida' || i.status === 'cancelada') return false;
    const ref = toMin(i.time);
    return ref != null && nowMin > ref + 15;
  }).length;
  const aguardando = items.filter((i) => i.status === 'agendada').length;

  const convTotal = orders
    .filter((o) => o.status !== 'cancelada' && o.created_at?.startsWith(iso))
    .reduce((s, o) => s + o.total, 0);
  const reboqueTotal = emergencies
    .filter((e) => e.kind === 'reboque' && e.billed_amount != null && e.billed_at?.startsWith(iso))
    .reduce((s, e) => s + (e.billed_amount || 0), 0);
  const faturamento = convTotal + reboqueTotal;

  const stats: { label: string; value: string | number; icon: keyof typeof Ionicons.glyphMap; color: string }[] = [
    { label: 'Descidas', value: descidas, icon: 'boat', color: colors.brandPrimary },
    { label: 'Subidas', value: subidas, icon: 'arrow-up-circle', color: '#0E7490' },
    { label: 'Retornos', value: retornos, icon: 'checkmark-done-circle', color: colors.success },
    { label: 'Aguardando', value: aguardando, icon: 'hourglass', color: '#B45309' },
    { label: 'Atrasos', value: atrasos, icon: 'warning', color: colors.error },
    { label: 'Canceladas', value: canceladas, icon: 'close-circle', color: colors.onSurfaceTertiary },
  ];

  const contasPagarAbertas = contasPagar
    .filter((f) => f.status !== 'pago')
    .sort((a, b) => a.due_date.localeCompare(b.due_date));
  const contasPagarTotal = contasPagarAbertas.reduce((s, f) => s + f.amount, 0);

  const autorizacoesHoje = authorizations.filter((a) => a.status === 'ativa' && isAuthValidOn(a, iso));

  const equipeHoje = (() => {
    const byCpf = new Map<string, { cpf: string; name: string; entries: PontoEntry[] }>();
    for (const p of pontoHoje) {
      if (!byCpf.has(p.cpf)) byCpf.set(p.cpf, { cpf: p.cpf, name: p.user_name, entries: [] });
      byCpf.get(p.cpf)!.entries.push(p);
    }
    return Array.from(byCpf.values())
      .map((e) => {
        const entries = [...e.entries].sort((a, b) => a.time.localeCompare(b.time));
        const types = new Set(entries.map((x) => x.type));
        const working = types.has('entrada') && !types.has('saida_final');
        return { ...e, entries, working };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  })();

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="admin-dashboard-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={16} testID="back-button" style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.onBrandPrimary} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>RESUMO OPERACIONAL</Text>
          <Text style={styles.title} testID="dashboard-title">Dashboard do Dia</Text>
        </View>
      </View>

      <View style={styles.dateNav}>
        <Pressable onPress={() => shiftDay(-1)} testID="dash-prev-day" style={styles.navBtn} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={colors.onBrandPrimary} />
        </Pressable>
        <Text style={styles.dateLabel} testID="dashboard-date-label">{labelForDate(day)}</Text>
        <Pressable onPress={() => shiftDay(1)} testID="dash-next-day" style={styles.navBtn} hitSlop={8}>
          <Ionicons name="chevron-forward" size={22} color={colors.onBrandPrimary} />
        </Pressable>
      </View>

      <View style={styles.sheet}>
        {loading ? (
          <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
        ) : (
          <ScrollView
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
          >
            <View style={styles.faturamentoCard} testID="dashboard-faturamento">
              <View style={styles.fatIcon}><Ionicons name="cash" size={26} color="#FFFFFF" /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.fatLabel}>Faturamento do dia</Text>
                <Text style={styles.fatValue} testID="dashboard-faturamento-value">{money(faturamento)}</Text>
                <Text style={styles.fatBreak}>Conveniência {money(convTotal)} • Reboque {money(reboqueTotal)}</Text>
              </View>
            </View>

            <View style={styles.grid}>
              {stats.map((s) => (
                <View key={s.label} style={styles.statCard} testID={`dashboard-stat-${s.label}`}>
                  <View style={[styles.statIcon, { backgroundColor: s.color }]}>
                    <Ionicons name={s.icon} size={20} color="#FFFFFF" />
                  </View>
                  <Text style={[styles.statValue, s.label === 'Atrasos' && atrasos > 0 && { color: colors.error }]}>{s.value}</Text>
                  <Text style={styles.statLabel}>{s.label}</Text>
                </View>
              ))}
            </View>

            <Pressable style={styles.linkRow} testID="dashboard-open-movimentacao" onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.back(); }}>
              <Ionicons name="list-outline" size={20} color={colors.brandPrimary} />
              <Text style={styles.linkText}>Ver movimentação detalhada do dia</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
            </Pressable>
            <Pressable style={styles.linkRow} testID="dashboard-open-relatorio" onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/admin-relatorio'); }}>
              <Ionicons name="bar-chart-outline" size={20} color={colors.brandPrimary} />
              <Text style={styles.linkText}>Relatório de cobrança mensal</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
            </Pressable>

            <Text style={styles.blockKicker}>CONTAS A PAGAR</Text>
            <View style={styles.panel} testID="dashboard-contas-pagar">
              <View style={styles.panelHead}>
                <View style={{ flex: 1 }}>
                  {contasPagarAbertas.length > 0 ? <Text style={styles.panelSub}>Total em aberto: {money(contasPagarTotal)}</Text> : null}
                </View>
                <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/admin-financeiro'); }} testID="dashboard-open-financeiro">
                  <Text style={styles.panelLink}>Ver tudo</Text>
                </Pressable>
              </View>
              {contasPagarAbertas.length === 0 ? (
                <Text style={styles.emptyLine}>Nenhuma conta a pagar em aberto. 🎉</Text>
              ) : (
                contasPagarAbertas.slice(0, 5).map((f) => (
                  <View key={f.id} style={styles.pagarRow} testID={`dashboard-pagar-${f.id}`}>
                    <View style={[styles.pagarDot, f.status_display === 'atrasado' && { backgroundColor: colors.error }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle} numberOfLines={1}>{f.description}</Text>
                      <Text style={styles.rowMeta}>{f.category} • Venc. {brDate(f.due_date)}</Text>
                    </View>
                    <Text style={[styles.pagarValue, f.status_display === 'atrasado' && { color: colors.error }]}>{money(f.amount)}</Text>
                  </View>
                ))
              )}
            </View>

            <Text style={styles.blockKicker}>AUTORIZAÇÕES VIGENTES HOJE</Text>
            <View style={styles.panel} testID="dashboard-autorizacoes">
              {autorizacoesHoje.length === 0 ? (
                <Text style={styles.emptyLine}>Nenhuma autorização vigente hoje.</Text>
              ) : (
                autorizacoesHoje.slice(0, 5).map((a) => (
                  <View key={a.id} style={styles.authRow} testID={`dashboard-auth-${a.id}`}>
                    <Ionicons name="shield-checkmark" size={18} color={colors.success} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle} numberOfLines={1}>{a.person_name} · {a.boat_name}</Text>
                      <Text style={styles.rowMeta}>{a.user_name} • {authValidityLabel(a)}</Text>
                    </View>
                  </View>
                ))
              )}
            </View>

            <Text style={styles.blockKicker}>EQUIPE</Text>
            <View style={styles.panel} testID="dashboard-equipe">
              <View style={styles.panelHead}>
                <Text style={styles.panelTitle}>Funcionários no dia</Text>
                <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/admin-ponto'); }} testID="dashboard-open-ponto">
                  <Text style={styles.panelLink}>Ver tudo</Text>
                </Pressable>
              </View>
              {equipeHoje.length === 0 ? (
                <Text style={styles.emptyLine}>Nenhum ponto registrado hoje ainda.</Text>
              ) : (
                equipeHoje.map((emp) => (
                  <View key={emp.cpf} style={styles.equipeCard} testID={`dashboard-equipe-${emp.cpf}`}>
                    <View style={styles.equipeHead}>
                      <View style={[styles.equipeStatusDot, { backgroundColor: emp.working ? colors.success : colors.onSurfaceTertiary }]} />
                      <Text style={styles.rowTitle}>{emp.name}</Text>
                    </View>
                    <Text style={[styles.rowMeta, emp.working && { color: colors.success, fontWeight: '700' }]}>
                      {emp.working ? 'Trabalhando agora' : 'Expediente encerrado'}
                    </Text>
                    <View style={styles.equipePunches}>
                      {PONTO_ORDER.map((t) => {
                        const entry = emp.entries.find((e) => e.type === t);
                        return (
                          <View key={t} style={[styles.punchChip, !entry && styles.punchChipEmpty]}>
                            <Text style={[styles.punchLabel, !entry && styles.punchLabelEmpty]}>{PONTO_LABELS[t]}</Text>
                            <Text style={[styles.punchTime, !entry && styles.punchLabelEmpty]}>{entry ? entry.time : '—'}</Text>
                          </View>
                        );
                      })}
                    </View>
                  </View>
                ))
              )}
            </View>
          </ScrollView>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.brandPrimary },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.xl, paddingTop: spacing.md },
  backBtn: { padding: spacing.sm, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.08)' },
  kicker: { color: colors.brandSecondary, letterSpacing: 3, fontSize: 11, fontWeight: '700' },
  title: { color: colors.onBrandPrimary, fontSize: 24, fontWeight: '800', marginTop: 4 },
  dateNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, marginTop: spacing.lg, marginBottom: spacing.lg },
  navBtn: { width: 40, height: 40, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  dateLabel: { color: colors.onBrandPrimary, fontSize: typography.lg, fontWeight: '700' },
  sheet: { flex: 1, backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingTop: spacing.lg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  faturamentoCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.brandPrimary, borderRadius: radius.md, padding: spacing.lg, marginBottom: spacing.lg },
  fatIcon: { width: 52, height: 52, borderRadius: radius.md, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  fatLabel: { color: colors.brandSecondary, fontSize: typography.sm, fontWeight: '700', letterSpacing: 0.5 },
  fatValue: { color: colors.onBrandPrimary, fontSize: 30, fontWeight: '800', marginTop: 2 },
  fatBreak: { color: colors.onBrandPrimary, opacity: 0.85, fontSize: typography.sm, marginTop: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  statCard: { width: '31%', backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, alignItems: 'center', gap: 4 },
  statIcon: { width: 38, height: 38, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  statValue: { color: colors.onSurface, fontSize: typography.xxl, fontWeight: '800' },
  statLabel: { color: colors.onSurfaceSecondary, fontSize: typography.sm, fontWeight: '600' },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginTop: spacing.md },
  linkText: { flex: 1, color: colors.onSurface, fontSize: typography.base, fontWeight: '700' },
  blockKicker: {
    color: colors.onSurfaceTertiary,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginBottom: spacing.sm,
    marginTop: spacing.xl,
  },
  panel: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
  panelHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs, gap: spacing.sm },
  panelTitle: { color: colors.onSurface, fontSize: typography.base, fontWeight: '800', flex: 1 },
  panelSub: { color: colors.onSurfaceSecondary, fontSize: typography.sm, fontWeight: '600' },
  panelLink: { color: colors.brandPrimary, fontSize: typography.sm, fontWeight: '700' },
  emptyLine: { color: colors.onSurfaceSecondary, fontSize: typography.base, paddingVertical: spacing.sm },
  rowTitle: { color: colors.onSurface, fontSize: typography.base, fontWeight: '700' },
  rowMeta: { color: colors.onSurfaceSecondary, fontSize: typography.sm, marginTop: 2 },
  pagarRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  pagarDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#B45309' },
  pagarValue: { color: colors.onSurface, fontSize: typography.base, fontWeight: '800' },
  authRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  equipeCard: { paddingVertical: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  equipeHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  equipeStatusDot: { width: 10, height: 10, borderRadius: 5 },
  equipePunches: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  punchChip: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, minWidth: 100, alignItems: 'center' },
  punchChipEmpty: { borderStyle: 'dashed' },
  punchLabel: { color: colors.onSurfaceSecondary, fontSize: 10, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' },
  punchLabelEmpty: { color: colors.onSurfaceTertiary },
  punchTime: { color: colors.onSurface, fontSize: typography.base, fontWeight: '800', marginTop: 2 },
});
