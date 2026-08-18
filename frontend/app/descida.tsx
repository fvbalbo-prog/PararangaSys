import { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
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
import { TideChip } from '@/src/components/TideChip';
import { TideSafetyBanner } from '@/src/components/TideSafetyBanner';
import { tideHeightAt, type TidePoint } from '@/src/tide';
import { api, boatName } from '@/src/api';
import type { User } from '@/src/api';

function toISODate(d: Date) {
  return `${d.getFullYear()}-${DateHelpers.pad(d.getMonth() + 1)}-${DateHelpers.pad(d.getDate())}`;
}
function fromISODate(s?: string | null): Date | null {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
function timeToDate(t?: string | null): Date | null {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  const d = new Date();
  d.setHours(h || 0, m || 0, 0, 0);
  return d;
}

export default function DescidaScreen() {
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
  const [returnDate, setReturnDate] = useState<Date | null>(null);
  const [returnTime, setReturnTime] = useState<Date | null>(null);
  const [destination, setDestination] = useState('');
  const [passengers, setPassengers] = useState('');
  const [responsible, setResponsible] = useState('');
  const [observation, setObservation] = useState('');
  const [tidePoints, setTidePoints] = useState<TidePoint[]>([]);

  // Load tide table whenever the descida date changes
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
          setReturnDate(fromISODate(r.expected_return_date));
          setReturnTime(timeToDate(r.expected_return_time));
          setDestination(r.destination || '');
          setPassengers(r.passengers != null ? String(r.passengers) : '');
          setResponsible(r.responsible || '');
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
    if (!date || !bookingTime || !boat || !returnDate || !returnTime || !destination || !passengers || !responsible) {
      setError('Preencha todos os campos obrigatórios.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    const payload = {
      type: 'descida' as const,
      cpf: user.cpf,
      date: toISODate(date),
      time: bookingTime,
      boat_name: boat,
      tide_height: tideHeightAt(tidePoints, bookingTime),
      expected_return_date: toISODate(returnDate),
      expected_return_time: DateHelpers.formatTime(returnTime),
      destination,
      passengers: parseInt(passengers, 10) || 0,
      responsible,
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
          <Text style={styles.title} testID="descida-title">
            {editId ? 'Alterar Descida' : 'Solicitar Descida'}
          </Text>
          <Text style={styles.subtitle}>Horário permitido: 08:30 - 17:00</Text>
        </View>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={20}
      >
        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={colors.brandPrimary} />
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <SelectField
              testID="descida-boat-select"
              label="Lancha"
              value={boat}
              options={boatOptions}
              onChange={setBoat}
              placeholder="Selecione a lancha"
            />

            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <DateField
                  testID="descida-date-field"
                  label="Dia da descida"
                  mode="date"
                  value={date}
                  onChange={(d) => { setDate(d); setBookingTime(null); }}
                  minimumDate={new Date()}
                />
              </View>
              <View style={{ width: spacing.md }} />
              <View style={{ flex: 1 }}>
                <TimeSlotField
                  testID="descida-time-field"
                  label="Horário"
                  type="descida"
                  date={date ? toISODate(date) : null}
                  value={bookingTime}
                  onChange={setBookingTime}
                  tidePoints={tidePoints}
                  editingId={editId}
                />
              </View>
            </View>

            <TideSafetyBanner
              testID="descida-tide-safety"
              points={tidePoints}
              type="descida"
              time={bookingTime}
              boatLength={selectedBoatLength}
            />

            <Text style={styles.sectionLabel}>Previsão de retorno</Text>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <DateField
                  testID="descida-return-date-field"
                  label="Data"
                  mode="date"
                  value={returnDate}
                  onChange={setReturnDate}
                  minimumDate={date || new Date()}
                />
              </View>
              <View style={{ width: spacing.md }} />
              <View style={{ flex: 1 }}>
                <DateField
                  testID="descida-return-time-field"
                  label="Hora"
                  mode="time"
                  value={returnTime}
                  onChange={setReturnTime}
                />
              </View>
            </View>
            {returnTime ? (
              <View style={{ marginTop: -spacing.sm, marginBottom: spacing.md }}>
                <TideChip
                  testID="descida-return-tide"
                  height={tideHeightAt(tidePoints, DateHelpers.formatTime(returnTime))}
                />
              </View>
            ) : null}

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Destino</Text>
              <TextInput
                testID="descida-destination-input"
                style={styles.input}
                value={destination}
                onChangeText={setDestination}
                placeholder="Ex.: Ilha do Campeche"
                placeholderTextColor={colors.onSurfaceTertiary}
              />
            </View>

            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Nº de passageiros</Text>
                <TextInput
                  testID="descida-passengers-input"
                  style={styles.input}
                  value={passengers}
                  onChangeText={(v) => setPassengers(v.replace(/\D/g, ''))}
                  placeholder="0"
                  placeholderTextColor={colors.onSurfaceTertiary}
                  keyboardType="number-pad"
                  inputMode="numeric"
                />
              </View>
              <View style={{ width: spacing.md }} />
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Responsável</Text>
                <TextInput
                  testID="descida-responsible-input"
                  style={styles.input}
                  value={responsible}
                  onChangeText={setResponsible}
                  placeholder="Nome"
                  placeholderTextColor={colors.onSurfaceTertiary}
                />
              </View>
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Observação</Text>
              <TextInput
                testID="descida-observation-input"
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
              <Text style={styles.errorText} testID="descida-error">
                {error}
              </Text>
            ) : null}
          </ScrollView>
        )}

        <View style={styles.footer}>
          <Pressable
            testID="descida-submit-button"
            onPress={handleSubmit}
            disabled={saving}
            style={({ pressed }) => [styles.button, pressed && { opacity: 0.85 }]}
          >
            {saving ? (
              <ActivityIndicator color={colors.onBrandPrimary} />
            ) : (
              <Text style={styles.buttonText}>{editId ? 'Salvar alterações' : 'Solicitar descida'}</Text>
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
  fieldGroup: { marginBottom: spacing.lg },
  sectionLabel: {
    color: colors.brandPrimary,
    fontWeight: '700',
    fontSize: typography.sm,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
    marginTop: spacing.sm,
  },
  label: { color: colors.onSurface, fontSize: typography.base, fontWeight: '600', marginBottom: spacing.sm },
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
