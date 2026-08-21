import { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, RefreshControl, Modal, TextInput,
  KeyboardAvoidingView, Platform, ScrollView, Image, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { colors, spacing, radius, typography } from '@/src/theme';
import { formatMoney } from '@/src/format';
import { api, fileUrl } from '@/src/api';
import type { Encomenda, EncomendaStatus, Client } from '@/src/api';
import { SelectField } from '@/src/components/SelectField';
import { AppDialog, type DialogButton } from '@/src/components/AppDialog';

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function parseAmount(s: string): number {
  return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
}

const STATUS_META: Record<EncomendaStatus, { label: string; bg: string; fg: string }> = {
  aguardando: { label: 'Aguardando retirada', bg: '#DBEAFE', fg: '#1E3A8A' },
  entregue: { label: 'Entregue', bg: '#DCFCE7', fg: colors.success },
};
const STATUS_FILTERS: { key: EncomendaStatus | 'todas'; label: string }[] = [
  { key: 'aguardando', label: 'Aguardando' },
  { key: 'entregue', label: 'Entregues' },
  { key: 'todas', label: 'Todas' },
];

export default function AdminEncomendasScreen() {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<EncomendaStatus | 'todas'>('aguardando');
  const [encomendas, setEncomendas] = useState<Encomenda[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [taxa, setTaxa] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [uploadingId, setUploadingId] = useState<string | null>(null);

  const [dialog, setDialog] = useState<{ title: string; message?: string; buttons: DialogButton[] } | null>(null);
  const closeDialog = () => setDialog(null);
  const showInfo = (title: string, message?: string) =>
    setDialog({ title, message, buttons: [{ label: 'OK', variant: 'primary', onPress: closeDialog }] });

  const [showForm, setShowForm] = useState(false);
  const [fClientName, setFClientName] = useState<string | null>(null);
  const [fBoatName, setFBoatName] = useState<string | null>(null);
  const [fDescription, setFDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const [showTaxa, setShowTaxa] = useState(false);
  const [taxaInput, setTaxaInput] = useState('');
  const [savingTaxa, setSavingTaxa] = useState(false);

  const [deliverTarget, setDeliverTarget] = useState<Encomenda | null>(null);
  const [receivedByName, setReceivedByName] = useState('');
  const [delivering, setDelivering] = useState(false);

  const load = useCallback(async () => {
    try {
      const [encs, users, taxaRes] = await Promise.all([
        api.listEncomendas(statusFilter === 'todas' ? undefined : { status: statusFilter }),
        api.listUsers(),
        api.getEncomendaTaxa(),
      ]);
      setEncomendas(encs);
      setClients(users.filter((c) => !c.is_staff));
      setTaxa(taxaRes.value);
    } catch {
      setEncomendas([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [statusFilter]);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  const openForm = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setFClientName(null);
    setFBoatName(null);
    setFDescription('');
    setShowForm(true);
  };

  const submitForm = async () => {
    if (!fClientName) return showInfo('Cliente obrigatório', 'Selecione o cliente dono da encomenda.');
    const client = clients.find((c) => c.name === fClientName);
    if (!client) return;
    setSaving(true);
    try {
      const created = await api.createEncomenda({
        cpf: client.cpf,
        boat_name: fBoatName,
        description: fDescription.trim() || null,
      });
      setEncomendas((prev) => (statusFilter === 'todas' || statusFilter === 'aguardando' ? [created, ...prev] : prev));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShowForm(false);
    } catch (e: any) {
      showInfo('Erro', e.message || 'Não foi possível registrar a encomenda.');
    } finally {
      setSaving(false);
    }
  };

  const openTaxa = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setTaxaInput(taxa.toFixed(2).replace('.', ','));
    setShowTaxa(true);
  };

  const submitTaxa = async () => {
    const value = parseAmount(taxaInput);
    if (value < 0) return showInfo('Valor inválido', 'A taxa não pode ser negativa.');
    setSavingTaxa(true);
    try {
      const res = await api.setEncomendaTaxa(value);
      setTaxa(res.value);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShowTaxa(false);
    } catch (e: any) {
      showInfo('Erro', e.message || 'Não foi possível salvar a taxa.');
    } finally {
      setSavingTaxa(false);
    }
  };

  const attachPhoto = async (enc: Encomenda, fromCamera: boolean) => {
    Haptics.selectionAsync();
    if (fromCamera) {
      const perm = await ImagePicker.getCameraPermissionsAsync();
      let status = perm.status;
      if (status !== 'granted') {
        if (perm.canAskAgain) status = (await ImagePicker.requestCameraPermissionsAsync()).status;
        if (status !== 'granted') {
          setDialog({
            title: 'Permissão necessária',
            message: 'Precisamos acessar a câmera para fotografar a encomenda.',
            buttons: [
              { label: 'Cancelar', variant: 'cancel', onPress: closeDialog },
              { label: 'Abrir Ajustes', variant: 'primary', onPress: () => { closeDialog(); Linking.openSettings(); } },
            ],
          });
          return;
        }
      }
    } else {
      const perm = await ImagePicker.getMediaLibraryPermissionsAsync();
      let status = perm.status;
      if (status !== 'granted') {
        if (perm.canAskAgain) status = (await ImagePicker.requestMediaLibraryPermissionsAsync()).status;
        if (status !== 'granted') {
          setDialog({
            title: 'Permissão necessária',
            message: 'Precisamos acessar suas fotos para anexar a imagem da encomenda.',
            buttons: [
              { label: 'Cancelar', variant: 'cancel', onPress: closeDialog },
              { label: 'Abrir Ajustes', variant: 'primary', onPress: () => { closeDialog(); Linking.openSettings(); } },
            ],
          });
          return;
        }
      }
    }
    const launch = fromCamera ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync;
    const result = await launch({ mediaTypes: ['images'], quality: 0.6, allowsEditing: true, aspect: [4, 3] });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    const filename = asset.fileName || `encomenda-${Date.now()}.jpg`;
    const type = asset.mimeType || 'image/jpeg';
    try {
      setUploadingId(enc.id);
      const updated = await api.uploadEncomendaPhoto(enc.id, asset.uri, filename, type);
      setEncomendas((prev) => prev.map((e) => (e.id === enc.id ? updated : e)));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      showInfo('Erro', e.message || 'Falha ao enviar a foto.');
    } finally {
      setUploadingId(null);
    }
  };

  const askPhotoSource = (enc: Encomenda) => {
    setDialog({
      title: 'Foto da encomenda',
      message: 'Tirar uma foto agora ou escolher da galeria?',
      buttons: [
        { label: 'Cancelar', variant: 'cancel', onPress: closeDialog },
        { label: 'Galeria', variant: 'primary', onPress: () => { closeDialog(); attachPhoto(enc, false); } },
        { label: 'Câmera', variant: 'primary', onPress: () => { closeDialog(); attachPhoto(enc, true); } },
      ],
    });
  };

  const openDeliver = (enc: Encomenda) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setDeliverTarget(enc);
    setReceivedByName('');
  };

  const submitDeliver = async () => {
    if (!deliverTarget) return;
    const name = receivedByName.trim();
    if (!name) return showInfo('Nome obrigatório', 'Informe o nome de quem retirou a encomenda.');
    setDelivering(true);
    try {
      const updated = await api.entregarEncomenda(deliverTarget.id, name);
      setEncomendas((prev) => (statusFilter === 'aguardando' ? prev.filter((e) => e.id !== updated.id) : prev.map((e) => (e.id === updated.id ? updated : e))));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setDeliverTarget(null);
    } catch (e: any) {
      showInfo('Erro', e.message || 'Não foi possível registrar a entrega.');
    } finally {
      setDelivering(false);
    }
  };

  const selectedClient = fClientName ? clients.find((c) => c.name === fClientName) : null;

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="admin-encomendas-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={16} testID="back-button">
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} testID="encomendas-title">Encomendas</Text>
          <Text style={styles.subtitle}>Taxa atual: {formatMoney(taxa)}</Text>
        </View>
        <Pressable onPress={openTaxa} testID="encomendas-taxa-button" style={styles.iconBtn} hitSlop={12}>
          <Ionicons name="pricetag-outline" size={20} color={colors.onSurface} />
        </Pressable>
        <Pressable onPress={openForm} testID="encomendas-add" style={styles.addBtn} hitSlop={12}>
          <Ionicons name="add" size={24} color="#FFFFFF" />
        </Pressable>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow} style={styles.chipScroller}>
        {STATUS_FILTERS.map((f) => {
          const active = statusFilter === f.key;
          return (
            <Pressable key={f.key} testID={`encomendas-filter-${f.key}`} onPress={() => { setStatusFilter(f.key); Haptics.selectionAsync(); }} style={[styles.chip, active && styles.chipActive]}>
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{f.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
      ) : encomendas.length === 0 ? (
        <View style={styles.center}>
          <View style={styles.emptyIcon}><Ionicons name="cube-outline" size={44} color={colors.brandSecondary} /></View>
          <Text style={styles.emptyTitle}>Nenhuma encomenda</Text>
        </View>
      ) : (
        <FlatList
          data={encomendas}
          keyExtractor={(e) => e.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
          renderItem={({ item }) => {
            const meta = STATUS_META[item.status];
            return (
              <View style={styles.card} testID={`encomenda-${item.id}`}>
                <View style={styles.cardTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardName}>{item.client_name}{item.boat_name ? ` • ${item.boat_name}` : ''}</Text>
                    <Text style={styles.cardMeta}>Recebida em {fmtDateTime(item.received_at)}</Text>
                  </View>
                  <View style={[styles.statusBadge, { backgroundColor: meta.bg }]}>
                    <Text style={[styles.statusText, { color: meta.fg }]}>{meta.label}</Text>
                  </View>
                </View>
                {item.description ? <Text style={styles.cardDesc}>{item.description}</Text> : null}
                <View style={styles.feeRow}>
                  <Ionicons name="cash-outline" size={14} color={colors.onSurfaceSecondary} />
                  <Text style={styles.cardMeta}>Taxa: {formatMoney(item.fee)}</Text>
                </View>
                {item.status === 'entregue' ? (
                  <Text style={styles.cardMeta}>Entregue em {item.delivered_at ? fmtDateTime(item.delivered_at) : '—'} • Retirada por {item.received_by_name}</Text>
                ) : null}

                {item.photo_url ? (
                  <Image source={{ uri: fileUrl(item.photo_url) }} style={styles.photo} resizeMode="cover" />
                ) : null}

                <View style={styles.actions}>
                  <Pressable
                    testID={`encomenda-photo-${item.id}`}
                    onPress={() => askPhotoSource(item)}
                    disabled={uploadingId === item.id}
                    style={[styles.actionBtn, { borderRightWidth: item.status === 'aguardando' ? 1 : 0, borderRightColor: colors.border }]}
                  >
                    {uploadingId === item.id ? (
                      <ActivityIndicator size="small" color={colors.brandPrimary} />
                    ) : (
                      <>
                        <Ionicons name="camera-outline" size={16} color={colors.brandPrimary} />
                        <Text style={[styles.actionText, { color: colors.brandPrimary }]}>{item.photo_url ? 'Trocar foto' : 'Anexar foto'}</Text>
                      </>
                    )}
                  </Pressable>
                  {item.status === 'aguardando' ? (
                    <Pressable testID={`encomenda-deliver-${item.id}`} onPress={() => openDeliver(item)} style={styles.actionBtn}>
                      <Ionicons name="checkmark-done-outline" size={16} color={colors.success} />
                      <Text style={[styles.actionText, { color: colors.success }]}>Registrar entrega</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            );
          }}
        />
      )}

      {/* Modal: nova encomenda */}
      <Modal visible={showForm} transparent animationType="slide" onRequestClose={() => setShowForm(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={() => setShowForm(false)} />
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Nova encomenda</Text>
            <ScrollView keyboardShouldPersistTaps="handled">
              <SelectField
                testID="encomenda-client-select"
                label="Cliente"
                value={fClientName}
                options={clients.map((c) => c.name)}
                onChange={(v) => { setFClientName(v); setFBoatName(null); }}
                placeholder="Selecione o cliente"
              />
              {selectedClient && selectedClient.boats.length > 0 ? (
                <SelectField
                  testID="encomenda-boat-select"
                  label="Lancha (opcional)"
                  value={fBoatName}
                  options={selectedClient.boats.map((b) => b.name)}
                  onChange={setFBoatName}
                  placeholder="Vincular a uma lancha"
                />
              ) : null}
              <Text style={styles.fieldLabel}>Descrição (opcional)</Text>
              <TextInput
                testID="encomenda-description-input"
                style={styles.input}
                value={fDescription}
                onChangeText={setFDescription}
                placeholder="Ex: Pacote Amazon, envelope, caixa..."
                placeholderTextColor={colors.onSurfaceTertiary}
              />
              <View style={styles.feeInfoBox}>
                <Ionicons name="information-circle-outline" size={16} color={colors.onSurfaceSecondary} />
                <Text style={styles.feeInfoText}>Taxa de recebimento aplicada automaticamente: {formatMoney(taxa)}</Text>
              </View>
            </ScrollView>
            <View style={styles.modalActions}>
              <Pressable style={[styles.modalBtn, styles.modalCancel]} onPress={() => setShowForm(false)}>
                <Text style={styles.modalCancelText}>Cancelar</Text>
              </Pressable>
              <Pressable testID="encomenda-form-save" style={[styles.modalBtn, styles.modalSave]} onPress={submitForm} disabled={saving}>
                {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.modalSaveText}>Registrar</Text>}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Modal: configurar taxa */}
      <Modal visible={showTaxa} transparent animationType="fade" onRequestClose={() => setShowTaxa(false)}>
        <View style={styles.backdrop}>
          <View style={styles.formCard}>
            <Text style={styles.modalTitle}>Taxa de recebimento</Text>
            <Text style={styles.feeInfoText}>Aplicada automaticamente a toda nova encomenda registrada. Encomendas já registradas mantêm o valor da taxa vigente na época.</Text>
            <Text style={[styles.fieldLabel, { marginTop: spacing.md }]}>Valor (R$)</Text>
            <TextInput
              testID="encomenda-taxa-input"
              style={styles.input}
              value={taxaInput}
              onChangeText={(v) => setTaxaInput(v.replace(/[^\d.,]/g, ''))}
              placeholder="0,00"
              placeholderTextColor={colors.onSurfaceTertiary}
              keyboardType="decimal-pad"
            />
            <View style={styles.modalActions}>
              <Pressable style={[styles.modalBtn, styles.modalCancel]} onPress={() => setShowTaxa(false)}>
                <Text style={styles.modalCancelText}>Cancelar</Text>
              </Pressable>
              <Pressable testID="encomenda-taxa-save" style={[styles.modalBtn, styles.modalSave]} onPress={submitTaxa} disabled={savingTaxa}>
                {savingTaxa ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.modalSaveText}>Salvar</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal: registrar entrega */}
      <Modal visible={!!deliverTarget} transparent animationType="fade" onRequestClose={() => setDeliverTarget(null)}>
        <View style={styles.backdrop}>
          <View style={styles.formCard}>
            <Text style={styles.modalTitle}>Registrar entrega</Text>
            {deliverTarget ? (
              <Text style={styles.feeInfoText}>{deliverTarget.client_name}{deliverTarget.boat_name ? ` • ${deliverTarget.boat_name}` : ''}{deliverTarget.description ? ` — ${deliverTarget.description}` : ''}</Text>
            ) : null}
            <Text style={[styles.fieldLabel, { marginTop: spacing.md }]}>Nome de quem retirou</Text>
            <TextInput
              testID="encomenda-received-by-input"
              style={styles.input}
              value={receivedByName}
              onChangeText={setReceivedByName}
              placeholder="Nome completo"
              placeholderTextColor={colors.onSurfaceTertiary}
              autoFocus
            />
            <View style={styles.modalActions}>
              <Pressable style={[styles.modalBtn, styles.modalCancel]} onPress={() => setDeliverTarget(null)}>
                <Text style={styles.modalCancelText}>Cancelar</Text>
              </Pressable>
              <Pressable testID="encomenda-deliver-save" style={[styles.modalBtn, styles.modalSave]} onPress={submitDeliver} disabled={delivering}>
                {delivering ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.modalSaveText}>Confirmar entrega</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <AppDialog visible={!!dialog} title={dialog?.title || ''} message={dialog?.message} buttons={dialog?.buttons || []} onRequestClose={closeDialog} testID="encomendas-dialog" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg, gap: spacing.md },
  title: { color: colors.onSurface, fontSize: typography.xxl, fontWeight: '800' },
  subtitle: { color: colors.onSurfaceSecondary, fontSize: typography.sm, marginTop: 2 },
  iconBtn: { width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, alignItems: 'center', justifyContent: 'center' },
  addBtn: { width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.brandPrimary, alignItems: 'center', justifyContent: 'center' },
  chipScroller: { maxHeight: 56, flexGrow: 0 },
  chipRow: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  chip: { height: 36, paddingHorizontal: spacing.lg, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontSize: typography.base, fontWeight: '600' },
  chipTextActive: { color: colors.onBrandPrimary },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyIcon: { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg },
  emptyTitle: { color: colors.onSurface, fontSize: typography.lg, fontWeight: '700' },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.md },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
  cardName: { color: colors.onSurface, fontSize: typography.lg, fontWeight: '800' },
  cardMeta: { color: colors.onSurfaceSecondary, fontSize: typography.sm, marginTop: 2 },
  cardDesc: { color: colors.onSurface, fontSize: typography.base, marginTop: spacing.sm },
  feeRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: spacing.xs },
  statusBadge: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill },
  statusText: { fontSize: 11, fontWeight: '700' },
  photo: { width: '100%', height: 160, borderRadius: radius.sm, marginTop: spacing.md, backgroundColor: colors.surfaceTertiary },
  actions: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.border, marginTop: spacing.md },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingVertical: spacing.md },
  actionText: { fontSize: typography.base, fontWeight: '700' },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  modalSheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.xl, maxHeight: '85%' },
  modalTitle: { color: colors.onSurface, fontSize: typography.xl, fontWeight: '800', marginBottom: spacing.lg },
  fieldLabel: { color: colors.onSurface, fontSize: typography.base, fontWeight: '600', marginBottom: spacing.sm, marginTop: spacing.sm },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, fontSize: typography.lg, color: colors.onSurface, backgroundColor: colors.surfaceSecondary },
  feeInfoBox: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs, backgroundColor: colors.brandTertiary, borderRadius: radius.sm, padding: spacing.md, marginTop: spacing.lg },
  feeInfoText: { flex: 1, color: colors.onSurfaceSecondary, fontSize: typography.sm, lineHeight: 18 },
  modalActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
  modalBtn: { flex: 1, paddingVertical: spacing.lg, borderRadius: radius.md, alignItems: 'center' },
  modalCancel: { backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  modalCancelText: { color: colors.onSurfaceSecondary, fontWeight: '700', fontSize: typography.lg },
  modalSave: { backgroundColor: colors.brandPrimary },
  modalSaveText: { color: colors.onBrandPrimary, fontWeight: '700', fontSize: typography.lg },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: spacing.xl },
  formCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.xl },
});
