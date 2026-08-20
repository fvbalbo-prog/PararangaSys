import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl, Modal, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, spacing, radius, typography } from '@/src/theme';
import { api } from '@/src/api';
import type { Fornecedor } from '@/src/api';
import { AppDialog, type DialogButton } from '@/src/components/AppDialog';

export default function AdminFornecedoresScreen() {
  const router = useRouter();
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Fornecedor | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [document, setDocument] = useState('');
  const [saving, setSaving] = useState(false);

  const [dialog, setDialog] = useState<{ title: string; message?: string; buttons: DialogButton[] } | null>(null);
  const closeDialog = () => setDialog(null);
  const showInfo = (title: string, message?: string) =>
    setDialog({ title, message, buttons: [{ label: 'OK', variant: 'primary', onPress: closeDialog }] });

  const load = useCallback(async () => {
    try {
      setFornecedores(await api.listFornecedores());
    } catch {
      setFornecedores([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  const openNew = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setEditing(null);
    setName('');
    setCategory('');
    setPhone('');
    setEmail('');
    setDocument('');
    setShowForm(true);
  };

  const openEdit = (f: Fornecedor) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setEditing(f);
    setName(f.name);
    setCategory(f.category || '');
    setPhone(f.phone || '');
    setEmail(f.email || '');
    setDocument(f.document || '');
    setShowForm(true);
  };

  const submit = async () => {
    if (!name.trim()) return showInfo('Nome obrigatório', 'Informe o nome do fornecedor.');
    setSaving(true);
    try {
      const data = {
        name: name.trim(),
        category: category.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
        document: document.trim() || null,
      };
      if (editing) {
        await api.updateFornecedor(editing.id, data);
      } else {
        await api.createFornecedor(data);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShowForm(false);
      load();
    } catch (e: any) {
      showInfo('Erro', e.message || 'Não foi possível salvar o fornecedor.');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (f: Fornecedor) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await api.setFornecedorActive(f.id, !f.active);
      load();
    } catch (e: any) {
      showInfo('Erro', e.message || 'Não foi possível atualizar.');
    }
  };

  const remove = (f: Fornecedor) => {
    setDialog({
      title: 'Excluir fornecedor',
      message: `Excluir "${f.name}"?`,
      buttons: [
        { label: 'Cancelar', variant: 'cancel', onPress: closeDialog },
        {
          label: 'Excluir',
          variant: 'destructive',
          onPress: async () => {
            closeDialog();
            try {
              await api.deleteFornecedor(f.id);
              load();
            } catch (e: any) {
              showInfo('Erro', e.message || 'Não foi possível excluir.');
            }
          },
        },
      ],
    });
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="admin-fornecedores-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={16} testID="back-button">
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} testID="admin-fornecedores-title">Fornecedores</Text>
          <Text style={styles.subtitle}>Cadastro para contas a pagar</Text>
        </View>
        <Pressable onPress={openNew} testID="fornecedor-add" style={styles.addBtn} hitSlop={12}>
          <Ionicons name="add" size={24} color="#FFFFFF" />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
      ) : fornecedores.length === 0 ? (
        <View style={styles.center}>
          <View style={styles.emptyIcon}><Ionicons name="briefcase-outline" size={44} color={colors.brandSecondary} /></View>
          <Text style={styles.emptyTitle}>Nenhum fornecedor cadastrado</Text>
          <Text style={styles.emptySubtitle}>Toque em + para cadastrar o primeiro.</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
        >
          {fornecedores.map((f) => (
            <Pressable key={f.id} testID={`fornecedor-${f.id}`} onPress={() => openEdit(f)} style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }, !f.active && { opacity: 0.5 }]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName}>{f.name}</Text>
                <Text style={styles.rowMeta} numberOfLines={1}>
                  {[f.category, f.phone, f.email].filter(Boolean).join(' · ') || 'Sem detalhes adicionais'}
                </Text>
              </View>
              <Pressable testID={`fornecedor-toggle-${f.id}`} onPress={() => toggleActive(f)} hitSlop={8} style={styles.toggleBtn}>
                <Ionicons name={f.active ? 'checkmark-circle' : 'close-circle-outline'} size={22} color={f.active ? colors.success : colors.onSurfaceTertiary} />
              </Pressable>
              <Pressable testID={`fornecedor-delete-${f.id}`} onPress={() => remove(f)} hitSlop={8} style={styles.toggleBtn}>
                <Ionicons name="trash-outline" size={20} color={colors.error} />
              </Pressable>
            </Pressable>
          ))}
        </ScrollView>
      )}

      <Modal visible={showForm} transparent animationType="fade" onRequestClose={() => setShowForm(false)}>
        <View style={styles.backdrop}>
          <View style={styles.formCard}>
            <Text style={styles.formTitle}>{editing ? 'Editar fornecedor' : 'Novo fornecedor'}</Text>
            <Text style={styles.fieldLabel}>Nome</Text>
            <TextInput testID="fornecedor-name-input" style={styles.input} value={name} onChangeText={setName} placeholder="Nome do fornecedor" placeholderTextColor={colors.onSurfaceTertiary} />
            <Text style={[styles.fieldLabel, { marginTop: spacing.md }]}>Categoria (opcional)</Text>
            <TextInput testID="fornecedor-category-input" style={styles.input} value={category} onChangeText={setCategory} placeholder="Ex: Combustível, Manutenção" placeholderTextColor={colors.onSurfaceTertiary} />
            <Text style={[styles.fieldLabel, { marginTop: spacing.md }]}>Telefone (opcional)</Text>
            <TextInput testID="fornecedor-phone-input" style={styles.input} value={phone} onChangeText={setPhone} placeholder="(00) 00000-0000" placeholderTextColor={colors.onSurfaceTertiary} keyboardType="phone-pad" />
            <Text style={[styles.fieldLabel, { marginTop: spacing.md }]}>E-mail (opcional)</Text>
            <TextInput testID="fornecedor-email-input" style={styles.input} value={email} onChangeText={setEmail} placeholder="contato@fornecedor.com" placeholderTextColor={colors.onSurfaceTertiary} keyboardType="email-address" autoCapitalize="none" />
            <Text style={[styles.fieldLabel, { marginTop: spacing.md }]}>CNPJ/CPF (opcional)</Text>
            <TextInput testID="fornecedor-document-input" style={styles.input} value={document} onChangeText={setDocument} placeholder="00.000.000/0000-00" placeholderTextColor={colors.onSurfaceTertiary} />

            <View style={styles.formActions}>
              <Pressable testID="fornecedor-form-cancel" onPress={() => setShowForm(false)} style={[styles.formBtn, styles.formBtnCancel]}>
                <Text style={styles.formBtnTextCancel}>Cancelar</Text>
              </Pressable>
              <Pressable testID="fornecedor-form-save" onPress={submit} disabled={saving} style={[styles.formBtn, styles.formBtnPrimary]}>
                {saving ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={styles.formBtnTextSolid}>Salvar</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <AppDialog visible={!!dialog} title={dialog?.title || ''} message={dialog?.message} buttons={dialog?.buttons || []} onRequestClose={closeDialog} testID="admin-fornecedores-dialog" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg, gap: spacing.md },
  title: { color: colors.onSurface, fontSize: typography.xxl, fontWeight: '800' },
  subtitle: { color: colors.onSurfaceSecondary, fontSize: typography.sm, marginTop: 2 },
  addBtn: { width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.brandPrimary, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  emptyIcon: { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg },
  emptyTitle: { color: colors.onSurface, fontSize: typography.lg, fontWeight: '700' },
  emptySubtitle: { color: colors.onSurfaceSecondary, fontSize: typography.base, marginTop: spacing.sm, textAlign: 'center' },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.sm },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg,
  },
  rowName: { color: colors.onSurface, fontSize: typography.base, fontWeight: '700' },
  rowMeta: { color: colors.onSurfaceSecondary, fontSize: typography.sm, marginTop: 2 },
  toggleBtn: { padding: spacing.xs },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
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
  formBtnCancel: { backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  formBtnTextSolid: { color: '#FFFFFF', fontSize: typography.base, fontWeight: '700' },
  formBtnTextCancel: { color: colors.onSurfaceSecondary, fontSize: typography.base, fontWeight: '700' },
});
