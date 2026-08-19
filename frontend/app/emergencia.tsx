import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Pressable,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { colors, spacing, radius, typography } from '@/src/theme';
import { SelectField } from '@/src/components/SelectField';
import { api, boatName } from '@/src/api';
import type { User, Emergency, Boat } from '@/src/api';

import { formatMoney as money } from '@/src/format';

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// Espelha a tabela do backend
function reboqueQuote(lengthFeet: number | null | undefined, distanceNm: number) {
  const feet = lengthFeet || 0;
  let base = 2500, perNm = 250;
  if (feet <= 25) { base = 1200; perNm = 120; }
  else if (feet <= 35) { base = 1800; perNm = 180; }
  const additionalNm = Math.max(0, distanceNm - 5);
  const additionalFee = Math.round(additionalNm * perNm * 100) / 100;
  const total = Math.round((base + additionalFee) * 100) / 100;
  return { base, perNm, additionalNm, additionalFee, total };
}

function boatLength(boats: Boat[] | undefined, name: string | null): number | null {
  if (!boats || !name) return null;
  const b = boats.find((x) => boatName(x) === name);
  return (b && typeof b === 'object' ? (b as any).length : null) ?? null;
}

export default function EmergenciaScreen() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [tab, setTab] = useState<'socorro' | 'reboque'>('socorro');
  const [location, setLocation] = useState('');
  const [observation, setObservation] = useState('');
  const [list, setList] = useState<Emergency[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  // reboque
  const [boat, setBoat] = useState<string | null>(null);
  const [distance, setDistance] = useState('');
  const [rebLocation, setRebLocation] = useState('');
  const [rebObs, setRebObs] = useState('');

  const loadList = useCallback(async (cpf: string) => {
    try {
      setList(await api.listEmergencies(cpf));
    } catch {
      setList([]);
    }
  }, []);

  const boot = useCallback(async () => {
    const raw = await AsyncStorage.getItem('user');
    if (!raw) return router.replace('/');
    const u: User = JSON.parse(raw);
    setUser(u);
    const boats = u.boats && u.boats.length ? u.boats.map(boatName) : [u.boat_name];
    if (boats.length) setBoat(boats[0]);
    await loadList(u.cpf);
    setLoading(false);
  }, [router, loadList]);

  useEffect(() => { boot(); }, [boot]);
  useFocusEffect(useCallback(() => { if (user) loadList(user.cpf); }, [user, loadList]));

  const boatOptions = user?.boats && user.boats.length ? user.boats.map(boatName) : user ? [user.boat_name] : [];
  const selectedLength = boatLength(user?.boats, boat);
  const distNum = parseFloat(distance.replace(',', '.'));
  const quote = useMemo(
    () => (!isNaN(distNum) && distNum > 0 ? reboqueQuote(selectedLength, distNum) : null),
    [selectedLength, distNum]
  );

  const dispatchSocorro = async () => {
    if (!user) return;
    const firstBoat = user.boats && user.boats.length ? boatName(user.boats[0]) : user.boat_name;
    try {
      setSending(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      await api.createEmergency({
        cpf: user.cpf,
        boat_name: firstBoat,
        location: location.trim() || null,
        observation: observation.trim() || null,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setLocation('');
      setObservation('');
      await loadList(user.cpf);
      Alert.alert('Emergência enviada', 'A equipe da marina foi notificada e entrará em contato.');
    } catch (e: any) {
      Alert.alert('Erro', e.message || 'Não foi possível enviar a emergência.');
    } finally {
      setSending(false);
    }
  };

  const confirmSocorro = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    Alert.alert(
      'Acionar emergência?',
      'A equipe da marina será notificada imediatamente com seus dados e da sua lancha.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Acionar', style: 'destructive', onPress: dispatchSocorro },
      ]
    );
  };

  const dispatchReboque = async () => {
    if (!user || !boat || !quote) return;
    try {
      setSending(true);
      await api.createReboque({
        cpf: user.cpf,
        boat_name: boat,
        distance_nm: distNum,
        location: rebLocation.trim() || null,
        observation: rebObs.trim() || null,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setDistance('');
      setRebLocation('');
      setRebObs('');
      await loadList(user.cpf);
      Alert.alert('Reboque solicitado', 'A equipe da marina foi notificada. O valor final será lançado na sua conta.');
    } catch (e: any) {
      Alert.alert('Erro', e.message || 'Não foi possível solicitar o reboque.');
    } finally {
      setSending(false);
    }
  };

  const confirmReboque = () => {
    if (!boat) { Alert.alert('Selecione a lancha'); return; }
    if (!quote) { Alert.alert('Informe a distância', 'Digite a distância em milhas náuticas.'); return; }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      'Confirmar reboque?',
      `Valor estimado: ${money(quote.total)}\n\nApós a confirmação, a equipe será acionada e o valor final será lançado na sua conta.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Confirmar', onPress: dispatchReboque },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']} testID="emergencia-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={16} testID="back-button">
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Emergência</Text>
          <Text style={styles.subtitle}>Acione a equipe da marina</Text>
        </View>
      </View>

      <View style={styles.tabs}>
        <Pressable testID="tab-socorro" onPress={() => { setTab('socorro'); Haptics.selectionAsync(); }} style={[styles.tab, tab === 'socorro' && styles.tabActive]}>
          <Ionicons name="alert-circle-outline" size={18} color={tab === 'socorro' ? colors.onBrandPrimary : colors.onSurfaceSecondary} />
          <Text style={[styles.tabText, tab === 'socorro' && styles.tabTextActive]}>Socorro</Text>
        </Pressable>
        <Pressable testID="tab-reboque" onPress={() => { setTab('reboque'); Haptics.selectionAsync(); }} style={[styles.tab, tab === 'reboque' && styles.tabActive]}>
          <Ionicons name="boat-outline" size={18} color={tab === 'reboque' ? colors.onBrandPrimary : colors.onSurfaceSecondary} />
          <Text style={[styles.tabText, tab === 'reboque' && styles.tabTextActive]}>Reboque</Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={20}>
        {loading ? (
          <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
        ) : (
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {tab === 'socorro' ? (
              <>
                <Pressable testID="emergencia-button" onPress={confirmSocorro} disabled={sending} style={({ pressed }) => [styles.sosButton, pressed && { opacity: 0.9 }]}>
                  {sending ? (
                    <ActivityIndicator color="#FFFFFF" size="large" />
                  ) : (
                    <>
                      <Ionicons name="alert-circle" size={56} color="#FFFFFF" />
                      <Text style={styles.sosText}>ACIONAR EMERGÊNCIA</Text>
                      <Text style={styles.sosSub}>Toque para notificar a marina</Text>
                    </>
                  )}
                </Pressable>
                <View style={styles.fieldGroup}>
                  <Text style={styles.label}>Localização (opcional)</Text>
                  <TextInput testID="emergencia-location" style={styles.input} value={location} onChangeText={setLocation} placeholder="Ex.: Próximo à Ilha do Campeche" placeholderTextColor={colors.onSurfaceTertiary} />
                </View>
                <View style={styles.fieldGroup}>
                  <Text style={styles.label}>Descrição (opcional)</Text>
                  <TextInput testID="emergencia-observation" style={[styles.input, styles.textarea]} value={observation} onChangeText={setObservation} placeholder="O que está acontecendo?" placeholderTextColor={colors.onSurfaceTertiary} multiline textAlignVertical="top" />
                </View>
              </>
            ) : (
              <>
                <SelectField testID="reboque-boat-select" label="Lancha" value={boat} options={boatOptions} onChange={setBoat} placeholder="Selecione a lancha" />
                <Text style={styles.hint}>
                  {selectedLength != null ? `Comprimento: ${selectedLength} pés` : 'Comprimento não cadastrado — usando maior faixa.'}
                </Text>
                <View style={styles.fieldGroup}>
                  <Text style={styles.label}>Distância total (milhas náuticas)</Text>
                  <TextInput testID="reboque-distance" style={styles.input} value={distance} onChangeText={(v) => setDistance(v.replace(/[^\d.,]/g, ''))} placeholder="Ex.: 8" placeholderTextColor={colors.onSurfaceTertiary} keyboardType="decimal-pad" />
                  <Text style={styles.hint}>As primeiras 5 MN estão inclusas na taxa de atendimento.</Text>
                </View>

                {quote ? (
                  <View style={styles.quoteCard} testID="reboque-quote">
                    <View style={styles.quoteRow}><Text style={styles.quoteLabel}>Taxa de atendimento (até 5 MN)</Text><Text style={styles.quoteVal}>{money(quote.base)}</Text></View>
                    <View style={styles.quoteRow}><Text style={styles.quoteLabel}>Adicional ({quote.additionalNm} MN × {money(quote.perNm)})</Text><Text style={styles.quoteVal}>{money(quote.additionalFee)}</Text></View>
                    <View style={styles.quoteDivider} />
                    <View style={styles.quoteRow}><Text style={styles.quoteTotalLabel}>Valor estimado</Text><Text style={styles.quoteTotalVal} testID="reboque-total">{money(quote.total)}</Text></View>
                  </View>
                ) : null}

                <View style={styles.fieldGroup}>
                  <Text style={styles.label}>Localização (opcional)</Text>
                  <TextInput testID="reboque-location" style={styles.input} value={rebLocation} onChangeText={setRebLocation} placeholder="Onde você está?" placeholderTextColor={colors.onSurfaceTertiary} />
                </View>
                <View style={styles.fieldGroup}>
                  <Text style={styles.label}>Observação (opcional)</Text>
                  <TextInput testID="reboque-observation" style={[styles.input, styles.textarea]} value={rebObs} onChangeText={setRebObs} placeholder="Detalhes da situação" placeholderTextColor={colors.onSurfaceTertiary} multiline textAlignVertical="top" />
                </View>
                <Pressable testID="reboque-submit" onPress={confirmReboque} disabled={sending} style={({ pressed }) => [styles.reboqueBtn, pressed && { opacity: 0.9 }]}>
                  {sending ? <ActivityIndicator color="#FFFFFF" /> : <><Ionicons name="boat" size={20} color="#FFFFFF" /><Text style={styles.reboqueBtnText}>Solicitar reboque</Text></>}
                </Pressable>
              </>
            )}

            {list.length > 0 ? (
              <>
                <Text style={styles.sectionLabel}>Meus acionamentos</Text>
                {list.map((e) => {
                  const isReboque = e.kind === 'reboque';
                  return (
                    <View key={e.id} style={styles.card} testID={`emergency-${e.id}`}>
                      <View style={[styles.dot, { backgroundColor: e.status === 'aberta' ? colors.error : colors.success }]} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.cardTitle}>
                          {isReboque ? 'Reboque' : 'Socorro'} • {e.status === 'aberta' ? 'Em atendimento' : 'Atendido'}
                        </Text>
                        <Text style={styles.cardMeta}>{formatDateTime(e.created_at)}{e.boat_name ? ` • ${e.boat_name}` : ''}</Text>
                        {isReboque ? (
                          <Text style={styles.cardMeta}>
                            {e.billed_amount != null
                              ? `Valor cobrado: ${money(e.billed_amount)}`
                              : `Estimado: ${money(e.estimated_total || 0)} (aguardando cobrança)`}
                          </Text>
                        ) : null}
                        {e.location ? <Text style={styles.cardMeta}>Local: {e.location}</Text> : null}
                      </View>
                    </View>
                  );
                })}
              </>
            ) : null}
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg, gap: spacing.md },
  title: { color: colors.onSurface, fontSize: typography.xxl, fontWeight: '800' },
  subtitle: { color: colors.onSurfaceSecondary, fontSize: typography.sm, marginTop: 2 },
  tabs: { flexDirection: 'row', gap: spacing.sm, marginHorizontal: spacing.lg, marginBottom: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.xs },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingVertical: spacing.md, borderRadius: radius.sm },
  tabActive: { backgroundColor: colors.brandPrimary },
  tabText: { color: colors.onSurfaceSecondary, fontSize: typography.base, fontWeight: '700' },
  tabTextActive: { color: colors.onBrandPrimary },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.lg, paddingBottom: 120 },
  sosButton: { backgroundColor: colors.error, borderRadius: radius.lg, paddingVertical: spacing.xxl, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xl, minHeight: 200 },
  sosText: { color: '#FFFFFF', fontSize: typography.xl, fontWeight: '800', marginTop: spacing.md, letterSpacing: 1 },
  sosSub: { color: '#FFFFFF', opacity: 0.85, fontSize: typography.base, marginTop: spacing.xs },
  fieldGroup: { marginBottom: spacing.lg },
  label: { color: colors.onSurface, fontSize: typography.base, fontWeight: '600', marginBottom: spacing.sm },
  hint: { color: colors.onSurfaceTertiary, fontSize: typography.sm, marginTop: spacing.xs, marginBottom: spacing.sm },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.lg, fontSize: typography.lg, color: colors.onSurface, backgroundColor: colors.surfaceSecondary },
  textarea: { minHeight: 90 },
  quoteCard: { backgroundColor: '#EFF6FF', borderRadius: radius.md, borderWidth: 1, borderColor: '#BFDBFE', padding: spacing.lg, marginBottom: spacing.lg },
  quoteRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 3 },
  quoteLabel: { color: colors.onSurfaceSecondary, fontSize: typography.base, flex: 1 },
  quoteVal: { color: colors.onSurface, fontSize: typography.base, fontWeight: '700' },
  quoteDivider: { height: 1, backgroundColor: '#BFDBFE', marginVertical: spacing.sm },
  quoteTotalLabel: { color: colors.brandPrimary, fontSize: typography.lg, fontWeight: '800' },
  quoteTotalVal: { color: colors.brandPrimary, fontSize: typography.xl, fontWeight: '800' },
  reboqueBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, backgroundColor: colors.brandPrimary, paddingVertical: spacing.lg, borderRadius: radius.md },
  reboqueBtnText: { color: '#FFFFFF', fontSize: typography.lg, fontWeight: '700' },
  sectionLabel: { color: colors.brandPrimary, fontWeight: '700', fontSize: typography.sm, letterSpacing: 1, textTransform: 'uppercase', marginBottom: spacing.md, marginTop: spacing.xl },
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
  cardTitle: { color: colors.onSurface, fontSize: typography.lg, fontWeight: '700' },
  cardMeta: { color: colors.onSurfaceSecondary, fontSize: typography.sm, marginTop: 2 },
});
