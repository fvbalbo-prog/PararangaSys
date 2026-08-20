import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, spacing, radius, typography } from '@/src/theme';
import { api, PONTO_LABELS } from '@/src/api';
import type { PontoEntry, PontoRelatorio } from '@/src/api';
import { DateField } from '@/src/components/DateField';
import { AppDialog, type DialogButton } from '@/src/components/AppDialog';

type Mode = 'registros' | 'relatorio';

function pad(n: number) {
  return n.toString().padStart(2, '0');
}
function currentMonth() {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}
function monthBounds(year: number, month: number) {
  const first = `${year}-${pad(month)}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const last = `${year}-${pad(month)}-${pad(lastDay)}`;
  return { first, last };
}
function labelForMonth(year: number, month: number) {
  const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  return `${MONTHS[month - 1]} ${year}`;
}
function brDate(iso: string) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}`;
}
function dateToISO(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function dateToHHMM(d: Date) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function isoToDate(iso: string, hhmm: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  const [h, min] = hhmm.split(':').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, h || 0, min || 0);
}

export default function AdminPontoScreen() {
  const router = useRouter();
  const [{ year, month }, setYm] = useState(currentMonth());
  const [mode, setMode] = useState<Mode>('registros');
  const [entries, setEntries] = useState<PontoEntry[]>([]);
  const [report, setReport] = useState<PontoRelatorio | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const [editing, setEditing] = useState<PontoEntry | null>(null);
  const [editDate, setEditDate] = useState<Date | null>(null);
  const [editTime, setEditTime] = useState<Date | null>(null);
  const [saving, setSaving] = useState(false);

  const [dialog, setDialog] = useState<{ title: string; message?: string; buttons: DialogButton[] } | null>(null);
  const closeDialog = () => setDialog(null);
  const showInfo = (title: string, message?: string) =>
    setDialog({ title, message, buttons: [{ label: 'OK', variant: 'primary', onPress: closeDialog }] });

  const { first, last } = monthBounds(year, month);

  const load = useCallback(async () => {
    try {
      if (mode === 'registros') {
        setEntries(await api.listPonto({ date_from: first, date_to: last }));
      } else {
        setReport(await api.relatorioPonto(first, last));
      }
    } catch {
      setEntries([]);
      setReport(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [first, last, mode]);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  const shiftMonth = (delta: number) => {
    Haptics.selectionAsync();
    let m = month + delta, y = year;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    setYm({ year: y, month: m });
    setExpanded(null);
  };

  const sortedEntries = useMemo(
    () => [...entries].sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time)),
    [entries]
  );

  const openEdit = (entry: PontoEntry) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setEditing(entry);
    const d = isoToDate(entry.date, entry.time);
    setEditDate(d);
    setEditTime(d);
  };

  const closeEdit = () => {
    setEditing(null);
    setEditDate(null);
    setEditTime(null);
  };

  const saveEdit = async () => {
    if (!editing || !editDate || !editTime) return;
    setSaving(true);
    try {
      await api.updatePonto(editing.id, { date: dateToISO(editDate), time: dateToHHMM(editTime) });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      closeEdit();
      load();
    } catch (e: any) {
      showInfo('Erro', e.message || 'Não foi possível salvar a alteração.');
    } finally {
      setSaving(false);
    }
  };

  const deleteEntry = () => {
    if (!editing) return;
    const target = editing;
    setDialog({
      title: 'Remover registro',
      message: `Remover a batida de ${PONTO_LABELS[target.type]} de ${target.user_name} (${brDate(target.date)} ${target.time})?`,
      buttons: [
        { label: 'Cancelar', variant: 'cancel', onPress: closeDialog },
        {
          label: 'Remover',
          variant: 'destructive',
          onPress: async () => {
            closeDialog();
            try {
              await api.deletePonto(target.id);
              closeEdit();
              load();
            } catch (e: any) {
              showInfo('Erro', e.message || 'Não foi possível remover o registro.');
            }
          },
        },
      ],
    });
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="admin-ponto-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={16} testID="back-button">
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} testID="admin-ponto-title">Ponto Eletrônico</Text>
          <Text style={styles.subtitle}>Registros e horas trabalhadas da equipe</Text>
        </View>
      </View>

      <View style={styles.modeToggle}>
        <Pressable
          testID="mode-registros"
          onPress={() => { setMode('registros'); setLoading(true); }}
          style={[styles.modeBtn, mode === 'registros' && styles.modeBtnActive]}
        >
          <Ionicons name="list-outline" size={18} color={mode === 'registros' ? colors.onBrandPrimary : colors.onSurfaceSecondary} />
          <Text style={[styles.modeText, mode === 'registros' && styles.modeTextActive]}>Registros</Text>
        </Pressable>
        <Pressable
          testID="mode-relatorio"
          onPress={() => { setMode('relatorio'); setLoading(true); }}
          style={[styles.modeBtn, mode === 'relatorio' && styles.modeBtnActive]}
        >
          <Ionicons name="bar-chart-outline" size={18} color={mode === 'relatorio' ? colors.onBrandPrimary : colors.onSurfaceSecondary} />
          <Text style={[styles.modeText, mode === 'relatorio' && styles.modeTextActive]}>Relatório de horas</Text>
        </Pressable>
      </View>

      <View style={styles.monthNav}>
        <Pressable onPress={() => shiftMonth(-1)} testID="prev-month" style={styles.navBtn} hitSlop={8}>
          <Ionicons name="chevron-back" size={20} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.monthLabel} testID="ponto-month-label">{labelForMonth(year, month)}</Text>
        <Pressable onPress={() => shiftMonth(1)} testID="next-month" style={styles.navBtn} hitSlop={8}>
          <Ionicons name="chevron-forward" size={20} color={colors.onSurface} />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
      ) : mode === 'registros' ? (
        sortedEntries.length === 0 ? (
          <View style={styles.center}>
            <View style={styles.emptyIcon}><Ionicons name="time-outline" size={44} color={colors.brandSecondary} /></View>
            <Text style={styles.emptyTitle}>Nenhum registro neste mês</Text>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
          >
            {sortedEntries.map((e) => (
              <Pressable key={e.id} testID={`ponto-entry-${e.id}`} onPress={() => openEdit(e)} style={({ pressed }) => [styles.entryRow, pressed && { opacity: 0.85 }]}>
                <View style={styles.entryTimeBlock}>
                  <Text style={styles.entryDate}>{brDate(e.date)}</Text>
                  <Text style={styles.entryTime}>{e.time}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.entryName} numberOfLines={1}>{e.user_name}</Text>
                  <Text style={styles.entryLabel}>{PONTO_LABELS[e.type]}</Text>
                </View>
                {e.edited ? (
                  <View style={styles.editedTag}>
                    <Ionicons name="pencil" size={11} color={colors.brandSecondary} />
                    <Text style={styles.editedText}>editado</Text>
                  </View>
                ) : null}
                <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
              </Pressable>
            ))}
          </ScrollView>
        )
      ) : !report || report.employees.length === 0 ? (
        <View style={styles.center}>
          <View style={styles.emptyIcon}><Ionicons name="bar-chart-outline" size={44} color={colors.brandSecondary} /></View>
          <Text style={styles.emptyTitle}>Sem dados para o relatório</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
        >
          {report.employees.map((emp) => {
            const isOpen = expanded === emp.cpf;
            return (
              <View key={emp.cpf} style={styles.empCard}>
                <Pressable
                  testID={`relatorio-emp-${emp.cpf}`}
                  onPress={() => { Haptics.selectionAsync(); setExpanded(isOpen ? null : emp.cpf); }}
                  style={styles.empHeader}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.empName}>{emp.name}</Text>
                    <Text style={styles.empSub}>{emp.days.length} {emp.days.length === 1 ? 'dia trabalhado' : 'dias trabalhados'}</Text>
                  </View>
                  <Text style={styles.empHours}>{emp.total_hours.toFixed(2)}h</Text>
                  <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={18} color={colors.onSurfaceTertiary} />
                </Pressable>
                {isOpen ? (
                  <View style={styles.empDays}>
                    {emp.days.map((d) => (
                      <View key={d.date} style={styles.dayRow}>
                        <Text style={styles.dayDate}>{brDate(d.date)}</Text>
                        <Text style={styles.dayTimes}>
                          {d.entrada || '—'} · {d.saida_almoco || '—'} · {d.retorno_almoco || '—'} · {d.saida_final || '—'}
                        </Text>
                        <Text style={styles.dayHours}>{d.hours.toFixed(2)}h</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            );
          })}
        </ScrollView>
      )}

      <Modal visible={!!editing} transparent animationType="fade" onRequestClose={closeEdit}>
        <View style={styles.editBackdrop}>
          <View style={styles.editCard}>
            <Text style={styles.editTitle}>Editar registro</Text>
            {editing ? (
              <Text style={styles.editSubtitle}>{editing.user_name} · {PONTO_LABELS[editing.type]}</Text>
            ) : null}
            <View style={{ marginTop: spacing.lg }}>
              <DateField testID="edit-ponto-date" label="Data" mode="date" value={editDate} onChange={setEditDate} />
            </View>
            <View style={{ marginTop: spacing.md }}>
              <DateField testID="edit-ponto-time" label="Hora" mode="time" value={editTime} onChange={setEditTime} />
            </View>
            <View style={styles.editActions}>
              <Pressable testID="edit-ponto-delete" onPress={deleteEntry} style={[styles.editBtn, styles.editBtnDanger]}>
                <Ionicons name="trash-outline" size={16} color={colors.error} />
              </Pressable>
              <Pressable testID="edit-ponto-cancel" onPress={closeEdit} style={[styles.editBtn, styles.editBtnCancel]}>
                <Text style={styles.editBtnTextCancel}>Cancelar</Text>
              </Pressable>
              <Pressable testID="edit-ponto-save" onPress={saveEdit} disabled={saving} style={[styles.editBtn, styles.editBtnPrimary]}>
                {saving ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={styles.editBtnTextSolid}>Salvar</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <AppDialog
        visible={!!dialog}
        title={dialog?.title || ''}
        message={dialog?.message}
        buttons={dialog?.buttons || []}
        onRequestClose={closeDialog}
        testID="admin-ponto-dialog"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg, gap: spacing.md },
  title: { color: colors.onSurface, fontSize: typography.xxl, fontWeight: '800' },
  subtitle: { color: colors.onSurfaceSecondary, fontSize: typography.sm, marginTop: 2 },
  modeToggle: {
    flexDirection: 'row', gap: spacing.sm, marginHorizontal: spacing.lg, marginBottom: spacing.md,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.xs,
  },
  modeBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingVertical: spacing.md, borderRadius: radius.sm },
  modeBtnActive: { backgroundColor: colors.brandPrimary },
  modeText: { color: colors.onSurfaceSecondary, fontSize: typography.sm, fontWeight: '700' },
  modeTextActive: { color: colors.onBrandPrimary },
  monthNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, marginBottom: spacing.md },
  navBtn: { width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, alignItems: 'center', justifyContent: 'center' },
  monthLabel: { color: colors.onSurface, fontSize: typography.lg, fontWeight: '700', textTransform: 'capitalize' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  emptyIcon: { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg },
  emptyTitle: { color: colors.onSurface, fontSize: typography.lg, fontWeight: '700' },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.sm },
  entryRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md,
  },
  entryTimeBlock: { alignItems: 'center', minWidth: 52 },
  entryDate: { color: colors.onSurfaceTertiary, fontSize: typography.sm, fontWeight: '700' },
  entryTime: { color: colors.onSurface, fontSize: typography.lg, fontWeight: '800' },
  entryName: { color: colors.onSurface, fontSize: typography.base, fontWeight: '700' },
  entryLabel: { color: colors.onSurfaceSecondary, fontSize: typography.sm, marginTop: 2 },
  editedTag: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  editedText: { color: colors.brandSecondary, fontSize: 11, fontWeight: '700' },
  empCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  empHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.lg },
  empName: { color: colors.onSurface, fontSize: typography.base, fontWeight: '800' },
  empSub: { color: colors.onSurfaceSecondary, fontSize: typography.sm, marginTop: 2 },
  empHours: { color: colors.brandPrimary, fontSize: typography.lg, fontWeight: '800' },
  empDays: { borderTopWidth: 1, borderTopColor: colors.border, padding: spacing.lg, gap: spacing.sm },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dayDate: { color: colors.onSurface, fontSize: typography.sm, fontWeight: '700', width: 40 },
  dayTimes: { flex: 1, color: colors.onSurfaceSecondary, fontSize: typography.sm },
  dayHours: { color: colors.onSurface, fontSize: typography.sm, fontWeight: '700' },
  editBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  editCard: { width: '100%', maxWidth: 380, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.xl },
  editTitle: { color: colors.onSurface, fontSize: typography.xl, fontWeight: '800' },
  editSubtitle: { color: colors.onSurfaceSecondary, fontSize: typography.sm, marginTop: 2 },
  editActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xl },
  editBtn: { paddingVertical: spacing.md, paddingHorizontal: spacing.lg, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  editBtnPrimary: { backgroundColor: colors.brandPrimary, flex: 1 },
  editBtnCancel: { backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, flex: 1 },
  editBtnDanger: { backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  editBtnTextSolid: { color: '#FFFFFF', fontSize: typography.base, fontWeight: '700' },
  editBtnTextCancel: { color: colors.onSurfaceSecondary, fontSize: typography.base, fontWeight: '700' },
});
