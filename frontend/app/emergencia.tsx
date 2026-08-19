import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { colors, spacing, radius, typography } from '@/src/theme';
import { SelectField } from '@/src/components/SelectField';
import { AppDialog, type DialogButton } from '@/src/components/AppDialog';
import { api, boatName } from '@/src/api';
import type { User, Emergency, Boat, ReboqueQuote } from '@/src/api';

import { formatMoney as money } from '@/src/format';

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function boatLength(boats: Boat[] | undefined, name: string | null): number | null {
  if (!boats || !name) return null;
  const b = boats.find((x) => boatName(x) === name);
  return (b && typeof b === 'object' ? (b as any).length : null) ?? null;
}

export default function EmergenciaScreen() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [reboque, setReboque] = useState<'sim' | 'nao'>('nao');
  const [location, setLocation] = useState('');
  const [observation, setObservation] = useState('');
  const [list, setList] = useState<Emergency[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  // reboque (GPS)
  const [boat, setBoat] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [quote, setQuote] = useState<ReboqueQuote | null>(null);
  const [locating, setLocating] = useState(false);
  const [dialog, setDialog] = useState<{ title: string; message?: string; buttons: DialogButton[] } | null>(null);
  const closeDialog = () => setDialog(null);
  const showInfo = (title: string, message?: string) =>
    setDialog({ title, message, buttons: [{ label: 'OK', variant: 'primary', onPress: () => setDialog(null) }] });

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

  const fetchQuote = useCallback(async (lat: number, lng: number) => {
    try {
      const q = await api.reboqueQuote({ length: selectedLength ?? 999, client_lat: lat, client_lng: lng });
      setQuote(q);
    } catch {
      setQuote(null);
    }
  }, [selectedLength]);

  const getLocation = async () => {
    Haptics.selectionAsync();
    try {
      const perm = await Location.getForegroundPermissionsAsync();
      let status = perm.status;
      if (status !== 'granted') {
        if (perm.canAskAgain) {
          const req = await Location.requestForegroundPermissionsAsync();
          status = req.status;
        }
        if (status !== 'granted') {
          setDialog({
            title: 'Permissão de localização',
            message: 'Precisamos da sua localização para calcular a distância do reboque. Autorize o acesso à localização para continuar.',
            buttons: [
              { label: 'Agora não', variant: 'cancel', onPress: closeDialog },
              { label: 'Abrir Ajustes', variant: 'primary', onPress: () => { closeDialog(); Linking.openSettings().catch(() => {}); } },
            ],
          });
          return;
        }
      }
      setLocating(true);
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      setCoords({ lat, lng });
      await fetchQuote(lat, lng);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      showInfo('Não foi possível obter a localização', 'Verifique se o GPS/localização está ativado e tente novamente.');
    } finally {
      setLocating(false);
    }
  };

  // Recalcula ao trocar de lancha (se já tem localização)
  useEffect(() => {
    if (coords) fetchQuote(coords.lat, coords.lng);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boat]);

  const dispatchSend = async () => {
    if (!user) return;
    const firstBoat = boat || (user.boats && user.boats.length ? boatName(user.boats[0]) : user.boat_name);
    try {
      setSending(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      if (reboque === 'sim' && coords) {
        await api.createReboque({
          cpf: user.cpf,
          boat_name: firstBoat,
          client_lat: coords.lat,
          client_lng: coords.lng,
          location: location.trim(),
          observation: observation.trim() || null,
        });
      } else {
        await api.createEmergency({
          cpf: user.cpf,
          boat_name: firstBoat,
          location: location.trim(),
          observation: observation.trim() || null,
        });
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setLocation('');
      setObservation('');
      setReboque('nao');
      setCoords(null);
      setQuote(null);
      await loadList(user.cpf);
      showInfo(
        reboque === 'sim' ? 'Emergência com reboque enviada!' : 'Emergência enviada com sucesso!',
        'A equipe da marina foi notificada e entrará em contato.'
      );
    } catch (e: any) {
      showInfo('Erro', e.message || 'Não foi possível enviar a emergência.');
    } finally {
      setSending(false);
    }
  };

  const confirmSend = () => {
    if (!location.trim()) { showInfo('Localização obrigatória', 'Informe onde você está para a equipe te encontrar.'); return; }
    if (!observation.trim()) { showInfo('Descrição obrigatória', 'Descreva o que está acontecendo.'); return; }
    if (reboque === 'sim' && (!coords || !quote)) {
      showInfo('Localização do reboque', 'Toque em "Usar minha localização" para calcular o valor do reboque.');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setDialog({
      title: 'Acionar emergência?',
      message: reboque === 'sim' && quote
        ? `A equipe será notificada.\n\nReboque solicitado — valor estimado: ${money(quote.estimated_total)} (${quote.distance_nm} MN). O valor final será lançado na sua conta.`
        : 'A equipe da marina será notificada imediatamente com seus dados e da sua lancha.',
      buttons: [
        { label: 'Cancelar', variant: 'cancel', onPress: closeDialog },
        { label: 'Acionar', variant: 'destructive', testID: 'confirm-socorro', onPress: () => { closeDialog(); dispatchSend(); } },
      ],
    });
  };

  const cancelRequest = (id: string) => {
    setDialog({
      title: 'Cancelar solicitação?',
      message: 'Deseja cancelar esta solicitação?',
      buttons: [
        { label: 'Voltar', variant: 'cancel', onPress: closeDialog },
        {
          label: 'Cancelar solicitação',
          variant: 'destructive',
          testID: `confirm-cancel-${id}`,
          onPress: async () => {
            closeDialog();
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            setList((prev) => prev.map((e) => (e.id === id ? { ...e, status: 'cancelada' } : e)));
            try { await api.cancelEmergency(id); } catch { if (user) loadList(user.cpf); }
          },
        },
      ],
    });
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

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={20}>
        {loading ? (
          <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
        ) : (
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={styles.sosBanner}>
              <Ionicons name="alert-circle" size={40} color="#FFFFFF" />
              <View style={{ flex: 1 }}>
                <Text style={styles.sosBannerTitle}>Acionar emergência</Text>
                <Text style={styles.sosBannerSub}>Preencha os dados abaixo. A equipe será notificada na hora.</Text>
              </View>
            </View>

            {boatOptions.length > 1 ? (
              <SelectField testID="emergencia-boat-select" label="Lancha" value={boat} options={boatOptions} onChange={setBoat} placeholder="Selecione a lancha" />
            ) : null}

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Localização <Text style={styles.req}>*</Text></Text>
              <TextInput testID="emergencia-location" style={styles.input} value={location} onChangeText={setLocation} placeholder="Ex.: Próximo à Ilha do Campeche" placeholderTextColor={colors.onSurfaceTertiary} />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Descrição <Text style={styles.req}>*</Text></Text>
              <TextInput testID="emergencia-observation" style={[styles.input, styles.textarea]} value={observation} onChangeText={setObservation} placeholder="O que está acontecendo?" placeholderTextColor={colors.onSurfaceTertiary} multiline textAlignVertical="top" />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Precisa de reboque?</Text>
              <View style={styles.segment}>
                <Pressable testID="reboque-nao" onPress={() => { setReboque('nao'); Haptics.selectionAsync(); }} style={[styles.segmentBtn, reboque === 'nao' && styles.segmentBtnActive]}>
                  <Ionicons name="close-circle-outline" size={18} color={reboque === 'nao' ? colors.onBrandPrimary : colors.onSurfaceSecondary} />
                  <Text style={[styles.segmentText, reboque === 'nao' && styles.segmentTextActive]}>Não</Text>
                </Pressable>
                <Pressable testID="reboque-sim" onPress={() => { setReboque('sim'); Haptics.selectionAsync(); }} style={[styles.segmentBtn, reboque === 'sim' && styles.segmentBtnActive]}>
                  <Ionicons name="boat-outline" size={18} color={reboque === 'sim' ? colors.onBrandPrimary : colors.onSurfaceSecondary} />
                  <Text style={[styles.segmentText, reboque === 'sim' && styles.segmentTextActive]}>Sim</Text>
                </Pressable>
              </View>
              <Text style={styles.hint}>Opcional. Selecione &quot;Sim&quot; para ver o valor estimado do reboque.</Text>
            </View>

            {reboque === 'sim' ? (
              <View style={styles.reboqueBox}>
                <Text style={styles.hint}>
                  {selectedLength != null ? `Lancha: ${selectedLength} pés` : 'Comprimento não cadastrado — usando maior faixa.'}
                </Text>
                <Pressable testID="reboque-location-button" onPress={getLocation} disabled={locating} style={({ pressed }) => [styles.gpsBtn, pressed && { opacity: 0.9 }]}>
                  {locating ? <ActivityIndicator color={colors.brandPrimary} /> : <><Ionicons name="navigate" size={18} color={colors.brandPrimary} /><Text style={styles.gpsBtnText}>{coords ? 'Atualizar minha localização' : 'Usar minha localização'}</Text></>}
                </Pressable>
                <Text style={styles.hint}>Usamos seu GPS para calcular a distância até a marina. As primeiras 5 MN estão inclusas.</Text>
                {quote ? (
                  <View style={styles.quoteCard} testID="reboque-quote">
                    <View style={styles.quoteRow}><Text style={styles.quoteLabel}>Distância</Text><Text style={styles.quoteVal}>{quote.distance_nm} MN</Text></View>
                    <View style={styles.quoteRow}><Text style={styles.quoteLabel}>Taxa de atendimento (até 5 MN)</Text><Text style={styles.quoteVal}>{money(quote.base_fee)}</Text></View>
                    <View style={styles.quoteRow}><Text style={styles.quoteLabel}>Adicional ({quote.additional_nm} MN × {money(quote.per_nm)})</Text><Text style={styles.quoteVal}>{money(quote.additional_fee)}</Text></View>
                    <View style={styles.quoteDivider} />
                    <View style={styles.quoteRow}><Text style={styles.quoteTotalLabel}>Valor estimado</Text><Text style={styles.quoteTotalVal} testID="reboque-total">{money(quote.estimated_total)}</Text></View>
                  </View>
                ) : null}
              </View>
            ) : null}

            <Pressable testID="emergencia-button" onPress={confirmSend} disabled={sending} style={({ pressed }) => [styles.sendBtn, pressed && { opacity: 0.9 }]}>
              {sending ? <ActivityIndicator color="#FFFFFF" /> : <><Ionicons name="alert-circle" size={22} color="#FFFFFF" /><Text style={styles.sendBtnText}>ACIONAR EMERGÊNCIA</Text></>}
            </Pressable>

            {list.length > 0 ? (
              <>
                <Text style={styles.sectionLabel}>Meus acionamentos</Text>
                {list.map((e) => {
                  const isReboque = e.kind === 'reboque';
                  const statusText = e.status === 'aberta' ? 'Em atendimento' : e.status === 'cancelada' ? 'Cancelado' : 'Atendido';
                  const dotColor = e.status === 'aberta' ? colors.error : e.status === 'cancelada' ? colors.onSurfaceTertiary : colors.success;
                  return (
                    <View key={e.id} style={styles.card} testID={`emergency-${e.id}`}>
                      <View style={[styles.dot, { backgroundColor: dotColor }]} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.cardTitle}>
                          {isReboque ? 'Reboque' : 'Socorro'} • {statusText}
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
                        {e.status === 'aberta' ? (
                          <Pressable testID={`cancel-emergency-${e.id}`} onPress={() => cancelRequest(e.id)} style={styles.cancelReqBtn}>
                            <Ionicons name="close-circle-outline" size={15} color={colors.error} />
                            <Text style={styles.cancelReqText}>Cancelar solicitação</Text>
                          </Pressable>
                        ) : null}
                      </View>
                    </View>
                  );
                })}
              </>
            ) : null}
          </ScrollView>
        )}
      </KeyboardAvoidingView>
      <AppDialog
        visible={!!dialog}
        title={dialog?.title || ''}
        message={dialog?.message}
        buttons={dialog?.buttons || []}
        onRequestClose={closeDialog}
        testID="emergencia-dialog"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg, gap: spacing.md },
  title: { color: colors.onSurface, fontSize: typography.xxl, fontWeight: '800' },
  subtitle: { color: colors.onSurfaceSecondary, fontSize: typography.sm, marginTop: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.lg, paddingBottom: 120 },
  sosBanner: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.error, borderRadius: radius.md, padding: spacing.lg, marginBottom: spacing.xl },
  sosBannerTitle: { color: '#FFFFFF', fontSize: typography.xl, fontWeight: '800' },
  sosBannerSub: { color: '#FFFFFF', opacity: 0.9, fontSize: typography.sm, marginTop: 2, lineHeight: 18 },
  req: { color: colors.error, fontWeight: '800' },
  segment: { flexDirection: 'row', gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.xs },
  segmentBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingVertical: spacing.md, borderRadius: radius.sm },
  segmentBtnActive: { backgroundColor: colors.brandPrimary },
  segmentText: { color: colors.onSurfaceSecondary, fontSize: typography.base, fontWeight: '700' },
  segmentTextActive: { color: colors.onBrandPrimary },
  reboqueBox: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.lg },
  sendBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, backgroundColor: colors.error, paddingVertical: spacing.lg, borderRadius: radius.md, marginTop: spacing.sm },
  sendBtnText: { color: '#FFFFFF', fontSize: typography.lg, fontWeight: '800', letterSpacing: 0.5 },
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
  gpsBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, borderWidth: 1.5, borderColor: colors.brandPrimary, paddingVertical: spacing.lg, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, marginTop: spacing.sm },
  gpsBtnText: { color: colors.brandPrimary, fontSize: typography.lg, fontWeight: '700' },
  sectionLabel: { color: colors.brandPrimary, fontWeight: '700', fontSize: typography.sm, letterSpacing: 1, textTransform: 'uppercase', marginBottom: spacing.md, marginTop: spacing.xl },
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
  cardTitle: { color: colors.onSurface, fontSize: typography.lg, fontWeight: '700' },
  cardMeta: { color: colors.onSurfaceSecondary, fontSize: typography.sm, marginTop: 2 },
  cancelReqBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: spacing.sm, alignSelf: 'flex-start' },
  cancelReqText: { color: colors.error, fontSize: typography.sm, fontWeight: '700' },
});
