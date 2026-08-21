import { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, Modal, TextInput,
  KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, spacing, radius, typography } from '@/src/theme';
import { AppDialog, type DialogButton } from '@/src/components/AppDialog';
import { DateField } from '@/src/components/DateField';
import { formatMoney } from '@/src/format';
import { api } from '@/src/api';
import type { Client, Boat } from '@/src/api';

function formatCpf(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length > 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (d.length > 6) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  if (d.length > 3) return `${d.slice(0, 3)}.${d.slice(3)}`;
  return d;
}
function pad(n: number) {
  return n.toString().padStart(2, '0');
}
function dateToISO(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function brDate(iso: string) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
function daysUntil(iso: string): number {
  const today = new Date();
  const target = new Date(`${iso}T00:00:00`);
  return Math.round((target.getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86400000);
}

export default function AdminCadClientesScreen() {
  const router = useRouter();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [clientModal, setClientModal] = useState(false);
  const [cCpf, setCCpf] = useState('');
  const [cName, setCName] = useState('');
  const [cPhone, setCPhone] = useState('');

  const [boatModalCpf, setBoatModalCpf] = useState<string | null>(null);
  const [boatEditName, setBoatEditName] = useState<string | null>(null);
  const [boatName, setBoatName] = useState('');
  const [boatDraft, setBoatDraft] = useState('');
  const [boatLength, setBoatLength] = useState('');
  const [boatFee, setBoatFee] = useState('');
  const [boatFeeValidUntil, setBoatFeeValidUntil] = useState<Date | null>(null);
  const [boatDueDay, setBoatDueDay] = useState('');

  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ title: string; message?: string; buttons: DialogButton[] } | null>(null);
  const closeDialog = () => setDialog(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setClients(await api.listUsers());
    } catch (e: any) {
      setError(e.message || 'Erro ao carregar.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  const only = clients.filter((c) => !c.is_staff);

  const toggleActive = (item: any) => {
    const next = item.active === false;
    setDialog({
      title: next ? 'Reativar acesso' : 'Excluir acesso',
      message: next
        ? `Reativar o acesso de ${item.name}?`
        : `${item.name} perderá o acesso ao app, mas os registros serão mantidos. Confirmar?`,
      buttons: [
        { label: 'Cancelar', variant: 'cancel', onPress: closeDialog },
        {
          label: next ? 'Reativar' : 'Excluir',
          variant: next ? 'primary' : 'destructive',
          testID: `confirm-toggle-${item.cpf}`,
          onPress: async () => {
            closeDialog();
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            setClients((prev) => prev.map((c) => (c.cpf === item.cpf ? { ...c, active: next } : c)));
            try { await api.setUserActive(item.cpf, next); } catch { load(); }
          },
        },
      ],
    });
  };

  const submitClient = async () => {
    setModalError(null);
    const digits = cCpf.replace(/\D/g, '');
    if (digits.length !== 11 || !cName.trim() || !cPhone.trim()) {
      setModalError('Preencha CPF (11 dígitos), nome e telefone.');
      return;
    }
    try {
      setSaving(true);
      const created = await api.createClient({ cpf: digits, name: cName.trim(), phone: cPhone.trim(), boats: [], is_staff: false });
      setClients((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setClientModal(false);
      setCCpf(''); setCName(''); setCPhone('');
    } catch (e: any) {
      setModalError(e.message || 'Erro ao cadastrar.');
    } finally {
      setSaving(false);
    }
  };

  const openBoatModal = (cpf: string) => {
    setBoatModalCpf(cpf); setBoatEditName(null);
    setBoatName(''); setBoatDraft(''); setBoatLength(''); setBoatFee(''); setBoatFeeValidUntil(null); setBoatDueDay('');
    setModalError(null);
  };

  const openEditBoatModal = (cpf: string, boat: Boat) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setBoatModalCpf(cpf); setBoatEditName(boat.name);
    setBoatName(boat.name);
    setBoatDraft(boat.draft != null ? String(boat.draft) : '');
    setBoatLength(boat.length != null ? String(boat.length) : '');
    setBoatFee(boat.monthly_fee != null ? String(boat.monthly_fee) : '');
    setBoatFeeValidUntil(boat.monthly_fee_valid_until ? new Date(`${boat.monthly_fee_valid_until}T00:00:00`) : null);
    setBoatDueDay(boat.mensalidade_due_day != null ? String(boat.mensalidade_due_day) : '');
    setModalError(null);
  };

  const submitBoat = async () => {
    if (!boatModalCpf) return;
    if (!boatName.trim()) { setModalError('Informe o nome da lancha.'); return; }
    const draft = boatDraft ? parseFloat(boatDraft.replace(',', '.')) : null;
    const length = boatLength ? parseFloat(boatLength.replace(',', '.')) : null;
    const monthly_fee = boatFee ? parseFloat(boatFee.replace(',', '.')) : null;
    const monthly_fee_valid_until = boatFeeValidUntil ? dateToISO(boatFeeValidUntil) : null;
    const dueDayNum = boatDueDay ? parseInt(boatDueDay, 10) : null;
    if (dueDayNum != null && (Number.isNaN(dueDayNum) || dueDayNum < 1 || dueDayNum > 31)) {
      setModalError('Dia de vencimento da mensalidade deve ser entre 1 e 31.');
      return;
    }
    const mensalidade_due_day = dueDayNum;
    try {
      setSaving(true);
      const updated = boatEditName
        ? await api.updateBoat(boatModalCpf, boatEditName, { draft, length, monthly_fee, monthly_fee_valid_until, mensalidade_due_day })
        : await api.addBoat(boatModalCpf, { name: boatName.trim(), draft, length, monthly_fee, monthly_fee_valid_until, mensalidade_due_day });
      setClients((prev) => prev.map((c) => (c.cpf === updated.cpf ? updated : c)));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setBoatModalCpf(null);
    } catch (e: any) {
      setModalError(e.message || 'Erro ao salvar.');
    } finally {
      setSaving(false);
    }
  };

  const removeBoat = (cpf: string, name: string) => {
    setDialog({
      title: 'Remover lancha',
      message: `Remover a lancha "${name}"?`,
      buttons: [
        { label: 'Cancelar', variant: 'cancel', onPress: closeDialog },
        {
          label: 'Remover', variant: 'destructive', testID: `confirm-remove-boat-${cpf}-${name}`,
          onPress: async () => {
            closeDialog();
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            setClients((prev) => prev.map((c) => (c.cpf === cpf ? { ...c, boats: c.boats.filter((b) => b.name !== name) } : c)));
            try { await api.removeBoat(cpf, name); } catch { load(); }
          },
        },
      ],
    });
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="cad-clientes-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={16} testID="back-button">
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} testID="clientes-title">Clientes</Text>
          <Text style={styles.subtitle}>{only.length} cadastrados</Text>
        </View>
        <Pressable onPress={() => { setClientModal(true); setModalError(null); }} hitSlop={12} testID="new-client-button" style={styles.addBtn}>
          <Ionicons name="person-add-outline" size={20} color={colors.onBrandPrimary} />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable style={styles.retryBtn} onPress={load}><Text style={styles.retryText}>Tentar novamente</Text></Pressable>
        </View>
      ) : (
        <FlatList
          data={only}
          keyExtractor={(c) => c.cpf}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.noBoats}>Nenhum cliente cadastrado.</Text>}
          renderItem={({ item }) => (
            <View style={[styles.card, item.active === false && styles.cardInactive]} testID={`client-card-${item.cpf}`}>
              <View style={styles.clientHead}>
                <View style={styles.avatar}><Ionicons name="person" size={20} color={colors.brandPrimary} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.clientName}>{item.name}</Text>
                  <Text style={styles.clientMeta}>{formatCpf(item.cpf)} • {item.phone}</Text>
                </View>
                {item.active === false ? (
                  <View style={[styles.badge, { backgroundColor: colors.error }]}>
                    <Ionicons name="ban-outline" size={12} color="#FFFFFF" />
                    <Text style={styles.badgeText}>Sem acesso</Text>
                  </View>
                ) : null}
              </View>

              <View style={styles.boatsSection}>
                <Text style={styles.boatsSectionLabel}>Lanchas</Text>
                {item.boats.length === 0 ? (
                  <Text style={styles.noBoats}>Nenhuma lancha cadastrada.</Text>
                ) : (
                  item.boats.map((b) => {
                    const expiring = b.monthly_fee_valid_until != null && daysUntil(b.monthly_fee_valid_until) <= 30;
                    return (
                      <Pressable key={b.name} onPress={() => openEditBoatModal(item.cpf, b)} style={styles.boatRow} testID={`boat-${item.cpf}-${b.name}`}>
                        <Ionicons name="boat" size={18} color={colors.brandPrimary} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.boatName}>{b.name}</Text>
                          <Text style={styles.boatSpec}>
                            Calado: {b.draft != null ? `${b.draft} m` : '—'} • Comprimento: {b.length != null ? `${b.length} pés` : '—'}
                          </Text>
                          {b.monthly_fee != null ? (
                            <Text style={styles.boatSpec}>Mensalidade: {formatMoney(b.monthly_fee)}{b.monthly_fee_valid_until ? ` • válida até ${brDate(b.monthly_fee_valid_until)}` : ''}</Text>
                          ) : null}
                          {b.mensalidade_due_day != null ? (
                            <Text style={styles.boatSpec}>Vencimento mensal: dia {b.mensalidade_due_day}</Text>
                          ) : null}
                          {expiring ? (
                            <View style={styles.expiringTag} testID={`boat-expiring-${item.cpf}-${b.name}`}>
                              <Ionicons name="alert-circle" size={12} color={colors.error} />
                              <Text style={styles.expiringText}>
                                {daysUntil(b.monthly_fee_valid_until!) < 0 ? 'Mensalidade vencida' : `Vence em ${daysUntil(b.monthly_fee_valid_until!)} dia(s)`}
                              </Text>
                            </View>
                          ) : null}
                        </View>
                        <Pressable testID={`remove-boat-${item.cpf}-${b.name}`} hitSlop={8} onPress={() => removeBoat(item.cpf, b.name)} style={styles.trashBtn}>
                          <Ionicons name="trash-outline" size={18} color={colors.error} />
                        </Pressable>
                      </Pressable>
                    );
                  })
                )}
                <Pressable testID={`add-boat-${item.cpf}`} onPress={() => openBoatModal(item.cpf)} style={({ pressed }) => [styles.addBoatBtn, pressed && { opacity: 0.85 }]}>
                  <Ionicons name="add-circle-outline" size={18} color={colors.brandPrimary} />
                  <Text style={styles.addBoatText}>Adicionar lancha</Text>
                </Pressable>
              </View>

              <Pressable
                testID={`toggle-active-${item.cpf}`}
                onPress={() => toggleActive(item)}
                style={({ pressed }) => [styles.accessBtn, pressed && { opacity: 0.85 }]}
              >
                <Ionicons name={item.active === false ? 'lock-open-outline' : 'ban-outline'} size={16} color={item.active === false ? colors.success : colors.error} />
                <Text style={[styles.accessText, { color: item.active === false ? colors.success : colors.error }]}>
                  {item.active === false ? 'Reativar acesso' : 'Excluir acesso'}
                </Text>
              </Pressable>
            </View>
          )}
        />
      )}

      <Modal visible={clientModal} transparent animationType="slide" onRequestClose={() => setClientModal(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={() => setClientModal(false)} />
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Novo cliente</Text>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.fieldLabel}>CPF</Text>
              <TextInput testID="client-cpf-input" style={styles.input} value={cCpf} onChangeText={(v) => setCCpf(formatCpf(v))} placeholder="000.000.000-00" placeholderTextColor={colors.onSurfaceTertiary} keyboardType="number-pad" inputMode="numeric" maxLength={14} />
              <Text style={styles.fieldLabel}>Nome</Text>
              <TextInput testID="client-name-input" style={styles.input} value={cName} onChangeText={setCName} placeholder="Nome do cliente" placeholderTextColor={colors.onSurfaceTertiary} />
              <Text style={styles.fieldLabel}>Telefone</Text>
              <TextInput testID="client-phone-input" style={styles.input} value={cPhone} onChangeText={setCPhone} placeholder="(00) 00000-0000" placeholderTextColor={colors.onSurfaceTertiary} keyboardType="phone-pad" />
              {modalError ? <Text style={styles.modalError}>{modalError}</Text> : null}
            </ScrollView>
            <View style={styles.modalActions}>
              <Pressable style={[styles.modalBtn, styles.modalCancel]} onPress={() => setClientModal(false)}>
                <Text style={styles.modalCancelText}>Cancelar</Text>
              </Pressable>
              <Pressable testID="save-client-button" style={[styles.modalBtn, styles.modalSave]} onPress={submitClient} disabled={saving}>
                {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.modalSaveText}>Cadastrar</Text>}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={!!boatModalCpf} transparent animationType="slide" onRequestClose={() => setBoatModalCpf(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={() => setBoatModalCpf(null)} />
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>{boatEditName ? 'Editar lancha' : 'Nova lancha'}</Text>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.fieldLabel}>Nome da lancha</Text>
              <TextInput testID="boat-name-input" style={[styles.input, boatEditName ? styles.inputDisabled : null]} value={boatName} onChangeText={setBoatName} editable={!boatEditName} placeholder="Ex.: Netuno" placeholderTextColor={colors.onSurfaceTertiary} />
              <Text style={styles.fieldLabel}>Calado (metros)</Text>
              <TextInput testID="boat-draft-input" style={styles.input} value={boatDraft} onChangeText={setBoatDraft} placeholder="Ex.: 0.8" placeholderTextColor={colors.onSurfaceTertiary} keyboardType="decimal-pad" inputMode="decimal" />
              <Text style={styles.fieldLabel}>Comprimento (pés)</Text>
              <TextInput testID="boat-length-input" style={styles.input} value={boatLength} onChangeText={setBoatLength} placeholder="Ex.: 24" placeholderTextColor={colors.onSurfaceTertiary} keyboardType="decimal-pad" inputMode="decimal" />
              <Text style={styles.fieldLabel}>Valor da mensalidade (R$)</Text>
              <TextInput testID="boat-fee-input" style={styles.input} value={boatFee} onChangeText={setBoatFee} placeholder="Ex.: 800,00" placeholderTextColor={colors.onSurfaceTertiary} keyboardType="decimal-pad" inputMode="decimal" />
              <View style={{ marginTop: spacing.sm }}>
                <DateField testID="boat-fee-valid-until" label="Validade do valor da mensalidade" mode="date" value={boatFeeValidUntil} onChange={setBoatFeeValidUntil} />
              </View>
              <Text style={styles.fieldLabel}>Dia de vencimento da mensalidade (1-31)</Text>
              <TextInput testID="boat-due-day-input" style={styles.input} value={boatDueDay} onChangeText={setBoatDueDay} placeholder="Ex.: 10" placeholderTextColor={colors.onSurfaceTertiary} keyboardType="number-pad" inputMode="numeric" maxLength={2} />
              {modalError ? <Text style={styles.modalError}>{modalError}</Text> : null}
            </ScrollView>
            <View style={styles.modalActions}>
              <Pressable style={[styles.modalBtn, styles.modalCancel]} onPress={() => setBoatModalCpf(null)}>
                <Text style={styles.modalCancelText}>Cancelar</Text>
              </Pressable>
              <Pressable testID="save-boat-button" style={[styles.modalBtn, styles.modalSave]} onPress={submitBoat} disabled={saving}>
                {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.modalSaveText}>Salvar</Text>}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <AppDialog visible={!!dialog} title={dialog?.title || ''} message={dialog?.message} buttons={dialog?.buttons || []} onRequestClose={closeDialog} testID="clientes-dialog" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg, gap: spacing.md },
  title: { color: colors.onSurface, fontSize: typography.xxl, fontWeight: '800' },
  subtitle: { color: colors.onSurfaceSecondary, fontSize: typography.sm, marginTop: 2 },
  addBtn: { padding: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.brandPrimary },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  errorText: { color: colors.error, fontSize: typography.base, textAlign: 'center' },
  retryBtn: { marginTop: spacing.lg, backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.md },
  retryText: { color: colors.onBrandPrimary, fontWeight: '700' },
  list: { padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.md },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
  cardInactive: { opacity: 0.6 },
  clientHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  clientName: { color: colors.onSurface, fontSize: typography.lg, fontWeight: '800' },
  clientMeta: { color: colors.onSurfaceSecondary, fontSize: typography.sm, marginTop: 2 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 4 },
  badgeText: { color: '#FFFFFF', fontSize: typography.sm, fontWeight: '700' },
  boatsSection: { marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  boatsSectionLabel: { color: colors.onSurfaceSecondary, fontSize: typography.sm, fontWeight: '700', marginBottom: spacing.sm, textTransform: 'uppercase', letterSpacing: 0.5 },
  noBoats: { color: colors.onSurfaceTertiary, fontSize: typography.base, fontStyle: 'italic', marginBottom: spacing.sm },
  boatRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.sm, padding: spacing.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border },
  boatName: { color: colors.onSurface, fontSize: typography.base, fontWeight: '700' },
  boatSpec: { color: colors.onSurfaceSecondary, fontSize: typography.sm, marginTop: 2 },
  expiringTag: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  expiringText: { color: colors.error, fontSize: typography.sm, fontWeight: '700' },
  trashBtn: { padding: spacing.xs },
  addBoatBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, marginTop: spacing.xs },
  addBoatText: { color: colors.brandPrimary, fontSize: typography.base, fontWeight: '700' },
  accessBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, marginTop: spacing.md, paddingVertical: spacing.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border },
  accessText: { fontSize: typography.base, fontWeight: '700' },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  modalSheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.xl, maxHeight: '80%' },
  modalTitle: { color: colors.onSurface, fontSize: typography.xl, fontWeight: '800', marginBottom: spacing.lg },
  fieldLabel: { color: colors.onSurface, fontSize: typography.base, fontWeight: '600', marginBottom: spacing.sm, marginTop: spacing.sm },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, fontSize: typography.lg, color: colors.onSurface, backgroundColor: colors.surfaceSecondary },
  inputDisabled: { opacity: 0.6 },
  modalError: { color: colors.error, fontSize: typography.base, marginTop: spacing.md },
  modalActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
  modalBtn: { flex: 1, paddingVertical: spacing.lg, borderRadius: radius.md, alignItems: 'center' },
  modalCancel: { backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  modalCancelText: { color: colors.onSurfaceSecondary, fontWeight: '700', fontSize: typography.lg },
  modalSave: { backgroundColor: colors.brandPrimary },
  modalSaveText: { color: colors.onBrandPrimary, fontWeight: '700', fontSize: typography.lg },
});
