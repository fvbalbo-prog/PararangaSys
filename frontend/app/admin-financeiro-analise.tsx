import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, spacing, radius, typography } from '@/src/theme';
import { formatMoney } from '@/src/format';
import { api } from '@/src/api';
import type { AnaliseFinanceira, AnaliseMes } from '@/src/api';
import { DateField } from '@/src/components/DateField';
import { AppDialog, type DialogButton } from '@/src/components/AppDialog';

type PeriodMode = 'mes' | 'ano' | 'personalizado';

// Paleta categórica validada (ordem fixa — nunca ciclada por rank).
// Ref: skill de dataviz — 8 slots, ordem só passa nos testes de daltonismo nesta sequência.
const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
// "Outros" sempre no slot 6 (verde) em qualquer lado — mesma categoria, mesma cor em todo o app.
const CATEGORY_COLOR: Record<string, string> = {
  Mensalidade: PALETTE[0],
  Reboque: PALETTE[1],
  Conveniência: PALETTE[2],
  Serviços: PALETTE[3],
  Fornecedores: PALETTE[0],
  Manutenção: PALETTE[1],
  Salários: PALETTE[2],
  Utilidades: PALETTE[3],
  Impostos: PALETTE[4],
  Outros: PALETTE[5],
};
function colorFor(category: string, fallbackIndex: number): string {
  return CATEGORY_COLOR[category] || PALETTE[fallbackIndex % PALETTE.length];
}
const RECEITA_COLOR = PALETTE[5]; // verde
const DESPESA_COLOR = PALETTE[7]; // vermelho

function pad(n: number) {
  return n.toString().padStart(2, '0');
}
function dateToISO(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function currentYM() {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}
function labelForMonth(year: number, month: number) {
  const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  return `${MONTHS[month - 1]} ${year}`;
}
const MONTH_SHORT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
function monthLabel(ym: string) {
  const [, m] = ym.split('-');
  return MONTH_SHORT[parseInt(m, 10) - 1];
}

function CategoryBar({ item, max, index }: { item: { category: string; total: number }; max: number; index: number }) {
  const pct = max > 0 ? Math.max((item.total / max) * 100, 4) : 4;
  const color = colorFor(item.category, index);
  return (
    <View style={styles.barRow} testID={`analise-cat-${item.category}`}>
      <View style={styles.barLabelRow}>
        <View style={[styles.barDot, { backgroundColor: color }]} />
        <Text style={styles.barLabel} numberOfLines={1}>{item.category}</Text>
        <Text style={styles.barValue}>{formatMoney(item.total)}</Text>
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

export default function AdminFinanceiroAnaliseScreen() {
  const router = useRouter();
  const [mode, setMode] = useState<PeriodMode>('mes');
  const [{ year, month }, setYm] = useState(currentYM());
  const [customFrom, setCustomFrom] = useState<Date | null>(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [customTo, setCustomTo] = useState<Date | null>(new Date());
  const [data, setData] = useState<AnaliseFinanceira | null>(null);
  const [loading, setLoading] = useState(true);

  const [dialog, setDialog] = useState<{ title: string; message?: string; buttons: DialogButton[] } | null>(null);
  const closeDialog = () => setDialog(null);

  const { dateFrom, dateTo } = useMemo(() => {
    if (mode === 'mes') {
      const last = new Date(year, month, 0).getDate();
      return { dateFrom: `${year}-${pad(month)}-01`, dateTo: `${year}-${pad(month)}-${pad(last)}` };
    }
    if (mode === 'ano') {
      return { dateFrom: `${year}-01-01`, dateTo: `${year}-12-31` };
    }
    return {
      dateFrom: customFrom ? dateToISO(customFrom) : dateToISO(new Date()),
      dateTo: customTo ? dateToISO(customTo) : dateToISO(new Date()),
    };
  }, [mode, year, month, customFrom, customTo]);

  const load = useCallback(async () => {
    try {
      setData(await api.analiseFinanceira(dateFrom, dateTo));
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  const shiftPeriod = (delta: number) => {
    Haptics.selectionAsync();
    if (mode === 'ano') {
      setYm((p) => ({ ...p, year: p.year + delta }));
      return;
    }
    setYm((p) => {
      let m = p.month + delta, y = p.year;
      if (m < 1) { m = 12; y -= 1; }
      if (m > 12) { m = 1; y += 1; }
      return { year: y, month: m };
    });
  };

  const periodLabel = mode === 'mes' ? labelForMonth(year, month) : mode === 'ano' ? `${year}` : `${dateFrom.split('-').reverse().join('/')} – ${dateTo.split('-').reverse().join('/')}`;

  const maxReceber = data ? Math.max(...data.receber.by_category.map((c) => c.total), 1) : 1;
  const maxPagar = data ? Math.max(...data.pagar.by_category.map((c) => c.total), 1) : 1;
  const maxMonthValue = data ? Math.max(...data.by_month.flatMap((m) => [m.pagar, m.receber]), 1) : 1;

  const showMonthDetail = (m: AnaliseMes) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setDialog({
      title: `${monthLabel(m.month)}/${m.month.split('-')[0]}`,
      message: `Receitas: ${formatMoney(m.receber)}\nDespesas: ${formatMoney(m.pagar)}\nSaldo: ${formatMoney(m.receber - m.pagar)}`,
      buttons: [{ label: 'OK', variant: 'primary', onPress: closeDialog }],
    });
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="admin-financeiro-analise-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={16} testID="back-button">
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} testID="analise-title">Análise Financeira</Text>
          <Text style={styles.subtitle}>Receitas e despesas por categoria</Text>
        </View>
      </View>

      <View style={styles.modeToggle}>
        {([['mes', 'Mês'], ['ano', 'Ano'], ['personalizado', 'Período']] as [PeriodMode, string][]).map(([key, label]) => (
          <Pressable
            key={key}
            testID={`analise-mode-${key}`}
            onPress={() => { setMode(key); Haptics.selectionAsync(); }}
            style={[styles.modeBtn, mode === key && styles.modeBtnActive]}
          >
            <Text style={[styles.modeText, mode === key && styles.modeTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {mode === 'personalizado' ? (
        <View style={styles.customRow}>
          <View style={{ flex: 1 }}>
            <DateField testID="analise-date-from" label="De" mode="date" value={customFrom} onChange={setCustomFrom} />
          </View>
          <View style={{ width: spacing.md }} />
          <View style={{ flex: 1 }}>
            <DateField testID="analise-date-to" label="Até" mode="date" value={customTo} onChange={setCustomTo} />
          </View>
        </View>
      ) : (
        <View style={styles.periodNav}>
          <Pressable onPress={() => shiftPeriod(-1)} testID="analise-prev" style={styles.navBtn} hitSlop={8}>
            <Ionicons name="chevron-back" size={20} color={colors.onSurface} />
          </Pressable>
          <Text style={styles.periodLabel} testID="analise-period-label">{periodLabel}</Text>
          <Pressable onPress={() => shiftPeriod(1)} testID="analise-next" style={styles.navBtn} hitSlop={8}>
            <Ionicons name="chevron-forward" size={20} color={colors.onSurface} />
          </Pressable>
        </View>
      )}

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
      ) : !data ? (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>Não foi possível carregar a análise.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.statsRow}>
            <View style={[styles.statCard, { backgroundColor: '#ECFDF5' }]}>
              <Text style={[styles.statValue, { color: colors.success }]}>{formatMoney(data.receber.total)}</Text>
              <Text style={styles.statLabel}>Receitas</Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: '#FEF2F2' }]}>
              <Text style={[styles.statValue, { color: colors.error }]}>{formatMoney(data.pagar.total)}</Text>
              <Text style={styles.statLabel}>Despesas</Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: colors.surfaceSecondary }]}>
              <Text style={[styles.statValue, { color: data.saldo >= 0 ? colors.success : colors.error }]}>{formatMoney(data.saldo)}</Text>
              <Text style={styles.statLabel}>Saldo</Text>
            </View>
          </View>

          {data.by_month.length > 1 ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Evolução no período</Text>
              <View style={styles.legendRow}>
                <View style={styles.legendItem}><View style={[styles.barDot, { backgroundColor: RECEITA_COLOR }]} /><Text style={styles.legendText}>Receitas</Text></View>
                <View style={styles.legendItem}><View style={[styles.barDot, { backgroundColor: DESPESA_COLOR }]} /><Text style={styles.legendText}>Despesas</Text></View>
              </View>
              <View style={styles.chartArea}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.monthChart}>
                    {data.by_month.map((m) => (
                      <Pressable key={m.month} testID={`analise-month-${m.month}`} onPress={() => showMonthDetail(m)} style={styles.monthGroup}>
                        <View style={styles.monthBars}>
                          <View style={[styles.monthBar, { height: Math.max((m.receber / maxMonthValue) * 100, 2), backgroundColor: RECEITA_COLOR }]} />
                          <View style={[styles.monthBar, { height: Math.max((m.pagar / maxMonthValue) * 100, 2), backgroundColor: DESPESA_COLOR, marginLeft: 3 }]} />
                        </View>
                        <Text style={styles.monthAxisLabel}>{monthLabel(m.month)}</Text>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>
              </View>
            </View>
          ) : null}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Receitas por categoria</Text>
            {data.receber.by_category.length === 0 ? (
              <Text style={styles.emptyText}>Nenhuma receita neste período.</Text>
            ) : (
              data.receber.by_category.map((c, i) => <CategoryBar key={c.category} item={c} max={maxReceber} index={i} />)
            )}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Despesas por categoria</Text>
            {data.pagar.by_category.length === 0 ? (
              <Text style={styles.emptyText}>Nenhuma despesa neste período.</Text>
            ) : (
              data.pagar.by_category.map((c, i) => <CategoryBar key={c.category} item={c} max={maxPagar} index={i} />)
            )}
          </View>
        </ScrollView>
      )}

      <AppDialog visible={!!dialog} title={dialog?.title || ''} message={dialog?.message} buttons={dialog?.buttons || []} onRequestClose={closeDialog} testID="analise-dialog" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg, gap: spacing.md },
  title: { color: colors.onSurface, fontSize: typography.xxl, fontWeight: '800' },
  subtitle: { color: colors.onSurfaceSecondary, fontSize: typography.sm, marginTop: 2 },
  modeToggle: {
    flexDirection: 'row', gap: spacing.sm, marginHorizontal: spacing.lg, marginBottom: spacing.md,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.xs,
  },
  modeBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.md, borderRadius: radius.sm },
  modeBtnActive: { backgroundColor: colors.brandPrimary },
  modeText: { color: colors.onSurfaceSecondary, fontSize: typography.sm, fontWeight: '700' },
  modeTextActive: { color: colors.onBrandPrimary },
  customRow: { flexDirection: 'row', paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  periodNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, marginBottom: spacing.md },
  navBtn: { width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, alignItems: 'center', justifyContent: 'center' },
  periodLabel: { color: colors.onSurface, fontSize: typography.lg, fontWeight: '700', textTransform: 'capitalize' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  emptyTitle: { color: colors.onSurface, fontSize: typography.lg, fontWeight: '700' },
  emptyText: { color: colors.onSurfaceSecondary, fontSize: typography.base },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.xl },
  statsRow: { flexDirection: 'row', gap: spacing.sm },
  statCard: { flex: 1, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' },
  statValue: { fontSize: typography.base, fontWeight: '800' },
  statLabel: { color: colors.onSurfaceSecondary, fontSize: 11, marginTop: 2, fontWeight: '600' },
  section: { gap: spacing.sm },
  sectionTitle: { color: colors.onSurface, fontSize: typography.lg, fontWeight: '800' },
  legendRow: { flexDirection: 'row', gap: spacing.lg, marginBottom: spacing.xs },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  legendText: { color: colors.onSurfaceSecondary, fontSize: typography.sm, fontWeight: '600' },
  chartArea: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.lg },
  monthChart: { flexDirection: 'row', alignItems: 'flex-end', height: 140, gap: spacing.md },
  monthGroup: { alignItems: 'center', width: 44 },
  monthBars: { flexDirection: 'row', alignItems: 'flex-end', height: 110 },
  monthBar: { width: 10, borderTopLeftRadius: 3, borderTopRightRadius: 3 },
  monthAxisLabel: { color: colors.onSurfaceTertiary, fontSize: 11, fontWeight: '600', marginTop: spacing.xs },
  barRow: { gap: 6 },
  barLabelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  barDot: { width: 10, height: 10, borderRadius: 5 },
  barLabel: { flex: 1, color: colors.onSurface, fontSize: typography.base, fontWeight: '600' },
  barValue: { color: colors.onSurfaceSecondary, fontSize: typography.sm, fontWeight: '700' },
  barTrack: { height: 10, backgroundColor: colors.divider, borderRadius: 5, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 5 },
});
