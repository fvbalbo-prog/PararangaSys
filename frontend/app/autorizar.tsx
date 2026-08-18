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
import { api, boatName } from '@/src/api';
import type { User, Authorization } from '@/src/api';

function toISODate(d: Date) {
  return `${d.getFullYear()}-${DateHelpers.pad(d.getMonth() + 1)}-${DateHelpers.pad(d.getDate())}`;
}
function formatBR(iso: string) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export default function AutorizarScreen() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [boat, setBoat] = useState<string | null>(null);
  const [personName, setPersonName] = useState('');
  const [date, setDate] = useState<Date | null>(null);
  const [list, setList] = useState<Authorization[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    if (!user || !boat || !personName.trim() || !date) {
      setError('Preencha nome, lancha e data.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    try {
      setSaving(true);
      await api.createAuthorization({
        cpf: user.cpf,
        boat_name: boat,
        person_name: personName.trim(),
        date: toISODate(date),
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPersonName('');
      setDate(null);
      await loadList(user.cpf);
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
            <DateField
              testID="autorizar-date-field"
              label="Data autorizada"
              mode="date"
              value={date}
              onChange={setDate}
              minimumDate={new Date()}
            />

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
                      <Text style={styles.cardMeta}>{a.boat_name} • {formatBR(a.date)}</Text>
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
  fieldGroup: { marginBottom: spacing.lg },
  label: { color: colors.onSurface, fontSize: typography.base, fontWeight: '600', marginBottom: spacing.sm },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.lg, fontSize: typography.lg, color: colors.onSurface, backgroundColor: colors.surfaceSecondary },
  errorText: { color: colors.error, backgroundColor: '#FEF2F2', padding: spacing.md, borderRadius: radius.sm, fontSize: typography.base, marginBottom: spacing.md },
  button: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.lg, alignItems: 'center', marginTop: spacing.sm },
  buttonText: { color: colors.onBrandPrimary, fontSize: typography.lg, fontWeight: '700' },
  sectionLabel: { color: colors.brandPrimary, fontWeight: '700', fontSize: typography.sm, letterSpacing: 1, textTransform: 'uppercase', marginBottom: spacing.md },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.sm },
  cardName: { color: colors.onSurface, fontSize: typography.lg, fontWeight: '700' },
  cancelled: { textDecorationLine: 'line-through', color: colors.onSurfaceTertiary },
  cardMeta: { color: colors.onSurfaceSecondary, fontSize: typography.sm, marginTop: 2 },
  cancelBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cancelText: { color: colors.error, fontSize: typography.sm, fontWeight: '700' },
  badgeCancel: { paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colors.surfaceTertiary },
  badgeCancelText: { color: colors.onSurfaceTertiary, fontSize: typography.sm, fontWeight: '700' },
});
