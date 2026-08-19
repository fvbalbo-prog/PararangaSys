import { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { colors, spacing, radius, typography } from '@/src/theme';
import { DateField, DateHelpers } from '@/src/components/DateField';
import { SelectField } from '@/src/components/SelectField';
import { TimeSlotField } from '@/src/components/TimeSlotField';
import { TideSafetyBanner } from '@/src/components/TideSafetyBanner';
import { api, boatName } from '@/src/api';
import type { User } from '@/src/api';
import { tideHeightAt, type TidePoint } from '@/src/tide';

function toISODate(d: Date) {
  return `${d.getFullYear()}-${DateHelpers.pad(d.getMonth() + 1)}-${DateHelpers.pad(d.getDate())}`;
}
function fromISODate(s?: string | null): Date | null {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export default function SubidaScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const editId = params.id;

  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [date, setDate] = useState<Date | null>(null);
  const [bookingTime, setBookingTime] = useState<string | null>(null);
  const [boat, setBoat] = useState<string | null>(null);
  const [observation, setObservation] = useState('');
  const [tidePoints, setTidePoints] = useState<TidePoint[]>([]);

  useEffect(() => {
    if (!date) return;
    api
      .getTides(toISODate(date))
      .then((t) => setTidePoints(t.points || []))
      .catch(() => setTidePoints([]));
  }, [date]);

  useEffect(() => {
    (async () => {
      const raw = await AsyncStorage.getItem('user');
      if (!raw) return router.replace('/');
      const u: User = JSON.parse(raw);
      setUser(u);
      const boatList = u.boats && u.boats.length ? u.boats.map(boatName) : [u.boat_name];
      if (!editId && boatList.length) setBoat(boatList[0]);

      if (editId) {
        try {
          setLoading(true);
          const r = await api.getRequest(editId);
          setDate(fromISODate(r.date));
          setBookingTime(r.time);
          setBoat(r.boat_name || boatList[0] || null);
          setObservation(r.observation || '');
        } catch (e: any) {
          setError(e.message);
        } finally {
          setLoading(false);
        }
      }
    })();
  }, [editId, router]);

  const boatOptions = user?.boats && user.boats.length ? user.boats.map(boatName) : user ? [user.boat_name] : [];
  const selectedBoatLength = (() => {
    const b = user?.boats?.find((x) => typeof x !== 'string' && x.name === boat);
    return b && typeof b !== 'string' ? b.length : null;
  })();

  const handleSubmit = async () => {
    setError(null);
    if (!user) return;
    if (!date || !bookingTime || !boat) {
      setError('Preencha a lancha, a data e o horário do retorno.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    const payload = {
      type: 'subida' as const,
      cpf: user.cpf,
      date: toISODate(date),
      time: bookingTime,
      boat_name: boat,
      tide_height: tideHeightAt(tidePoints, bookingTime),
      observation,
    };
    try {
      setSaving(true);
      if (editId) {
        await api.updateRequest(editId, payload);
      } else {
        await api.createRequest(payload);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch (e: any) {
      setError(e.message || 'Erro ao salvar.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={16} testID="back-button">
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} testID="subida-title">
            {editId ? 'Alterar Subida' : 'Solicitar Subida'}
          </Text>
          <Text style={styles.subtitle}>Horário permitido: 08:30 - 17:30</Text>
        </View>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={colors.brandPrimary} />
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <View style={styles.infoCard}>
              <Ionicons name="information-circle-outline" size={22} color={colors.brandPrimary} />
              <Text style={styles.infoText}>
                Informe a data e o horário previstos para o retorno da lancha à marina.
              </Text>
            </View>

            <SelectField
              testID="subida-boat-select"
              label="Lancha"
              value={boat}
              options={boatOptions}
              onChange={setBoat}
              placeholder="Selecione a lancha"
            />

            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <DateField
                  testID="subida-date-field"
                  label="Data do retorno"
                  mode="date"
                  value={date}
                  onChange={(d) => { setDate(d); setBookingTime(null); }}
                  minimumDate={new Date()}
                  maximumDate={new Date(Date.now() + 24 * 60 * 60 * 1000)}
                />
              </View>
              <View style={{ width: spacing.md }} />
              <View style={{ flex: 1 }}>
                <TimeSlotField
                  testID="subida-time-field"
                  label="Horário"
                  type="subida"
                  date={date ? toISODate(date) : null}
                  value={bookingTime}
                  onChange={setBookingTime}
                  tidePoints={tidePoints}
                  editingId={editId}
                />
              </View>
            </View>

            <TideSafetyBanner
              testID="subida-tide-safety"
              points={tidePoints}
              type="subida"
              time={bookingTime}
              boatLength={selectedBoatLength}
            />

            <View style={{ marginTop: spacing.sm }}>
              <Text style={styles.fieldLabel}>Observação</Text>
              <TextInput
                testID="subida-observation-input"
                style={[styles.input, styles.textarea]}
                value={observation}
                onChangeText={setObservation}
                placeholder="Detalhes adicionais (opcional)"
                placeholderTextColor={colors.onSurfaceTertiary}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
              />
            </View>

            {error ? (
              <Text style={styles.errorText} testID="subida-error">
                {error}
              </Text>
            ) : null}
          </ScrollView>
        )}

        <View style={styles.footer}>
          <Pressable
            testID="subida-submit-button"
            onPress={handleSubmit}
            disabled={saving}
            style={({ pressed }) => [styles.button, pressed && { opacity: 0.85 }]}
          >
            {saving ? (
              <ActivityIndicator color={colors.onBrandPrimary} />
            ) : (
              <Text style={styles.buttonText}>{editId ? 'Salvar alterações' : 'Solicitar subida'}</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  title: { color: colors.onSurface, fontSize: typography.xxl, fontWeight: '800' },
  subtitle: { color: colors.onSurfaceSecondary, fontSize: typography.sm, marginTop: 2 },
  content: { padding: spacing.lg, paddingBottom: 120 },
  row: { flexDirection: 'row' },
  fieldLabel: { color: colors.onSurface, fontSize: typography.base, fontWeight: '600', marginBottom: spacing.sm },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    fontSize: typography.lg,
    color: colors.onSurface,
    backgroundColor: colors.surfaceSecondary,
  },
  textarea: { minHeight: 100 },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.brandTertiary,
    borderRadius: radius.md,
    marginBottom: spacing.lg,
  },
  infoText: {
    flex: 1,
    color: colors.onBrandTertiary,
    fontSize: typography.base,
    lineHeight: 20,
  },
  errorText: {
    color: colors.error,
    backgroundColor: '#FEF2F2',
    padding: spacing.md,
    borderRadius: radius.sm,
    fontSize: typography.base,
    marginTop: spacing.sm,
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  button: {
    backgroundColor: colors.brandPrimary,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  buttonText: { color: colors.onBrandPrimary, fontSize: typography.lg, fontWeight: '700' },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
