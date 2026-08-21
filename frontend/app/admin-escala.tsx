import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, spacing, radius, typography } from '@/src/theme';
import { api } from '@/src/api';
import type { EscalaEntry, Client } from '@/src/api';
import { SelectField } from '@/src/components/SelectField';
import { AppDialog, type DialogButton } from '@/src/components/AppDialog';

function pad(n: number) {
  return n.toString().padStart(2, '0');
}
function currentMonth() {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}
function monthStr(year: number, month: number) {
  return `${year}-${pad(month)}`;
}
function labelForMonth(year: number, month: number) {
  const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  return `${MONTHS[month - 1]} ${year}`;
}
function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}
function firstWeekday(year: number, month: number) {
  return new Date(year, month - 1, 1).getDay();
}
function labelForDay(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  const dt = new Date(y, m - 1, d);
  return `${WEEKDAYS[dt.getDay()]}, ${pad(d)}/${pad(m)}`;
}
const WEEKDAY_HEAD = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const firstName = (n: string) => n.split(' ')[0];

export default function AdminEscalaScreen() {
  const router = useRouter();
  const [{ year, month }, setYm] = useState(currentMonth());
  const [entries, setEntries] = useState<EscalaEntry[]>([]);
  const [staff, setStaff] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [dayModal, setDayModal] = useState<string | null>(null);
  const [pickName, setPickName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dialog, setDialog] = useState<{ title: string; message?: string; buttons: DialogButton[] } | null>(null);
  const closeDialog = () => setDialog(null);
  const showInfo = (title: string, message?: string) =>
    setDialog({ title, message, buttons: [{ label: 'OK', variant: 'primary', onPress: closeDialog }] });

  const ms = monthStr(year, month);
  const todayISO = (() => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; })();

  const load = useCallback(async () => {
    try {
      const [ents, users] = await Promise.all([
        api.listEscala({ month: ms }),
        api.listUsers(),
      ]);
      setEntries(ents);
      setStaff(users.filter((u) => u.is_staff && u.active !== false));
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [ms]);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  const shiftMonth = (delta: number) => {
    Haptics.selectionAsync();
    setYm((p) => {
      let m = p.month + delta, y = p.year;
      if (m < 1) { m = 12; y -= 1; }
      if (m > 12) { m = 1; y += 1; }
      return { year: y, month: m };
    });
  };

  const byDate = useMemo(() => {
    const m = new Map<string, EscalaEntry[]>();
    for (const e of entries) {
      if (!m.has(e.date)) m.set(e.date, []);
      m.get(e.date)!.push(e);
    }
    for (const list of m.values()) list.sort((a, b) => a.user_name.localeCompare(b.user_name));
    return m;
  }, [entries]);

  const cells = useMemo(() => {
    const total = daysInMonth(year, month);
    const start = firstWeekday(year, month);
    const arr: (string | null)[] = [];
    for (let i = 0; i < start; i++) arr.push(null);
    for (let d = 1; d <= total; d++) arr.push(`${ms}-${pad(d)}`);
    while (arr.length % 7 !== 0) arr.push(null);
    return arr;
  }, [year, month, ms]);

  const openDay = (iso: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setDayModal(iso);
    setPickName(null);
  };

  const dayEntries = dayModal ? byDate.get(dayModal) || [] : [];
  const availableStaff = staff.filter((s) => !dayEntries.some((e) => e.cpf === s.cpf));

  const addToDay = async () => {
    if (!dayModal || !pickName) return;
    const person = staff.find((s) => s.name === pickName);
    if (!person) return;
    setSaving(true);
    try {
      const created = await api.createEscala({ date: dayModal, cpf: person.cpf });
      setEntries((prev) => [...prev, created]);
      setPickName(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      showInfo('Erro', e.message || 'Não foi possível escalar o funcionário.');
    } finally {
      setSaving(false);
    }
  };

  const removeFromDay = (entry: EscalaEntry) => {
    setDialog({
      title: 'Remover da escala',
      message: `Remover ${entry.user_name} de ${labelForDay(entry.date)}?`,
      buttons: [
        { label: 'Cancelar', variant: 'cancel', onPress: closeDialog },
        {
          label: 'Remover',
          variant: 'destructive',
          testID: `confirm-remove-escala-${entry.id}`,
          onPress: async () => {
            closeDialog();
            setEntries((prev) => prev.filter((e) => e.id !== entry.id));
            try { await api.deleteEscala(entry.id); } catch { load(); }
          },
        },
      ],
    });
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="admin-escala-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={16} testID="back-button">
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} testID="escala-title">Escala de Trabalho</Text>
          <Text style={styles.subtitle}>Toque num dia pra escalar funcionários</Text>
        </View>
      </View>

      <View style={styles.monthNav}>
        <Pressable onPress={() => shiftMonth(-1)} testID="escala-prev-month" style={styles.navBtn} hitSlop={8}>
          <Ionicons name="chevron-back" size={20} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.monthLabel} testID="escala-month-label">{labelForMonth(year, month)}</Text>
        <Pressable onPress={() => shiftMonth(1)} testID="escala-next-month" style={styles.navBtn} hitSlop={8}>
          <Ionicons name="chevron-forward" size={20} color={colors.onSurface} />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.weekHead}>
            {WEEKDAY_HEAD.map((w, i) => (
              <Text key={i} style={styles.weekHeadText}>{w}</Text>
            ))}
          </View>
          <View style={styles.grid}>
            {cells.map((iso, i) => {
              if (!iso) return <View key={`blank-${i}`} style={styles.dayCellEmpty} />;
              const list = byDate.get(iso) || [];
              const isToday = iso === todayISO;
              return (
                <Pressable
                  key={iso}
                  testID={`escala-day-${iso}`}
                  onPress={() => openDay(iso)}
                  style={[styles.dayCell, isToday && styles.dayCellToday]}
                >
                  <Text style={[styles.dayNum, isToday && styles.dayNumToday]}>{parseInt(iso.split('-')[2], 10)}</Text>
                  <View style={styles.dayChips}>
                    {list.slice(0, 2).map((e) => (
                      <View key={e.id} style={styles.dayChip}>
                        <Text style={styles.dayChipText} numberOfLines={1}>{firstName(e.user_name)}</Text>
                      </View>
                    ))}
                    {list.length > 2 ? <Text style={styles.dayMore}>+{list.length - 2}</Text> : null}
                  </View>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.legendRow}>
            <View style={styles.legendDot} />
            <Text style={styles.legendText}>Hoje</Text>
          </View>
        </ScrollView>
      )}

      <Modal visible={!!dayModal} transparent animationType="fade" onRequestClose={() => setDayModal(null)}>
        <View style={styles.backdrop}>
          <View style={styles.formCard}>
            <Text style={styles.formTitle}>{dayModal ? labelForDay(dayModal) : ''}</Text>

            {dayEntries.length === 0 ? (
              <Text style={styles.emptyLine}>Nenhum funcionário escalado nesse dia.</Text>
            ) : (
              <ScrollView style={{ maxHeight: 220, marginBottom: spacing.md }}>
                {dayEntries.map((e) => (
                  <View key={e.id} style={styles.escalaRow} testID={`escala-entry-${e.id}`}>
                    <View style={styles.escalaAvatar}><Ionicons name="person" size={16} color="#4D7C0F" /></View>
                    <Text style={styles.escalaName}>{e.user_name}</Text>
                    <Pressable testID={`remove-escala-${e.id}`} onPress={() => removeFromDay(e)} hitSlop={10}>
                      <Ionicons name="close-circle" size={20} color={colors.error} />
                    </Pressable>
                  </View>
                ))}
              </ScrollView>
            )}

            {availableStaff.length === 0 ? (
              <Text style={styles.emptyLine}>{staff.length === 0 ? 'Nenhum funcionário cadastrado.' : 'Todos os funcionários já estão escalados nesse dia.'}</Text>
            ) : (
              <SelectField
                testID="escala-pick-staff"
                label="Adicionar funcionário"
                value={pickName}
                options={availableStaff.map((s) => s.name)}
                onChange={setPickName}
                placeholder="Selecione um funcionário"
              />
            )}

            <View style={styles.formActions}>
              <Pressable testID="escala-modal-close" onPress={() => setDayModal(null)} style={[styles.formBtn, styles.formBtnCancel]}>
                <Text style={styles.formBtnTextCancel}>Fechar</Text>
              </Pressable>
              <Pressable
                testID="escala-add-button"
                onPress={addToDay}
                disabled={!pickName || saving}
                style={[styles.formBtn, styles.formBtnPrimary, (!pickName || saving) && { opacity: 0.5 }]}
              >
                {saving ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={styles.formBtnTextSolid}>Escalar</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <AppDialog visible={!!dialog} title={dialog?.title || ''} message={dialog?.message} buttons={dialog?.buttons || []} onRequestClose={closeDialog} testID="escala-dialog" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg, gap: spacing.md },
  title: { color: colors.onSurface, fontSize: typography.xxl, fontWeight: '800' },
  subtitle: { color: colors.onSurfaceSecondary, fontSize: typography.sm, marginTop: 2 },
  monthNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, marginBottom: spacing.md },
  navBtn: { width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, alignItems: 'center', justifyContent: 'center' },
  monthLabel: { color: colors.onSurface, fontSize: typography.lg, fontWeight: '700', textTransform: 'capitalize' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl },
  weekHead: { flexDirection: 'row' },
  weekHeadText: { width: `${100 / 7}%`, textAlign: 'center', color: colors.onSurfaceTertiary, fontSize: typography.sm, fontWeight: '700', marginBottom: spacing.xs },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCellEmpty: { width: `${100 / 7}%`, aspectRatio: 0.8 },
  dayCell: {
    width: `${100 / 7}%`,
    aspectRatio: 0.8,
    borderWidth: 0.5,
    borderColor: colors.divider,
    padding: 3,
  },
  dayCellToday: { backgroundColor: colors.brandTertiary },
  dayNum: { color: colors.onSurface, fontSize: typography.sm, fontWeight: '700' },
  dayNumToday: { color: colors.onBrandTertiary },
  dayChips: { marginTop: 2, gap: 2 },
  dayChip: { backgroundColor: colors.brandPrimary, borderRadius: 4, paddingHorizontal: 3, paddingVertical: 1 },
  dayChipText: { color: colors.onBrandPrimary, fontSize: 9, fontWeight: '700' },
  dayMore: { color: colors.onSurfaceTertiary, fontSize: 9, fontWeight: '700' },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.lg },
  legendDot: { width: 12, height: 12, borderRadius: 3, backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.border },
  legendText: { color: colors.onSurfaceSecondary, fontSize: typography.sm },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: spacing.xl },
  formCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.xl },
  formTitle: { color: colors.onSurface, fontSize: typography.xl, fontWeight: '800', marginBottom: spacing.lg, textTransform: 'capitalize' },
  emptyLine: { color: colors.onSurfaceSecondary, fontSize: typography.base, marginBottom: spacing.lg },
  escalaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider },
  escalaAvatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#ECFCCB', alignItems: 'center', justifyContent: 'center' },
  escalaName: { flex: 1, color: colors.onSurface, fontSize: typography.base, fontWeight: '600' },
  formActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
  formBtn: { flex: 1, paddingVertical: spacing.md, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  formBtnCancel: { backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  formBtnTextCancel: { color: colors.onSurfaceSecondary, fontWeight: '700' },
  formBtnPrimary: { backgroundColor: colors.brandPrimary },
  formBtnTextSolid: { color: '#FFFFFF', fontWeight: '700' },
});
