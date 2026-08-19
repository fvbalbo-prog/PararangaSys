import { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, spacing, radius, typography } from '@/src/theme';
import { api } from '@/src/api';
import type { Client } from '@/src/api';

function formatCpf(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length > 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (d.length > 6) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  if (d.length > 3) return `${d.slice(0, 3)}.${d.slice(3)}`;
  return d;
}

export default function AdminClientesScreen() {
  const router = useRouter();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // add-boat modal
  const [boatModalCpf, setBoatModalCpf] = useState<string | null>(null);
  const [boatName, setBoatName] = useState('');
  const [boatDraft, setBoatDraft] = useState('');
  const [boatLength, setBoatLength] = useState('');
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // new-client modal
  const [clientModal, setClientModal] = useState(false);
  const [cCpf, setCCpf] = useState('');
  const [cName, setCName] = useState('');
  const [cPhone, setCPhone] = useState('');
  const [cIsStaff, setCIsStaff] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await api.listUsers();
      setClients(data);
    } catch (e: any) {
      setError(e.message || 'Erro ao carregar.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
    }, [load])
  );

  const openBoatModal = (cpf: string) => {
    setBoatModalCpf(cpf);
    setBoatName('');
    setBoatDraft('');
    setBoatLength('');
    setModalError(null);
  };

  const submitBoat = async () => {
    if (!boatModalCpf) return;
    if (!boatName.trim()) {
      setModalError('Informe o nome da lancha.');
      return;
    }
    try {
      setSaving(true);
      const updated = await api.addBoat(boatModalCpf, {
        name: boatName.trim(),
        draft: boatDraft ? parseFloat(boatDraft.replace(',', '.')) : null,
        length: boatLength ? parseFloat(boatLength.replace(',', '.')) : null,
      });
      setClients((prev) => prev.map((c) => (c.cpf === updated.cpf ? updated : c)));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setBoatModalCpf(null);
    } catch (e: any) {
      setModalError(e.message || 'Erro ao salvar.');
    } finally {
      setSaving(false);
    }
  };

  const removeBoat = async (cpf: string, name: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    setClients((prev) =>
      prev.map((c) => (c.cpf === cpf ? { ...c, boats: c.boats.filter((b) => b.name !== name) } : c))
    );
    try {
      await api.removeBoat(cpf, name);
    } catch {
      load();
    }
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
      const created = await api.createClient({ cpf: digits, name: cName.trim(), phone: cPhone.trim(), boats: [], is_staff: cIsStaff });
      setClients((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setClientModal(false);
      setCCpf(''); setCName(''); setCPhone(''); setCIsStaff(false);
    } catch (e: any) {
      setModalError(e.message || 'Erro ao cadastrar.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={16} testID="back-button">
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} testID="clientes-title">Cadastro de Lanchas</Text>
          <Text style={styles.subtitle}>Clientes e suas embarcações</Text>
        </View>
        <Pressable onPress={() => { setClientModal(true); setModalError(null); }} hitSlop={12} testID="new-client-button" style={styles.addClientBtn}>
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
          data={clients}
          keyExtractor={(c) => c.cpf}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={styles.card} testID={`client-card-${item.cpf}`}>
              <View style={styles.clientHead}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.clientName}>{item.name}</Text>
                  <Text style={styles.clientMeta}>{formatCpf(item.cpf)} • {item.phone}</Text>
                </View>
                {item.is_staff ? (
                  <View style={styles.staffBadge}>
                    <Ionicons name="briefcase-outline" size={12} color={colors.onBrandPrimary} />
                    <Text style={styles.staffBadgeText}>Funcionário</Text>
                  </View>
                ) : null}
              </View>

              {item.is_staff ? (
                <Text style={styles.noBoats}>Acesso ao painel de funcionário.</Text>
              ) : (
                <>
                  {item.boats.length === 0 ? (
                    <Text style={styles.noBoats}>Nenhuma lancha cadastrada.</Text>
                  ) : (
                    item.boats.map((b) => (
                      <View key={b.name} style={styles.boatRow} testID={`boat-${item.cpf}-${b.name}`}>
                        <Ionicons name="boat" size={18} color={colors.brandPrimary} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.boatName}>{b.name}</Text>
                          <Text style={styles.boatSpec}>
                            Calado: {b.draft != null ? `${b.draft} m` : '—'} • Comprimento: {b.length != null ? `${b.length} pés` : '—'}
                          </Text>
                        </View>
                        <Pressable
                          testID={`remove-boat-${item.cpf}-${b.name}`}
                          hitSlop={8}
                          onPress={() => removeBoat(item.cpf, b.name)}
                          style={styles.trashBtn}
                        >
                          <Ionicons name="trash-outline" size={18} color={colors.error} />
                        </Pressable>
                      </View>
                    ))
                  )}

                  <Pressable
                    testID={`add-boat-${item.cpf}`}
                    onPress={() => openBoatModal(item.cpf)}
                    style={({ pressed }) => [styles.addBoatBtn, pressed && { opacity: 0.85 }]}
                  >
                    <Ionicons name="add-circle-outline" size={18} color={colors.brandPrimary} />
                    <Text style={styles.addBoatText}>Adicionar lancha</Text>
                  </Pressable>
                </>
              )}
            </View>
          )}
        />
      )}

      {/* Add boat modal */}
      <Modal visible={!!boatModalCpf} transparent animationType="slide" onRequestClose={() => setBoatModalCpf(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={() => setBoatModalCpf(null)} />
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Nova lancha</Text>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.fieldLabel}>Nome da lancha</Text>
              <TextInput testID="boat-name-input" style={styles.input} value={boatName} onChangeText={setBoatName} placeholder="Ex.: Netuno" placeholderTextColor={colors.onSurfaceTertiary} />
              <Text style={styles.fieldLabel}>Calado (metros)</Text>
              <TextInput testID="boat-draft-input" style={styles.input} value={boatDraft} onChangeText={setBoatDraft} placeholder="Ex.: 0.8" placeholderTextColor={colors.onSurfaceTertiary} keyboardType="decimal-pad" inputMode="decimal" />
              <Text style={styles.fieldLabel}>Comprimento (pés)</Text>
              <TextInput testID="boat-length-input" style={styles.input} value={boatLength} onChangeText={setBoatLength} placeholder="Ex.: 24" placeholderTextColor={colors.onSurfaceTertiary} keyboardType="decimal-pad" inputMode="decimal" />
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

      {/* New client modal */}
      <Modal visible={clientModal} transparent animationType="slide" onRequestClose={() => setClientModal(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={() => setClientModal(false)} />
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>{cIsStaff ? 'Novo funcionário' : 'Novo cliente'}</Text>
            <ScrollView keyboardShouldPersistTaps="handled">
              <View style={styles.roleRow}>
                <Pressable testID="role-cliente" onPress={() => setCIsStaff(false)} style={[styles.roleBtn, !cIsStaff && styles.roleBtnActive]}>
                  <Ionicons name="person-outline" size={16} color={!cIsStaff ? colors.onBrandPrimary : colors.onSurfaceSecondary} />
                  <Text style={[styles.roleText, !cIsStaff && styles.roleTextActive]}>Cliente</Text>
                </Pressable>
                <Pressable testID="role-funcionario" onPress={() => setCIsStaff(true)} style={[styles.roleBtn, cIsStaff && styles.roleBtnActive]}>
                  <Ionicons name="briefcase-outline" size={16} color={cIsStaff ? colors.onBrandPrimary : colors.onSurfaceSecondary} />
                  <Text style={[styles.roleText, cIsStaff && styles.roleTextActive]}>Funcionário</Text>
                </Pressable>
              </View>
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
                {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.modalSaveText}>{cIsStaff ? 'Cadastrar funcionário' : 'Cadastrar'}</Text>}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg, gap: spacing.md },
  title: { color: colors.onSurface, fontSize: typography.xxl, fontWeight: '800' },
  subtitle: { color: colors.onSurfaceSecondary, fontSize: typography.sm, marginTop: 2 },
  addClientBtn: { padding: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.brandPrimary },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  errorText: { color: colors.error, fontSize: typography.base, textAlign: 'center' },
  retryBtn: { marginTop: spacing.lg, backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.md },
  retryText: { color: colors.onBrandPrimary, fontWeight: '700' },
  list: { padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.md },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
  clientHead: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  clientName: { color: colors.onSurface, fontSize: typography.lg, fontWeight: '800' },
  clientMeta: { color: colors.onSurfaceSecondary, fontSize: typography.sm, marginTop: 2 },
  noBoats: { color: colors.onSurfaceTertiary, fontSize: typography.base, fontStyle: 'italic', marginBottom: spacing.sm },
  staffBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.brandPrimary, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 4 },
  staffBadgeText: { color: colors.onBrandPrimary, fontSize: typography.sm, fontWeight: '700' },
  roleRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.xs },
  roleBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingVertical: spacing.md, borderRadius: radius.sm },
  roleBtnActive: { backgroundColor: colors.brandPrimary },
  roleText: { color: colors.onSurfaceSecondary, fontSize: typography.base, fontWeight: '700' },
  roleTextActive: { color: colors.onBrandPrimary },
  boatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  boatName: { color: colors.onSurface, fontSize: typography.base, fontWeight: '700' },
  boatSpec: { color: colors.onSurfaceSecondary, fontSize: typography.sm, marginTop: 2 },
  trashBtn: { padding: spacing.xs },
  addBoatBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, marginTop: spacing.xs },
  addBoatText: { color: colors.brandPrimary, fontSize: typography.base, fontWeight: '700' },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.xl,
    maxHeight: '80%',
  },
  modalTitle: { color: colors.onSurface, fontSize: typography.xl, fontWeight: '800', marginBottom: spacing.lg },
  fieldLabel: { color: colors.onSurface, fontSize: typography.base, fontWeight: '600', marginBottom: spacing.sm, marginTop: spacing.sm },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: typography.lg,
    color: colors.onSurface,
    backgroundColor: colors.surfaceSecondary,
  },
  modalError: { color: colors.error, fontSize: typography.base, marginTop: spacing.md },
  modalActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
  modalBtn: { flex: 1, paddingVertical: spacing.lg, borderRadius: radius.md, alignItems: 'center' },
  modalCancel: { backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  modalCancelText: { color: colors.onSurfaceSecondary, fontWeight: '700', fontSize: typography.lg },
  modalSave: { backgroundColor: colors.brandPrimary },
  modalSaveText: { color: colors.onBrandPrimary, fontWeight: '700', fontSize: typography.lg },
});
