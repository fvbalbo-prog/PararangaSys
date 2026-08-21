import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl, Modal, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, spacing, radius, typography } from '@/src/theme';
import { formatMoney } from '@/src/format';
import { api } from '@/src/api';
import type { FinanceiroEntry, FinanceiroKind, FinanceiroResumo, FinanceiroStatus, Client, Fornecedor, Recorrencia } from '@/src/api';
import { SelectField } from '@/src/components/SelectField';
import { DateField } from '@/src/components/DateField';
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
function brDate(iso: string) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
function dateToISO(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function parseAmount(s: string): number {
  return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
}

const STATUS_META: Record<FinanceiroStatus, { label: string; bg: string; fg: string }> = {
  pendente: { label: 'Pendente', bg: '#DBEAFE', fg: '#1E3A8A' },
  atrasado: { label: 'Atrasado', bg: '#FEE2E2', fg: colors.error },
  pago: { label: 'Pago', bg: '#DCFCE7', fg: colors.success },
};

const STATUS_FILTERS: { key: FinanceiroStatus | 'todos'; label: string }[] = [
  { key: 'todos', label: 'Todos' },
  { key: 'pendente', label: 'Pendentes' },
  { key: 'atrasado', label: 'Atrasados' },
  { key: 'pago', label: 'Pagos' },
];

export default function AdminFinanceiroScreen() {
  const router = useRouter();
  const [{ year, month }, setYm] = useState(currentMonth());
  const [kind, setKind] = useState<FinanceiroKind>('pagar');
  const [statusFilter, setStatusFilter] = useState<FinanceiroStatus | 'todos'>('todos');
  const [entries, setEntries] = useState<FinanceiroEntry[]>([]);
  const [resumo, setResumo] = useState<FinanceiroResumo | null>(null);
  const [categorias, setCategorias] = useState<{ pagar: string[]; receber: string[] }>({ pagar: [], receber: [] });
  const [clients, setClients] = useState<Client[]>([]);
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [showRecorrencias, setShowRecorrencias] = useState(false);
  const [recorrencias, setRecorrencias] = useState<Recorrencia[]>([]);
  const [recorrenciasLoading, setRecorrenciasLoading] = useState(false);

  const [dialog, setDialog] = useState<{ title: string; message?: string; buttons: DialogButton[] } | null>(null);
  const closeDialog = () => setDialog(null);
  const showInfo = (title: string, message?: string) =>
    setDialog({ title, message, buttons: [{ label: 'OK', variant: 'primary', onPress: closeDialog }] });

  // Formulário de criação
  const [showForm, setShowForm] = useState(false);
  const [fDescription, setFDescription] = useState('');
  const [fCategory, setFCategory] = useState<string | null>(null);
  const [fAmount, setFAmount] = useState('');
  const [fDueDate, setFDueDate] = useState<Date | null>(new Date());
  const [fSupplierName, setFSupplierName] = useState<string | null>(null);
  const [fClientName, setFClientName] = useState<string | null>(null);
  const [fBoatName, setFBoatName] = useState<string | null>(null);
  const [fObservation, setFObservation] = useState('');
  const [fRecurring, setFRecurring] = useState(false);
  const [fRecurringEndMode, setFRecurringEndMode] = useState<'indefinido' | 'data'>('indefinido');
  const [fRecurringEndDate, setFRecurringEndDate] = useState<Date | null>(null);
  const [saving, setSaving] = useState(false);

  // Detalhe / edição
  const [selected, setSelected] = useState<FinanceiroEntry | null>(null);
  const [editing, setEditing] = useState(false);
  const [eDescription, setEDescription] = useState('');
  const [eAmount, setEAmount] = useState('');
  const [eDueDate, setEDueDate] = useState<Date | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const ms = monthStr(year, month);

  const load = useCallback(async () => {
    try {
      const [ents, res] = await Promise.all([
        api.listFinanceiro({ kind, month: ms }),
        api.resumoFinanceiro(ms),
      ]);
      setEntries(ents);
      setResumo(res);
    } catch {
      setEntries([]);
      setResumo(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [kind, ms]);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  useEffect(() => {
    api.financeiroCategorias().then(setCategorias).catch(() => {});
    api.listUsers().then((u) => setClients(u.filter((c) => !c.is_staff))).catch(() => {});
    api.listFornecedores(true).then(setFornecedores).catch(() => {});
  }, []);

  const openRecorrencias = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setShowRecorrencias(true);
    setRecorrenciasLoading(true);
    api.listRecorrencias().then(setRecorrencias).catch(() => setRecorrencias([])).finally(() => setRecorrenciasLoading(false));
  };

  const toggleRecorrencia = async (r: Recorrencia) => {
    try {
      await api.setRecorrenciaActive(r.id, !r.active);
      setRecorrencias((prev) => prev.map((x) => (x.id === r.id ? { ...x, active: !x.active } : x)));
    } catch (e: any) {
      showInfo('Erro', e.message || 'Não foi possível atualizar a recorrência.');
    }
  };

  const cancelRecorrencia = (r: Recorrencia) => {
    setDialog({
      title: 'Cancelar recorrência',
      message: `Cancelar "${r.description}"? Os lançamentos já gerados não são afetados.`,
      buttons: [
        { label: 'Voltar', variant: 'cancel', onPress: closeDialog },
        {
          label: 'Cancelar recorrência',
          variant: 'destructive',
          onPress: async () => {
            closeDialog();
            try {
              await api.deleteRecorrencia(r.id);
              setRecorrencias((prev) => prev.filter((x) => x.id !== r.id));
            } catch (e: any) {
              showInfo('Erro', e.message || 'Não foi possível cancelar.');
            }
          },
        },
      ],
    });
  };

  const shiftMonth = (delta: number) => {
    Haptics.selectionAsync();
    let m = month + delta, y = year;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    setYm({ year: y, month: m });
  };

  const filtered = useMemo(
    () => (statusFilter === 'todos' ? entries : entries.filter((e) => e.status_display === statusFilter)),
    [entries, statusFilter]
  );

  const openForm = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setFDescription('');
    setFCategory(null);
    setFAmount('');
    setFDueDate(new Date());
    setFSupplierName(null);
    setFClientName(null);
    setFBoatName(null);
    setFObservation('');
    setFRecurring(false);
    setFRecurringEndMode('indefinido');
    setFRecurringEndDate(null);
    setShowForm(true);
  };

  const submitForm = async () => {
    if (!fDescription.trim()) return showInfo('Descrição obrigatória', 'Informe uma descrição para o lançamento.');
    const amount = parseAmount(fAmount);
    if (amount <= 0) return showInfo('Valor inválido', 'Informe um valor maior que zero.');
    if (!fCategory) return showInfo('Categoria obrigatória', 'Selecione uma categoria.');
    if (!fDueDate) return showInfo('Data obrigatória', 'Selecione a data de vencimento.');
    if (fRecurring && fRecurringEndMode === 'data' && !fRecurringEndDate) {
      return showInfo('Data de término obrigatória', 'Selecione até quando a cobrança recorrente deve se repetir, ou escolha "Até cancelar".');
    }
    if (fRecurring && fRecurringEndMode === 'data' && fRecurringEndDate && fRecurringEndDate < fDueDate) {
      return showInfo('Data de término inválida', 'A data de término deve ser depois do primeiro vencimento.');
    }
    setSaving(true);
    try {
      const client = kind === 'receber' && fClientName ? clients.find((c) => c.name === fClientName) : null;
      await api.createFinanceiro({
        kind,
        description: fDescription.trim(),
        category: fCategory,
        amount,
        due_date: dateToISO(fDueDate),
        cpf: client?.cpf,
        boat_name: client && fBoatName ? fBoatName : null,
        supplier_name: kind === 'pagar' ? fSupplierName : null,
        observation: fObservation.trim() || null,
        recurring: fRecurring,
        recurring_end_date: fRecurring && fRecurringEndMode === 'data' && fRecurringEndDate ? dateToISO(fRecurringEndDate) : null,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShowForm(false);
      load();
    } catch (e: any) {
      showInfo('Erro', e.message || 'Não foi possível salvar o lançamento.');
    } finally {
      setSaving(false);
    }
  };

  const openDetail = (entry: FinanceiroEntry) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelected(entry);
    setEditing(false);
    setEDescription(entry.description);
    setEAmount(entry.amount.toFixed(2).replace('.', ','));
    setEDueDate(new Date(`${entry.due_date}T00:00:00`));
  };
  const closeDetail = () => { setSelected(null); setEditing(false); };

  const saveEdit = async () => {
    if (!selected || !eDueDate) return;
    const amount = parseAmount(eAmount);
    if (amount <= 0) return showInfo('Valor inválido', 'Informe um valor maior que zero.');
    if (!eDescription.trim()) return showInfo('Descrição obrigatória', 'Informe uma descrição.');
    setActionLoading(true);
    try {
      await api.updateFinanceiro(selected.id, {
        description: eDescription.trim(),
        amount,
        due_date: dateToISO(eDueDate),
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      closeDetail();
      load();
    } catch (e: any) {
      showInfo('Erro', e.message || 'Não foi possível salvar a alteração.');
    } finally {
      setActionLoading(false);
    }
  };

  const markPaid = async () => {
    if (!selected) return;
    setActionLoading(true);
    try {
      await api.payFinanceiro(selected.id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      closeDetail();
      load();
    } catch (e: any) {
      showInfo('Erro', e.message || 'Não foi possível marcar como pago.');
    } finally {
      setActionLoading(false);
    }
  };

  const reopen = async () => {
    if (!selected) return;
    setActionLoading(true);
    try {
      await api.reopenFinanceiro(selected.id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      closeDetail();
      load();
    } catch (e: any) {
      showInfo('Erro', e.message || 'Não foi possível reabrir o lançamento.');
    } finally {
      setActionLoading(false);
    }
  };

  const remove = () => {
    if (!selected) return;
    const target = selected;
    setDialog({
      title: 'Excluir lançamento',
      message: `Excluir "${target.description}" (${formatMoney(target.amount)})?`,
      buttons: [
        { label: 'Cancelar', variant: 'cancel', onPress: closeDialog },
        {
          label: 'Excluir',
          variant: 'destructive',
          onPress: async () => {
            closeDialog();
            try {
              await api.deleteFinanceiro(target.id);
              closeDetail();
              load();
            } catch (e: any) {
              showInfo('Erro', e.message || 'Não foi possível excluir.');
            }
          },
        },
      ],
    });
  };

  const pagarTotal = resumo ? resumo.pagar.pendente + resumo.pagar.atrasado : 0;
  const receberTotal = resumo ? resumo.receber.pendente + resumo.receber.atrasado : 0;

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="admin-financeiro-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={16} testID="back-button">
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <View style={styles.headerTitleBlock}>
          <Text style={styles.title} testID="admin-financeiro-title">Painel Financeiro</Text>
          <Text style={styles.subtitle}>Contas a pagar e a receber</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.headerIconsScroll} contentContainerStyle={styles.headerIconsRow}>
          <Pressable onPress={() => router.push('/admin-financeiro-analise')} testID="financeiro-analise-button" style={styles.iconBtn} hitSlop={12}>
            <Ionicons name="bar-chart-outline" size={22} color={colors.onSurface} />
          </Pressable>
          <Pressable onPress={openRecorrencias} testID="financeiro-recorrencias-button" style={styles.iconBtn} hitSlop={12}>
            <Ionicons name="repeat" size={22} color={colors.onSurface} />
          </Pressable>
          <Pressable onPress={() => router.push('/admin-fornecedores')} testID="financeiro-fornecedores-button" style={styles.iconBtn} hitSlop={12}>
            <Ionicons name="briefcase-outline" size={22} color={colors.onSurface} />
          </Pressable>
          <Pressable onPress={() => router.push('/admin-relatorio')} testID="financeiro-faturamento-button" style={styles.iconBtn} hitSlop={12}>
            <Ionicons name="receipt-outline" size={22} color={colors.onSurface} />
          </Pressable>
          <Pressable onPress={openForm} testID="financeiro-add" style={styles.addBtn} hitSlop={12}>
            <Ionicons name="add" size={24} color="#FFFFFF" />
          </Pressable>
        </ScrollView>
      </View>

      <View style={styles.monthNav}>
        <Pressable onPress={() => shiftMonth(-1)} testID="prev-month" style={styles.navBtn} hitSlop={8}>
          <Ionicons name="chevron-back" size={20} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.monthLabel}>{labelForMonth(year, month)}</Text>
        <Pressable onPress={() => shiftMonth(1)} testID="next-month" style={styles.navBtn} hitSlop={8}>
          <Ionicons name="chevron-forward" size={20} color={colors.onSurface} />
        </Pressable>
      </View>

      <View style={styles.statsRow}>
        <View style={[styles.statCard, { backgroundColor: '#FEF2F2' }]}>
          <Text style={[styles.statValue, { color: colors.error }]}>{formatMoney(pagarTotal)}</Text>
          <Text style={styles.statLabel}>A pagar</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: '#ECFDF5' }]}>
          <Text style={[styles.statValue, { color: colors.success }]}>{formatMoney(receberTotal)}</Text>
          <Text style={styles.statLabel}>A receber</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: colors.surfaceSecondary }]}>
          <Text style={[styles.statValue, { color: (resumo?.saldo_previsto ?? 0) >= 0 ? colors.success : colors.error }]}>
            {formatMoney(resumo?.saldo_previsto ?? 0)}
          </Text>
          <Text style={styles.statLabel}>Saldo previsto</Text>
        </View>
      </View>

      <View style={styles.modeToggle}>
        <Pressable
          testID="kind-pagar"
          onPress={() => { setKind('pagar'); setLoading(true); }}
          style={[styles.modeBtn, kind === 'pagar' && styles.modeBtnActive]}
        >
          <Text style={[styles.modeText, kind === 'pagar' && styles.modeTextActive]}>Contas a Pagar</Text>
        </Pressable>
        <Pressable
          testID="kind-receber"
          onPress={() => { setKind('receber'); setLoading(true); }}
          style={[styles.modeBtn, kind === 'receber' && styles.modeBtnActive]}
        >
          <Text style={[styles.modeText, kind === 'receber' && styles.modeTextActive]}>Contas a Receber</Text>
        </Pressable>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow} style={styles.chipScroller}>
        {STATUS_FILTERS.map((f) => {
          const active = statusFilter === f.key;
          return (
            <Pressable
              key={f.key}
              testID={`status-filter-${f.key}`}
              onPress={() => { setStatusFilter(f.key); Haptics.selectionAsync(); }}
              style={[styles.chip, active && styles.chipActive]}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{f.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
      ) : filtered.length === 0 ? (
        <View style={styles.center}>
          <View style={styles.emptyIcon}><Ionicons name="wallet-outline" size={44} color={colors.brandSecondary} /></View>
          <Text style={styles.emptyTitle}>Nenhum lançamento</Text>
          <Text style={styles.emptySubtitle}>Toque em + para adicionar {kind === 'pagar' ? 'uma conta a pagar' : 'uma conta a receber'}.</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
        >
          {filtered.map((e) => {
            const meta = STATUS_META[e.status_display];
            return (
              <Pressable key={e.id} testID={`financeiro-entry-${e.id}`} onPress={() => openDetail(e)} style={({ pressed }) => [styles.entryRow, pressed && { opacity: 0.85 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.entryDesc} numberOfLines={1}>{e.description}</Text>
                  <Text style={styles.entryMeta} numberOfLines={1}>
                    {e.category} · Venc. {brDate(e.due_date)}
                    {e.client_name ? ` · ${e.client_name}` : ''}
                    {e.boat_name ? ` (${e.boat_name})` : ''}
                    {e.supplier_name ? ` · ${e.supplier_name}` : ''}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Text style={[styles.entryAmount, { color: kind === 'pagar' ? colors.error : colors.success }]}>{formatMoney(e.amount)}</Text>
                  <View style={[styles.statusBadge, { backgroundColor: meta.bg }]}>
                    <Text style={[styles.statusText, { color: meta.fg }]}>{meta.label}</Text>
                  </View>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      {/* Modal: novo lançamento */}
      <Modal visible={showForm} transparent animationType="fade" onRequestClose={() => setShowForm(false)}>
        <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.formCardWrap} keyboardShouldPersistTaps="handled">
            <View style={styles.formCard}>
              <Text style={styles.formTitle}>{kind === 'pagar' ? 'Nova conta a pagar' : 'Nova conta a receber'}</Text>

              <Text style={styles.fieldLabel}>Descrição</Text>
              <TextInput
                testID="financeiro-description-input"
                style={styles.input}
                value={fDescription}
                onChangeText={setFDescription}
                placeholder={kind === 'pagar' ? 'Ex: Combustível das lanchas' : 'Ex: Mensalidade Agosto/2026'}
                placeholderTextColor={colors.onSurfaceTertiary}
              />

              <View style={{ marginTop: spacing.md }}>
                <SelectField
                  testID="financeiro-category-select"
                  label="Categoria"
                  value={fCategory}
                  options={kind === 'pagar' ? categorias.pagar : categorias.receber}
                  onChange={setFCategory}
                  placeholder="Selecione a categoria"
                />
              </View>

              <Text style={[styles.fieldLabel, { marginTop: spacing.md }]}>Valor (R$)</Text>
              <TextInput
                testID="financeiro-amount-input"
                style={styles.input}
                value={fAmount}
                onChangeText={(v) => setFAmount(v.replace(/[^\d.,]/g, ''))}
                placeholder="0,00"
                placeholderTextColor={colors.onSurfaceTertiary}
                keyboardType="decimal-pad"
              />

              <View style={{ marginTop: spacing.md }}>
                <DateField testID="financeiro-due-date" label="Data de vencimento" mode="date" value={fDueDate} onChange={setFDueDate} />
              </View>

              {kind === 'pagar' ? (
                <View style={{ marginTop: spacing.md }}>
                  <SelectField
                    testID="financeiro-supplier-select"
                    label="Fornecedor (opcional)"
                    value={fSupplierName}
                    options={fornecedores.map((f) => f.name)}
                    onChange={setFSupplierName}
                    placeholder={fornecedores.length ? 'Selecione o fornecedor' : 'Nenhum cadastrado ainda'}
                  />
                </View>
              ) : (
                <View style={{ marginTop: spacing.md }}>
                  <SelectField
                    testID="financeiro-client-select"
                    label="Cliente (opcional)"
                    value={fClientName}
                    options={clients.map((c) => c.name)}
                    onChange={(v) => { setFClientName(v); setFBoatName(null); }}
                    placeholder="Vincular a um cliente"
                  />
                  {(() => {
                    const selectedClient = fClientName ? clients.find((c) => c.name === fClientName) : null;
                    if (!selectedClient || selectedClient.boats.length === 0) return null;
                    return (
                      <SelectField
                        testID="financeiro-boat-select"
                        label="Lancha (opcional)"
                        value={fBoatName}
                        options={selectedClient.boats.map((b) => b.name)}
                        onChange={setFBoatName}
                        placeholder="Vincular a uma lancha"
                      />
                    );
                  })()}
                </View>
              )}

              <Text style={[styles.fieldLabel, { marginTop: spacing.md }]}>Observação (opcional)</Text>
              <TextInput
                testID="financeiro-observation-input"
                style={styles.input}
                value={fObservation}
                onChangeText={setFObservation}
                placeholder="Observação"
                placeholderTextColor={colors.onSurfaceTertiary}
              />

              <Pressable
                testID="financeiro-recurring-toggle"
                onPress={() => { setFRecurring((v) => !v); Haptics.selectionAsync(); }}
                style={styles.recurringRow}
              >
                <Ionicons name={fRecurring ? 'checkbox' : 'square-outline'} size={22} color={fRecurring ? colors.brandPrimary : colors.onSurfaceTertiary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.recurringTitle}>Cobrança recorrente</Text>
                  <Text style={styles.recurringSub}>
                    Repete todo mês no dia {fDueDate ? fDueDate.getDate() : '—'} (ex: mensalidade da lancha)
                  </Text>
                </View>
              </Pressable>

              {fRecurring ? (
                <View style={styles.recurringEndBlock}>
                  <Text style={styles.fieldLabel}>Repetir até</Text>
                  <View style={styles.recurringEndToggle}>
                    <Pressable
                      testID="financeiro-recurring-end-indefinido"
                      onPress={() => { setFRecurringEndMode('indefinido'); Haptics.selectionAsync(); }}
                      style={[styles.recurringEndBtn, fRecurringEndMode === 'indefinido' && styles.recurringEndBtnActive]}
                    >
                      <Text style={[styles.recurringEndBtnText, fRecurringEndMode === 'indefinido' && styles.recurringEndBtnTextActive]}>Até cancelar</Text>
                    </Pressable>
                    <Pressable
                      testID="financeiro-recurring-end-data"
                      onPress={() => { setFRecurringEndMode('data'); Haptics.selectionAsync(); }}
                      style={[styles.recurringEndBtn, fRecurringEndMode === 'data' && styles.recurringEndBtnActive]}
                    >
                      <Text style={[styles.recurringEndBtnText, fRecurringEndMode === 'data' && styles.recurringEndBtnTextActive]}>Período com término</Text>
                    </Pressable>
                  </View>
                  {fRecurringEndMode === 'data' ? (
                    <View style={{ marginTop: spacing.sm }}>
                      <DateField testID="financeiro-recurring-end-date" label="Data de término" mode="date" value={fRecurringEndDate} onChange={setFRecurringEndDate} />
                    </View>
                  ) : null}
                </View>
              ) : null}

              <View style={styles.formActions}>
                <Pressable testID="financeiro-form-cancel" onPress={() => setShowForm(false)} style={[styles.formBtn, styles.formBtnCancel]}>
                  <Text style={styles.formBtnTextCancel}>Cancelar</Text>
                </Pressable>
                <Pressable testID="financeiro-form-save" onPress={submitForm} disabled={saving} style={[styles.formBtn, styles.formBtnPrimary]}>
                  {saving ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={styles.formBtnTextSolid}>Salvar</Text>}
                </Pressable>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* Modal: detalhe / edição de um lançamento */}
      <Modal visible={!!selected} transparent animationType="fade" onRequestClose={closeDetail}>
        <View style={styles.backdrop}>
          <View style={styles.formCard}>
            {selected ? (
              editing ? (
                <>
                  <Text style={styles.formTitle}>Editar lançamento</Text>
                  <Text style={styles.fieldLabel}>Descrição</Text>
                  <TextInput testID="financeiro-edit-description" style={styles.input} value={eDescription} onChangeText={setEDescription} />
                  <Text style={[styles.fieldLabel, { marginTop: spacing.md }]}>Valor (R$)</Text>
                  <TextInput
                    testID="financeiro-edit-amount"
                    style={styles.input}
                    value={eAmount}
                    onChangeText={(v) => setEAmount(v.replace(/[^\d.,]/g, ''))}
                    keyboardType="decimal-pad"
                  />
                  <View style={{ marginTop: spacing.md }}>
                    <DateField testID="financeiro-edit-due-date" label="Data de vencimento" mode="date" value={eDueDate} onChange={setEDueDate} />
                  </View>
                  <View style={styles.formActions}>
                    <Pressable testID="financeiro-edit-cancel" onPress={() => setEditing(false)} style={[styles.formBtn, styles.formBtnCancel]}>
                      <Text style={styles.formBtnTextCancel}>Cancelar</Text>
                    </Pressable>
                    <Pressable testID="financeiro-edit-save" onPress={saveEdit} disabled={actionLoading} style={[styles.formBtn, styles.formBtnPrimary]}>
                      {actionLoading ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={styles.formBtnTextSolid}>Salvar</Text>}
                    </Pressable>
                  </View>
                </>
              ) : (
                <>
                  <Text style={styles.formTitle}>{selected.description}</Text>
                  <Text style={styles.detailLine}>Categoria: {selected.category}</Text>
                  <Text style={styles.detailLine}>Vencimento: {brDate(selected.due_date)}</Text>
                  <Text style={styles.detailLine}>Valor: {formatMoney(selected.amount)}</Text>
                  {selected.client_name ? <Text style={styles.detailLine}>Cliente: {selected.client_name}{selected.boat_name ? ` • Lancha: ${selected.boat_name}` : ''}</Text> : null}
                  {selected.supplier_name ? <Text style={styles.detailLine}>Fornecedor: {selected.supplier_name}</Text> : null}
                  {selected.observation ? <Text style={styles.detailLine}>Obs: {selected.observation}</Text> : null}
                  {selected.recurring_id ? (
                    <View style={styles.recurringTag}>
                      <Ionicons name="repeat" size={13} color={colors.brandSecondary} />
                      <Text style={styles.recurringTagText}>Gerado por cobrança recorrente</Text>
                    </View>
                  ) : null}
                  {selected.status === 'pago' ? (
                    <Text style={styles.detailLine}>Pago em {selected.paid_at ? brDate(selected.paid_at.slice(0, 10)) : '—'} · {formatMoney(selected.paid_amount || 0)}</Text>
                  ) : null}

                  <View style={styles.formActions}>
                    <Pressable testID="financeiro-detail-delete" onPress={remove} style={[styles.formBtn, styles.formBtnDanger]}>
                      <Ionicons name="trash-outline" size={18} color={colors.error} />
                    </Pressable>
                    <Pressable testID="financeiro-detail-edit" onPress={() => setEditing(true)} style={[styles.formBtn, styles.formBtnCancel]}>
                      <Text style={styles.formBtnTextCancel}>Editar</Text>
                    </Pressable>
                    {selected.status === 'pago' ? (
                      <Pressable testID="financeiro-detail-reopen" onPress={reopen} disabled={actionLoading} style={[styles.formBtn, styles.formBtnPrimary]}>
                        {actionLoading ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={styles.formBtnTextSolid}>Reabrir</Text>}
                      </Pressable>
                    ) : (
                      <Pressable testID="financeiro-detail-pay" onPress={markPaid} disabled={actionLoading} style={[styles.formBtn, styles.formBtnSuccess]}>
                        {actionLoading ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={styles.formBtnTextSolid}>Marcar pago</Text>}
                      </Pressable>
                    )}
                  </View>
                  <Pressable testID="financeiro-detail-close" onPress={closeDetail} style={styles.closeLink}>
                    <Text style={styles.closeLinkText}>Fechar</Text>
                  </Pressable>
                </>
              )
            ) : null}
          </View>
        </View>
      </Modal>

      {/* Modal: recorrências ativas */}
      <Modal visible={showRecorrencias} transparent animationType="fade" onRequestClose={() => setShowRecorrencias(false)}>
        <View style={styles.backdrop}>
          <View style={[styles.formCard, { maxHeight: '80%' }]}>
            <Text style={styles.formTitle}>Cobranças recorrentes</Text>
            {recorrenciasLoading ? (
              <ActivityIndicator color={colors.brandPrimary} />
            ) : recorrencias.length === 0 ? (
              <Text style={styles.detailLine}>Nenhuma cobrança recorrente cadastrada.</Text>
            ) : (
              <ScrollView style={{ maxHeight: 380 }}>
                {recorrencias.map((r) => (
                  <View key={r.id} style={styles.recorrenciaRow} testID={`recorrencia-${r.id}`}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.entryDesc}>{r.description}</Text>
                      <Text style={styles.entryMeta}>
                        {r.kind === 'pagar' ? 'A pagar' : 'A receber'} · dia {r.day} · {formatMoney(r.amount)}
                        {r.client_name ? ` · ${r.client_name}` : ''}
                        {r.supplier_name ? ` · ${r.supplier_name}` : ''}
                      </Text>
                      <Text style={styles.entryMeta}>{r.end_date ? `Até ${brDate(r.end_date)}` : 'Até cancelar'}</Text>
                    </View>
                    <Pressable testID={`recorrencia-toggle-${r.id}`} onPress={() => toggleRecorrencia(r)} hitSlop={8} style={{ padding: spacing.xs }}>
                      <Ionicons name={r.active ? 'pause-circle-outline' : 'play-circle-outline'} size={24} color={r.active ? colors.brandPrimary : colors.success} />
                    </Pressable>
                    <Pressable testID={`recorrencia-delete-${r.id}`} onPress={() => cancelRecorrencia(r)} hitSlop={8} style={{ padding: spacing.xs }}>
                      <Ionicons name="trash-outline" size={20} color={colors.error} />
                    </Pressable>
                  </View>
                ))}
              </ScrollView>
            )}
            <Pressable testID="recorrencias-close" onPress={() => setShowRecorrencias(false)} style={styles.closeLink}>
              <Text style={styles.closeLinkText}>Fechar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <AppDialog
        visible={!!dialog}
        title={dialog?.title || ''}
        message={dialog?.message}
        buttons={dialog?.buttons || []}
        onRequestClose={closeDialog}
        testID="admin-financeiro-dialog"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg, gap: spacing.md },
  headerTitleBlock: { marginRight: spacing.md },
  headerIconsScroll: { flex: 1 },
  headerIconsRow: { flexDirection: 'row', alignItems: 'center', paddingRight: spacing.xs },
  title: { color: colors.onSurface, fontSize: typography.xxl, fontWeight: '800' },
  subtitle: { color: colors.onSurfaceSecondary, fontSize: typography.sm, marginTop: 2 },
  addBtn: { width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.brandPrimary, alignItems: 'center', justifyContent: 'center' },
  iconBtn: { width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, alignItems: 'center', justifyContent: 'center', marginRight: spacing.sm },
  recurringRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.lg, padding: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md },
  recurringTitle: { color: colors.onSurface, fontSize: typography.base, fontWeight: '700' },
  recurringSub: { color: colors.onSurfaceSecondary, fontSize: typography.sm, marginTop: 2 },
  recurringTag: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: spacing.sm },
  recurringTagText: { color: colors.brandSecondary, fontSize: typography.sm, fontWeight: '700' },
  recurringEndBlock: { marginTop: spacing.md },
  recurringEndToggle: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  recurringEndBtn: { flex: 1, paddingVertical: spacing.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary, alignItems: 'center' },
  recurringEndBtnActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  recurringEndBtnText: { color: colors.onSurfaceSecondary, fontSize: typography.sm, fontWeight: '700' },
  recurringEndBtnTextActive: { color: colors.onBrandPrimary },
  recorrenciaRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider,
  },
  monthNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, marginBottom: spacing.md },
  navBtn: { width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, alignItems: 'center', justifyContent: 'center' },
  monthLabel: { color: colors.onSurface, fontSize: typography.lg, fontWeight: '700', textTransform: 'capitalize' },
  statsRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, marginBottom: spacing.md },
  statCard: { flex: 1, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' },
  statValue: { fontSize: typography.base, fontWeight: '800' },
  statLabel: { color: colors.onSurfaceSecondary, fontSize: 11, marginTop: 2, fontWeight: '600' },
  modeToggle: {
    flexDirection: 'row', gap: spacing.sm, marginHorizontal: spacing.lg, marginBottom: spacing.md,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.xs,
  },
  modeBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.md, borderRadius: radius.sm },
  modeBtnActive: { backgroundColor: colors.brandPrimary },
  modeText: { color: colors.onSurfaceSecondary, fontSize: typography.sm, fontWeight: '700' },
  modeTextActive: { color: colors.onBrandPrimary },
  chipScroller: { maxHeight: 56, flexGrow: 0 },
  chipRow: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  chip: { height: 36, paddingHorizontal: spacing.lg, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontSize: typography.base, fontWeight: '600' },
  chipTextActive: { color: colors.onBrandPrimary },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  emptyIcon: { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg },
  emptyTitle: { color: colors.onSurface, fontSize: typography.lg, fontWeight: '700' },
  emptySubtitle: { color: colors.onSurfaceSecondary, fontSize: typography.base, marginTop: spacing.sm, textAlign: 'center' },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.sm },
  entryRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg,
  },
  entryDesc: { color: colors.onSurface, fontSize: typography.base, fontWeight: '700' },
  entryMeta: { color: colors.onSurfaceSecondary, fontSize: typography.sm, marginTop: 2 },
  entryAmount: { fontSize: typography.base, fontWeight: '800' },
  statusBadge: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill },
  statusText: { fontSize: 11, fontWeight: '700' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  formCardWrap: { alignItems: 'center', justifyContent: 'center', flexGrow: 1, padding: spacing.xl },
  formCard: { width: '100%', maxWidth: 420, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.xl },
  formTitle: { color: colors.onSurface, fontSize: typography.xl, fontWeight: '800', marginBottom: spacing.md },
  fieldLabel: { color: colors.onSurface, fontSize: typography.base, fontWeight: '600', marginBottom: spacing.sm },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    backgroundColor: colors.surfaceSecondary, fontSize: typography.base, color: colors.onSurface,
  },
  formActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xl },
  formBtn: { flex: 1, paddingVertical: spacing.md, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  formBtnPrimary: { backgroundColor: colors.brandPrimary },
  formBtnSuccess: { backgroundColor: colors.success },
  formBtnDanger: { backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, flex: 0, paddingHorizontal: spacing.lg },
  formBtnCancel: { backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  formBtnTextSolid: { color: '#FFFFFF', fontSize: typography.base, fontWeight: '700' },
  formBtnTextCancel: { color: colors.onSurfaceSecondary, fontSize: typography.base, fontWeight: '700' },
  detailLine: { color: colors.onSurfaceSecondary, fontSize: typography.base, marginTop: spacing.xs },
  closeLink: { alignItems: 'center', marginTop: spacing.lg },
  closeLinkText: { color: colors.onSurfaceTertiary, fontSize: typography.sm, fontWeight: '600' },
});
