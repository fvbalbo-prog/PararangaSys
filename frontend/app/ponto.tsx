import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, spacing, radius, typography } from '@/src/theme';
import { api, PONTO_LABELS } from '@/src/api';
import type { PontoEntry, PontoType } from '@/src/api';
import { AppDialog, type DialogButton } from '@/src/components/AppDialog';

const PONTO_ORDER: { type: PontoType; icon: keyof typeof Ionicons.glyphMap; color: string }[] = [
  { type: 'entrada', icon: 'log-in-outline', color: colors.success },
  { type: 'saida_almoco', icon: 'restaurant-outline', color: colors.brandSecondary },
  { type: 'retorno_almoco', icon: 'return-down-back-outline', color: colors.info },
  { type: 'saida_final', icon: 'log-out-outline', color: colors.error },
];

function todayISO() {
  const d = new Date();
  const p = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export default function PontoScreen() {
  const router = useRouter();
  const [now, setNow] = useState(new Date());
  const [today, setToday] = useState<PontoEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [bating, setBating] = useState<PontoType | null>(null);
  const [dialog, setDialog] = useState<{ title: string; message?: string; buttons: DialogButton[] } | null>(null);
  const closeDialog = () => setDialog(null);
  const showInfo = (title: string, message?: string) =>
    setDialog({ title, message, buttons: [{ label: 'OK', variant: 'primary', onPress: closeDialog }] });

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const load = useCallback(async () => {
    try {
      const iso = todayISO();
      const data = await api.listPonto({ date_from: iso, date_to: iso });
      setToday(data);
    } catch {
      setToday([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  const punchedTypes = new Set(today.map((e) => e.type));

  const bater = async (type: PontoType) => {
    setBating(type);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const entry = await api.baterPonto(type);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showInfo(`${PONTO_LABELS[type]} registrada`, `Horário: ${entry.time}`);
      load();
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showInfo('Erro', e.message || 'Não foi possível registrar o ponto.');
    } finally {
      setBating(null);
    }
  };

  const fmtDate = now.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
  const fmtTime = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']} testID="ponto-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={16} testID="back-button">
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Ponto Eletrônico</Text>
          <Text style={styles.subtitle}>Registre sua jornada do dia</Text>
        </View>
      </View>

      <View style={styles.clockCard}>
        <Text style={styles.clockDate}>{fmtDate}</Text>
        <Text style={styles.clockTime} testID="ponto-clock">{fmtTime}</Text>
      </View>

      <View style={styles.grid}>
        {PONTO_ORDER.map((p) => {
          const punched = punchedTypes.has(p.type);
          return (
            <Pressable
              key={p.type}
              testID={`ponto-btn-${p.type}`}
              disabled={bating !== null}
              onPress={() => bater(p.type)}
              style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
            >
              <View style={[styles.cardIcon, { backgroundColor: p.color }]}>
                {bating === p.type ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Ionicons name={p.icon} size={26} color="#FFFFFF" />
                )}
              </View>
              <Text style={styles.cardTitle}>{PONTO_LABELS[p.type]}</Text>
              {punched ? (
                <View style={styles.punchedTag}>
                  <Ionicons name="checkmark-circle" size={14} color={colors.success} />
                  <Text style={styles.punchedText}>
                    {today.find((e) => e.type === p.type)?.time}
                  </Text>
                </View>
              ) : (
                <Text style={styles.cardHint}>Toque para bater</Text>
              )}
            </Pressable>
          );
        })}
      </View>

      <View style={styles.listHeader}>
        <Text style={styles.listTitle}>Registros de hoje</Text>
      </View>
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
      ) : today.length === 0 ? (
        <Text style={styles.emptyText}>Nenhum ponto registrado ainda hoje.</Text>
      ) : (
        <View style={styles.list}>
          {[...today].sort((a, b) => a.time.localeCompare(b.time)).map((e) => (
            <View key={e.id} style={styles.listRow} testID={`ponto-row-${e.id}`}>
              <Text style={styles.listTime}>{e.time}</Text>
              <Text style={styles.listLabel}>{PONTO_LABELS[e.type]}</Text>
            </View>
          ))}
        </View>
      )}

      <AppDialog
        visible={!!dialog}
        title={dialog?.title || ''}
        message={dialog?.message}
        buttons={dialog?.buttons || []}
        onRequestClose={closeDialog}
        testID="ponto-dialog"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg, gap: spacing.md },
  title: { color: colors.onSurface, fontSize: typography.xxl, fontWeight: '800' },
  subtitle: { color: colors.onSurfaceSecondary, fontSize: typography.sm, marginTop: 2 },
  clockCard: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    backgroundColor: colors.brandPrimary,
    borderRadius: radius.lg,
    paddingVertical: spacing.xl,
    alignItems: 'center',
  },
  clockDate: { color: colors.brandSecondary, fontSize: typography.sm, fontWeight: '700', textTransform: 'capitalize' },
  clockTime: { color: colors.onBrandPrimary, fontSize: 40, fontWeight: '800', marginTop: spacing.xs, fontVariant: ['tabular-nums'] },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  card: {
    width: '47%',
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
  },
  cardIcon: { width: 52, height: 52, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { color: colors.onSurface, fontSize: typography.base, fontWeight: '800', textAlign: 'center' },
  cardHint: { color: colors.onSurfaceTertiary, fontSize: typography.sm },
  punchedTag: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  punchedText: { color: colors.success, fontSize: typography.sm, fontWeight: '700' },
  listHeader: { paddingHorizontal: spacing.lg, marginTop: spacing.xl, marginBottom: spacing.sm },
  listTitle: { color: colors.onSurface, fontSize: typography.lg, fontWeight: '800' },
  emptyText: { color: colors.onSurfaceSecondary, fontSize: typography.base, paddingHorizontal: spacing.lg },
  center: { paddingVertical: spacing.xl, alignItems: 'center' },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.sm },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  listTime: { color: colors.onSurface, fontSize: typography.base, fontWeight: '800', width: 56 },
  listLabel: { color: colors.onSurfaceSecondary, fontSize: typography.base },
});
