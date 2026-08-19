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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { colors, spacing, radius, typography } from '@/src/theme';
import { DateField, DateHelpers } from '@/src/components/DateField';
import { SelectField } from '@/src/components/SelectField';
import { AppDialog } from '@/src/components/AppDialog';
import { api, boatName, authValidityLabel } from '@/src/api';
import type { User, Authorization } from '@/src/api';

type ValidityType = 'data' | 'periodo' | 'recorrente';
const VALIDITY_OPTIONS: { key: ValidityType; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'data', label: 'Data única', icon: 'calendar-outline' },
  { key: 'periodo', label: 'Período', icon: 'calendar-number-outline' },
  { key: 'recorrente', label: 'Sem validade', icon: 'infinite-outline' },
];

function toISODate(d: Date) {
  return `${d.getFullYear()}-${DateHelpers.pad(d.getMonth() + 1)}-${DateHelpers.pad(d.getDate())}`;
}

export default function AutorizarScreen() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [boat, setBoat] = useState<string | null>(null);
  const [personName, setPersonName] = useState('');
  const [date, setDate] = useState<Date | null>(null);
  const [validityType, setValidityType] = useState<ValidityType>('data');
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [canLower, setCanLower] = useState(false);
  const [service, setService] = useState('');
  const [list, setList] = useState<Authorization[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successVisible, setSuccessVisible] = useState(false);

  const loadList = useCallback(async (cpf: string) => {
    try {
      setList(await api.listAuthorizations(cpf));
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

  useEffect(() => {
    boot();
  }, [boot]);

  useFocusEffect(
    useCallback(() => {
      if (user) loadList(user.cpf);
    }, [user, loadList])
  );

  const boatOptions = user?.boats && user.boats.length ? user.boats.map(boatName) : user ? [user.boat_name] : [];

  const submit = async () => {
    setError(null);
    if (!user || !boat || !personName.trim()) {
      setError('Preencha o nome e a lancha.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    if (validityType === 'data' && !date) {
      setError('Selecione a data da autorização.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    if (validityType === 'periodo' && (!startDate || !endDate)) {
      setError('Selecione a data inicial e a final do período.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    if (validityType === 'periodo' && startDate && endDate && toISODate(endDate) < toISODate(startDate)) {
      setError('A data final deve ser igual ou posterior à inicial.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    try {
      setSaving(true);
      await api.createAuthorization({
        cpf: user.cpf,
        boat_name: boat,
        person_name: personName.trim(),
        validity_type: validityType,
        date: validityType === 'data' && date ? toISODate(date) : null,
        start_date: validityType === 'periodo' && startDate ? toISODate(startDate) : null,
        end_date: validityType === 'periodo' && endDate ? toISODate(endDate) : null,
        can_lower: canLower,
        service: service.trim() || null,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPersonName('');
      setDate(null);
      setStartDate(null);
      setEndDate(null);
      setValidityType('data');
      setCanLower(false);
      setService('');
      await loadList(user.cpf);
      setSuccessVisible(true);
    } catch (e: any) {
      setError(e.message || 'Erro ao autorizar.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSaving(false);
    }
  };

  const cancel = async (id: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    setList((prev) => prev.map((a) => (a.id === id ? { ...a, status: 'cancelada' } : a)));
    try {
      await api.cancelAuthorization(id);
    } catch {
      if (user) loadList(user.cpf);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']} testID="autorizar-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={16} testID="back-button">
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Autorizar Entrada</Text>
          <Text style={styles.subtitle}>Libere um terceiro para usar a lancha</Text>
        </View>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={20}>
        {loading ? (
          <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
        ) : (
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <SelectField
              testID="autorizar-boat-select"
              label="Lancha"
              value={boat}
              options={boatOptions}
              onChange={setBoat}
              placeholder="Selecione a lancha"
            />
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Nome do autorizado</Text>
              <TextInput
                testID="autorizar-name-input"
                style={styles.input}
                value={personName}
                onChangeText={setPersonName}
                placeholder="Nome completo"
                placeholderTextColor={colors.onSurfaceTertiary}
              />
            </View>
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Validade da autorização</Text>
              <View style={styles.validityRow}>
                {VALIDITY_OPTIONS.map((opt) => {
                  const active = validityType === opt.key;
                  return (
                    <Pressable
                      key={opt.key}
                      testID={`autorizar-validity-${opt.key}`}
                      onPress={() => { setValidityType(opt.key); Haptics.selectionAsync(); }}
                      style={[styles.validityBtn, active && styles.validityBtnActive]}
                    >
                      <Ionicons name={opt.icon} size={18} color={active ? colors.onBrandPrimary : colors.onSurfaceSecondary} />
                      <Text style={[styles.validityText, active && styles.validityTextActive]}>{opt.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {validityType === 'data' ? (
              <DateField
                testID="autorizar-date-field"
                label="Data autorizada"
                mode="date"
                value={date}
                onChange={setDate}
                minimumDate={new Date()}
              />
            ) : validityType === 'periodo' ? (
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <DateField
                    testID="autorizar-start-date-field"
                    label="De"
                    mode="date"
                    value={startDate}
                    onChange={setStartDate}
                    minimumDate={new Date()}
                  />
                </View>
                <View style={{ width: spacing.md }} />
                <View style={{ flex: 1 }}>
                  <DateField
                    testID="autorizar-end-date-field"
                    label="Até"
                    mode="date"
                    value={endDate}
                    onChange={setEndDate}
                    minimumDate={startDate || new Date()}
                  />
                </View>
              </View>
            ) : (
              <View style={styles.recurringNote} testID="autorizar-recurring-note">
                <Ionicons name="infinite-outline" size={18} color={colors.brandPrimary} />
                <Text style={styles.recurringText}>
                  Autorização recorrente: fica ativa todos os dias até você cancelar.
                </Text>
              </View>
            )}

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Autorizado a descer a lancha?</Text>
              <View style={styles.toggleRow}>
                <Pressable testID="autorizar-lower-sim" onPress={() => setCanLower(true)} style={[styles.toggleBtn, canLower && styles.toggleBtnActive]}>
                  <Ionicons name="checkmark-circle-outline" size={16} color={canLower ? colors.onBrandPrimary : colors.onSurfaceSecondary} />
                  <Text style={[styles.toggleText, canLower && styles.toggleTextActive]}>Sim</Text>
                </Pressable>
                <Pressable testID="autorizar-lower-nao" onPress={() => setCanLower(false)} style={[styles.toggleBtn, !canLower && styles.toggleBtnActive]}>
                  <Ionicons name="close-circle-outline" size={16} color={!canLower ? colors.onBrandPrimary : colors.onSurfaceSecondary} />
                  <Text style={[styles.toggleText, !canLower && styles.toggleTextActive]}>Não</Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Serviço a ser realizado</Text>
              <TextInput
                testID="autorizar-service-input"
                style={[styles.input, { minHeight: 70 }]}
                value={service}
                onChangeText={setService}
                placeholder="Ex.: Limpeza, manutenção do motor..."
                placeholderTextColor={colors.onSurfaceTertiary}
                multiline
                textAlignVertical="top"
              />
            </View>

            {error ? <Text style={styles.errorText} testID="autorizar-error">{error}</Text> : null}

            <Pressable
              testID="autorizar-submit"
              onPress={submit}
              disabled={saving}
              style={({ pressed }) => [styles.button, pressed && { opacity: 0.85 }]}
            >
              {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.buttonText}>Autorizar</Text>}
            </Pressable>

            {list.length > 0 ? (
              <>
                <Text style={[styles.sectionLabel, { marginTop: spacing.xl }]}>Autorizações</Text>
                {list.map((a) => (
                  <View key={a.id} style={styles.card} testID={`auth-${a.id}`}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.cardName, a.status === 'cancelada' && styles.cancelled]}>{a.person_name}</Text>
                      <Text style={styles.cardMeta}>{a.boat_name} • {authValidityLabel(a)}</Text>
                      <Text style={styles.cardMeta}>Descer a lancha: {a.can_lower ? 'Sim' : 'Não'}</Text>
                      {a.service ? <Text style={styles.cardMeta}>Serviço: {a.service}</Text> : null}
                      {a.entered_at ? (
                        <View style={styles.enteredTag}>
                          <Ionicons name="checkmark-circle" size={14} color={colors.success} />
                          <Text style={styles.enteredText}>Entrada confirmada às {new Date(a.entered_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</Text>
                        </View>
                      ) : null}
                    </View>
                    {a.status === 'ativa' ? (
                      <Pressable testID={`auth-cancel-${a.id}`} onPress={() => cancel(a.id)} hitSlop={8} style={styles.cancelBtn}>
                        <Ionicons name="close-circle-outline" size={16} color={colors.error} />
                        <Text style={styles.cancelText}>Cancelar</Text>
                      </Pressable>
                    ) : (
                      <View style={styles.badgeCancel}><Text style={styles.badgeCancelText}>Cancelada</Text></View>
                    )}
                  </View>
                ))}
              </>
            ) : null}
          </ScrollView>
        )}
      </KeyboardAvoidingView>

      <AppDialog
        visible={successVisible}
        testID="autorizar-success-dialog"
        title="Autorização criada!"
        message="A autorização foi registrada e já aparece na portaria da marina."
        buttons={[{ label: 'OK', variant: 'primary', testID: 'autorizar-success-ok', onPress: () => setSuccessVisible(false) }]}
        onRequestClose={() => setSuccessVisible(false)}
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
  row: { flexDirection: 'row' },
  fieldGroup: { marginBottom: spacing.lg },
  validityRow: { flexDirection: 'row', gap: spacing.sm },
  validityBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary },
  validityBtnActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  validityText: { color: colors.onSurfaceSecondary, fontSize: typography.sm, fontWeight: '700' },
  validityTextActive: { color: colors.onBrandPrimary },
  recurringNote: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, backgroundColor: colors.brandTertiary, borderRadius: radius.md, marginBottom: spacing.lg },
  recurringText: { flex: 1, color: colors.onBrandTertiary, fontSize: typography.base, lineHeight: 20 },
  label: { color: colors.onSurface, fontSize: typography.base, fontWeight: '600', marginBottom: spacing.sm },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.lg, fontSize: typography.lg, color: colors.onSurface, backgroundColor: colors.surfaceSecondary },
  toggleRow: { flexDirection: 'row', gap: spacing.sm },
  toggleBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingVertical: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary },
  toggleBtnActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  toggleText: { color: colors.onSurfaceSecondary, fontSize: typography.base, fontWeight: '700' },
  toggleTextActive: { color: colors.onBrandPrimary },
  errorText: { color: colors.error, backgroundColor: '#FEF2F2', padding: spacing.md, borderRadius: radius.sm, fontSize: typography.base, marginBottom: spacing.md },
  button: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.lg, alignItems: 'center', marginTop: spacing.sm },
  buttonText: { color: colors.onBrandPrimary, fontSize: typography.lg, fontWeight: '700' },
  sectionLabel: { color: colors.brandPrimary, fontWeight: '700', fontSize: typography.sm, letterSpacing: 1, textTransform: 'uppercase', marginBottom: spacing.md },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.sm },
  cardName: { color: colors.onSurface, fontSize: typography.lg, fontWeight: '700' },
  cancelled: { textDecorationLine: 'line-through', color: colors.onSurfaceTertiary },
  cardMeta: { color: colors.onSurfaceSecondary, fontSize: typography.sm, marginTop: 2 },
  enteredTag: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: spacing.xs },
  enteredText: { color: colors.success, fontSize: typography.sm, fontWeight: '700' },
  cancelBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cancelText: { color: colors.error, fontSize: typography.sm, fontWeight: '700' },
  badgeCancel: { paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colors.surfaceTertiary },
  badgeCancelText: { color: colors.onSurfaceTertiary, fontSize: typography.sm, fontWeight: '700' },
});
