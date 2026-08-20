import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { colors, spacing, radius, typography } from '@/src/theme';
import { SelectField } from '@/src/components/SelectField';
import { DateField } from '@/src/components/DateField';
import { AppDialog, type DialogButton } from '@/src/components/AppDialog';
import { api, boatName, SERVICO_LABELS } from '@/src/api';
import type { User, Servico, ServicoType } from '@/src/api';

function pad(n: number) {
  return n.toString().padStart(2, '0');
}
function dateToISO(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function timeToHHMM(d: Date) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function brDate(iso?: string | null) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

const SERVICE_OPTIONS: { type: ServicoType; icon: keyof typeof Ionicons.glyphMap; color: string }[] = [
  { type: 'lavagem', icon: 'water-outline', color: '#0E7490' },
  { type: 'marinheiro', icon: 'person-outline', color: '#4D7C0F' },
  { type: 'abastecimento', icon: 'flame-outline', color: '#B45309' },
];

const STATUS_META: Record<string, { label: string; color: string }> = {
  pendente: { label: 'Pendente', color: colors.brandSecondary },
  em_andamento: { label: 'Em andamento', color: '#0E7490' },
  concluido: { label: 'Concluído', color: colors.success },
  cancelado: { label: 'Cancelado', color: colors.onSurfaceTertiary },
};

export default function ServicosScreen() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [type, setType] = useState<ServicoType>('lavagem');
  const [boat, setBoat] = useState<string | null>(null);
  const [desiredDate, setDesiredDate] = useState<Date | null>(null);
  const [desiredTime, setDesiredTime] = useState<Date | null>(null);
  const [observation, setObservation] = useState('');
  const [list, setList] = useState<Servico[]>([]);
  const [dialog, setDialog] = useState<{ title: string; message?: string; buttons: DialogButton[] } | null>(null);
  const closeDialog = () => setDialog(null);
  const showInfo = (title: string, message?: string) =>
    setDialog({ title, message, buttons: [{ label: 'OK', variant: 'primary', onPress: closeDialog }] });

  const loadList = useCallback(async (cpf: string) => {
    try {
      setList(await api.listServicos({ cpf }));
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

  const submit = async () => {
    if (!user) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      setSending(true);
      await api.createServico({
        cpf: user.cpf,
        boat_name: boat,
        type,
        desired_date: desiredDate ? dateToISO(desiredDate) : null,
        desired_time: desiredTime ? timeToHHMM(desiredTime) : null,
        observation: observation.trim() || null,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setDesiredDate(null);
      setDesiredTime(null);
      setObservation('');
      await loadList(user.cpf);
      showInfo('Solicitação enviada!', 'A equipe da marina foi notificada e vai providenciar o serviço.');
    } catch (e: any) {
      showInfo('Erro', e.message || 'Não foi possível enviar a solicitação.');
    } finally {
      setSending(false);
    }
  };

  const cancelRequest = (id: string) => {
    setDialog({
      title: 'Cancelar solicitação?',
      message: 'Deseja cancelar esta solicitação de serviço?',
      buttons: [
        { label: 'Voltar', variant: 'cancel', onPress: closeDialog },
        {
          label: 'Cancelar solicitação',
          variant: 'destructive',
          testID: `confirm-cancel-servico-${id}`,
          onPress: async () => {
            closeDialog();
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            setList((prev) => prev.map((s) => (s.id === id ? { ...s, status: 'cancelado' } : s)));
            try { await api.cancelServico(id); } catch { if (user) loadList(user.cpf); }
          },
        },
      ],
    });
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']} testID="servicos-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={16} testID="back-button">
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Serviços</Text>
          <Text style={styles.subtitle}>Solicite um serviço para sua lancha</Text>
        </View>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={20}>
        {loading ? (
          <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
        ) : (
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={styles.typeGrid}>
              {SERVICE_OPTIONS.map((opt) => {
                const active = type === opt.type;
                return (
                  <Pressable
                    key={opt.type}
                    testID={`servico-type-${opt.type}`}
                    onPress={() => { setType(opt.type); Haptics.selectionAsync(); }}
                    style={[styles.typeCard, active && { borderColor: opt.color, backgroundColor: opt.color + '14' }]}
                  >
                    <View style={[styles.typeIcon, { backgroundColor: opt.color }]}>
                      <Ionicons name={opt.icon} size={22} color="#FFFFFF" />
                    </View>
                    <Text style={[styles.typeText, active && { color: opt.color }]}>{SERVICO_LABELS[opt.type]}</Text>
                  </Pressable>
                );
              })}
            </View>

            {boatOptions.length > 1 ? (
              <SelectField testID="servico-boat-select" label="Lancha" value={boat} options={boatOptions} onChange={setBoat} placeholder="Selecione a lancha" />
            ) : null}

            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <DateField testID="servico-date-field" label="Data desejada (opcional)" mode="date" value={desiredDate} onChange={setDesiredDate} minimumDate={new Date()} />
              </View>
              <View style={{ width: spacing.md }} />
              <View style={{ flex: 1 }}>
                <DateField testID="servico-time-field" label="Horário (opcional)" mode="time" value={desiredTime} onChange={setDesiredTime} />
              </View>
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Observação</Text>
              <TextInput testID="servico-observation" style={[styles.input, styles.textarea]} value={observation} onChangeText={setObservation} placeholder="Algum detalhe importante?" placeholderTextColor={colors.onSurfaceTertiary} multiline textAlignVertical="top" />
            </View>

            <Pressable testID="servico-submit" onPress={submit} disabled={sending} style={({ pressed }) => [styles.sendBtn, pressed && { opacity: 0.9 }]}>
              {sending ? <ActivityIndicator color="#FFFFFF" /> : <><Ionicons name="checkmark-circle-outline" size={20} color="#FFFFFF" /><Text style={styles.sendBtnText}>Solicitar {SERVICO_LABELS[type]}</Text></>}
            </Pressable>

            {list.length > 0 ? (
              <>
                <Text style={styles.sectionLabel}>Minhas solicitações</Text>
                {list.map((s) => {
                  const meta = STATUS_META[s.status];
                  return (
                    <View key={s.id} style={styles.card} testID={`servico-${s.id}`}>
                      <View style={[styles.dot, { backgroundColor: meta.color }]} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.cardTitle}>{SERVICO_LABELS[s.type]} • {meta.label}</Text>
                        <Text style={styles.cardMeta}>{formatDateTime(s.created_at)}{s.boat_name ? ` • ${s.boat_name}` : ''}</Text>
                        {s.desired_date ? <Text style={styles.cardMeta}>Desejado: {brDate(s.desired_date)}{s.desired_time ? ` às ${s.desired_time}` : ''}</Text> : null}
                        {s.observation ? <Text style={styles.cardMeta}>{s.observation}</Text> : null}
                        {s.status === 'pendente' || s.status === 'em_andamento' ? (
                          <Pressable testID={`cancel-servico-${s.id}`} onPress={() => cancelRequest(s.id)} style={styles.cancelReqBtn}>
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
      <AppDialog visible={!!dialog} title={dialog?.title || ''} message={dialog?.message} buttons={dialog?.buttons || []} onRequestClose={closeDialog} testID="servicos-dialog" />
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
  typeGrid: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  typeCard: { flex: 1, alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surfaceSecondary },
  typeIcon: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  typeText: { color: colors.onSurfaceSecondary, fontSize: typography.sm, fontWeight: '700', textAlign: 'center' },
  row: { flexDirection: 'row' },
  fieldGroup: { marginBottom: spacing.lg },
  label: { color: colors.onSurface, fontSize: typography.base, fontWeight: '600', marginBottom: spacing.sm },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.lg, fontSize: typography.lg, color: colors.onSurface, backgroundColor: colors.surfaceSecondary },
  textarea: { minHeight: 90 },
  sendBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, backgroundColor: colors.brandPrimary, paddingVertical: spacing.lg, borderRadius: radius.md, marginTop: spacing.sm },
  sendBtnText: { color: '#FFFFFF', fontSize: typography.lg, fontWeight: '800' },
  sectionLabel: { color: colors.brandPrimary, fontWeight: '700', fontSize: typography.sm, letterSpacing: 1, textTransform: 'uppercase', marginBottom: spacing.md, marginTop: spacing.xl },
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
  cardTitle: { color: colors.onSurface, fontSize: typography.lg, fontWeight: '700' },
  cardMeta: { color: colors.onSurfaceSecondary, fontSize: typography.sm, marginTop: 2 },
  cancelReqBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: spacing.sm, alignSelf: 'flex-start' },
  cancelReqText: { color: colors.error, fontSize: typography.sm, fontWeight: '700' },
});
