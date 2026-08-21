import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { colors, spacing, radius, typography } from '@/src/theme';
import { formatMoney as money } from '@/src/format';
import { api } from '@/src/api';
import type { User, FaturaPreview, Fatura, FaturaBase } from '@/src/api';
import { LOGO_PNG_BASE64 } from '@/src/logoBase64';

function brDate(iso?: string | null) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export default function FaturaScreen() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [previews, setPreviews] = useState<FaturaPreview[]>([]);
  const [faturas, setFaturas] = useState<Fatura[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [generatingId, setGeneratingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const raw = await AsyncStorage.getItem('user');
    if (!raw) return router.replace('/');
    const u: User = JSON.parse(raw);
    setUser(u);
    try {
      const [prev, sent] = await Promise.all([
        api.faturaPreview(u.cpf),
        api.listFaturas(u.cpf),
      ]);
      setPreviews(prev.faturas);
      setFaturas(sent);
      const unread = sent.filter((f) => !f.read);
      for (const f of unread) api.readFatura(f.id).catch(() => {});
    } catch {
      setPreviews([]);
      setFaturas([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [router]);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  const generatePdf = async (f: FaturaBase, opts: { id: string; userName: string; sentAt?: string | null }) => {
    try {
      setGeneratingId(opts.id);

      type DetailRow = { date: string; desc: string; qty: number; unit: number; total: number };
      const rows: DetailRow[] = [];
      f.orders.forEach((o) => {
        const d = (o.created_at || '').slice(0, 10);
        o.items.forEach((i) => {
          rows.push({ date: d, desc: i.name, qty: i.qty, unit: i.price, total: i.price * i.qty });
        });
      });
      f.reboques.forEach((r) => {
        const d = (r.billed_at || '').slice(0, 10);
        rows.push({ date: d, desc: 'Reboque', qty: 1, unit: r.amount, total: r.amount });
      });
      rows.sort((a, b) => a.date.localeCompare(b.date));

      const detailRows = rows
        .map(
          (r) =>
            `<tr><td>${brDate(r.date)}</td><td>${r.desc}</td><td class="c">${r.qty}</td><td class="v">${money(r.unit)}</td><td class="v">${money(r.total)}</td></tr>`
        )
        .join('');
      const emptyRow = rows.length === 0
        ? `<tr><td colspan="5" class="empty">Nenhum consumo de conveniência ou reboque neste ciclo.</td></tr>`
        : '';

      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
        <style>
          * { font-family: -apple-system, Helvetica, Arial, sans-serif; }
          body { padding: 32px; color: #0B2545; }
          .head { display:flex; align-items:center; gap:16px; border-bottom: 3px solid #0B2545; padding-bottom:16px; margin-bottom:20px; }
          .head img { width: 120px; height: auto; }
          .head h1 { font-size: 20px; margin: 0; }
          .head p { font-size: 12px; color:#64748B; margin: 2px 0 0; }
          .meta { display:flex; justify-content:space-between; margin-bottom: 18px; }
          .meta div { font-size: 13px; }
          .meta strong { display:block; color:#94A3B8; font-size:10px; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:2px; }
          .fee-box { display:flex; justify-content:space-between; align-items:center; background:#F1F5F9; border-radius:8px; padding:12px 16px; margin-bottom:16px; }
          .fee-box .label { font-size:13px; font-weight:700; }
          .fee-box .sub { font-size:11px; color:#64748B; margin-top:2px; }
          .fee-box .val { font-size:16px; font-weight:800; }
          h3 { font-size: 13px; text-transform:uppercase; letter-spacing:0.5px; color:#64748B; margin: 18px 0 4px; }
          table { width: 100%; border-collapse: collapse; margin-top: 4px; }
          th { background:#0B2545; color:#fff; text-align:left; padding:10px; font-size:12px; }
          th.c, td.c { text-align:center; }
          th.v, td.v { text-align:right; }
          td { padding:9px 10px; border-bottom:1px solid #E2E8F0; font-size:13px; }
          td.empty { text-align:center; color:#94A3B8; font-style:italic; }
          .total { display:flex; justify-content:flex-end; margin-top:18px; }
          .total .box { background:#0B2545; color:#fff; border-radius:8px; padding:14px 22px; text-align:right; }
          .total .box span { display:block; font-size:11px; opacity:0.75; }
          .total .box strong { font-size:24px; }
          .foot { margin-top:24px; font-size:10px; color:#94A3B8; text-align:center; }
        </style></head><body>
        <div class="head">
          <img src="${LOGO_PNG_BASE64}" />
          <div>
            <h1>Fatura Mensal — Marina Pararanga</h1>
            <p>Cliente: ${opts.userName}${f.boat_name ? ` • Lancha: ${f.boat_name}` : ''}</p>
          </div>
        </div>
        <div class="meta">
          <div><strong>Período</strong>${brDate(f.period_start)} a ${brDate(f.period_end)}</div>
          <div><strong>Vencimento</strong>${brDate(f.due_date)}</div>
          <div><strong>Enviada em</strong>${opts.sentAt ? new Date(opts.sentAt).toLocaleDateString('pt-BR') : brDate(f.due_date)}</div>
        </div>
        <div class="fee-box">
          <div>
            <div class="label">Mensalidade da lancha ${f.boat_name || ''}</div>
            <div class="sub">Referente ao período de ${brDate(f.period_start)} a ${brDate(f.period_end)}</div>
          </div>
          <div class="val">${money(f.mensalidade)}</div>
        </div>
        <h3>Consumo detalhado (conveniência e reboque)</h3>
        <table>
          <thead><tr><th>Data</th><th>Item</th><th class="c">Qtd</th><th class="v">Valor unit.</th><th class="v">Valor</th></tr></thead>
          <tbody>
            ${detailRows}
            ${emptyRow}
          </tbody>
        </table>
        <div class="total">
          <div class="box"><span>Total da fatura</span><strong>${money(f.total)}</strong></div>
        </div>
        <p class="foot">Marina Pararanga — Documento gerado automaticamente em ${new Date().toLocaleString('pt-BR')}.</p>
        </body></html>`;

      const { uri } = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: `Fatura ${f.boat_name || ''}` });
      } else {
        await Print.printAsync({ uri });
      }
    } catch {
      Alert.alert('Erro', 'Não foi possível gerar o PDF da fatura.');
    } finally {
      setGeneratingId(null);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']} testID="fatura-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={16} testID="back-button">
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Minha Fatura</Text>
          <Text style={styles.subtitle}>Mensalidade, conveniência e reboques</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
        >
          <Text style={styles.sectionLabel}>Ciclo atual</Text>
          {previews.length === 0 ? (
            <Text style={styles.empty}>Nenhuma lancha com mensalidade configurada. Fale com a administração da marina.</Text>
          ) : (
            previews.map((f) => (
              <View key={f.boat_name} style={styles.bigCard} testID={`fatura-preview-${f.boat_name}`}>
                <Text style={styles.bigBoat}>{f.boat_name}</Text>
                <Text style={styles.bigLabel}>Total do ciclo (fecha em {brDate(f.due_date)})</Text>
                <Text style={styles.bigValue}>{money(f.total)}</Text>
                <View style={styles.splitRow}>
                  <Text style={styles.splitText}>Mensalidade: {money(f.mensalidade)}</Text>
                  <Text style={styles.splitText}>Conveniência: {money(f.convenience_total)}</Text>
                  <Text style={styles.splitText}>Reboque: {money(f.reboque_total)}</Text>
                </View>
                <Text style={styles.sendNote}>
                  <Ionicons name="mail-outline" size={13} color={colors.onBrandPrimary} /> Enviada em PDF 2 dias antes do vencimento, em dia útil (previsão: {brDate(f.send_date)}).
                </Text>
              </View>
            ))
          )}

          <Text style={styles.sectionLabel}>Faturas enviadas</Text>
          {faturas.length === 0 ? (
            <Text style={styles.empty}>Nenhuma fatura enviada ainda.</Text>
          ) : (
            faturas.map((f) => (
              <View key={f.id} style={styles.card} testID={`fatura-${f.id}`}>
                <View style={styles.cardTop}>
                  <View>
                    <Text style={styles.cardMonth}>{f.boat_name}</Text>
                    <Text style={styles.cardMeta}>Venc. {brDate(f.due_date)} • Enviada {new Date(f.sent_at).toLocaleDateString('pt-BR')}</Text>
                  </View>
                  <Text style={styles.cardTotal}>{money(f.total)}</Text>
                </View>
                <Text style={styles.cardInfo}>Mensalidade {money(f.mensalidade)} + Conveniência {money(f.convenience_total)} + Reboque {money(f.reboque_total)}</Text>
                <Pressable
                  testID={`fatura-pdf-${f.id}`}
                  style={styles.pdfBtn}
                  onPress={() => generatePdf(f, { id: f.id, userName: f.user_name, sentAt: f.sent_at })}
                  disabled={generatingId === f.id}
                >
                  {generatingId === f.id ? (
                    <ActivityIndicator color={colors.onBrandPrimary} size="small" />
                  ) : (
                    <>
                      <Ionicons name="document-text-outline" size={16} color={colors.onBrandPrimary} />
                      <Text style={styles.pdfBtnText}>Baixar PDF</Text>
                    </>
                  )}
                </Pressable>
              </View>
            ))
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
  sectionLabel: { color: colors.brandPrimary, fontWeight: '700', fontSize: typography.sm, letterSpacing: 1, textTransform: 'uppercase', marginBottom: spacing.md, marginTop: spacing.sm },
  bigCard: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, padding: spacing.xl, marginBottom: spacing.lg },
  bigBoat: { color: colors.onBrandPrimary, fontSize: typography.base, fontWeight: '700', opacity: 0.9 },
  bigLabel: { color: colors.brandSecondary, fontSize: typography.sm, fontWeight: '700', marginTop: 4 },
  bigValue: { color: colors.onBrandPrimary, fontSize: 32, fontWeight: '800', marginTop: 2 },
  splitRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.md },
  splitText: { color: colors.onBrandPrimary, opacity: 0.9, fontSize: typography.sm, fontWeight: '600' },
  sendNote: { color: colors.onBrandPrimary, opacity: 0.85, fontSize: typography.sm, marginTop: spacing.md },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.sm },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardMonth: { color: colors.onSurface, fontSize: typography.lg, fontWeight: '800' },
  cardMeta: { color: colors.onSurfaceSecondary, fontSize: typography.sm, marginTop: 2 },
  cardTotal: { color: colors.brandPrimary, fontSize: typography.lg, fontWeight: '800' },
  cardInfo: { color: colors.onSurfaceSecondary, fontSize: typography.sm, marginTop: spacing.sm, marginBottom: spacing.sm },
  pdfBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, backgroundColor: colors.brandPrimary, borderRadius: radius.sm, paddingVertical: spacing.sm, marginTop: spacing.xs },
  pdfBtnText: { color: colors.onBrandPrimary, fontSize: typography.sm, fontWeight: '700' },
  empty: { color: colors.onSurfaceSecondary, fontSize: typography.base, textAlign: 'center', marginTop: spacing.md, marginBottom: spacing.lg },
});
