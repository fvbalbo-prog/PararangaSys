import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, spacing, radius, typography } from '@/src/theme';
import { api } from '@/src/api';
import type { CompraItem, Product } from '@/src/api';
import { AppDialog, type DialogButton } from '@/src/components/AppDialog';

export default function AdminConvenienciaComprasScreen() {
  const router = useRouter();
  const [items, setItems] = useState<CompraItem[]>([]);
  const [outOfStock, setOutOfStock] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [adding, setAdding] = useState(false);

  const [dialog, setDialog] = useState<{ title: string; message?: string; buttons: DialogButton[] } | null>(null);
  const closeDialog = () => setDialog(null);
  const showInfo = (title: string, message?: string) =>
    setDialog({ title, message, buttons: [{ label: 'OK', variant: 'primary', onPress: closeDialog }] });

  const load = useCallback(async () => {
    try {
      const [list, products] = await Promise.all([api.listCompraItems(), api.listProducts(true)]);
      setItems(list);
      setOutOfStock(products.filter((p) => !p.in_stock && !list.some((i) => i.name === p.name && !i.done)));
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  const add = async (itemName?: string) => {
    const finalName = (itemName ?? name).trim();
    if (!finalName) return;
    setAdding(true);
    try {
      await api.createCompraItem({ name: finalName, quantity: itemName ? null : quantity.trim() || null });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setName('');
      setQuantity('');
      load();
    } catch (e: any) {
      showInfo('Erro', e.message || 'Não foi possível adicionar o item.');
    } finally {
      setAdding(false);
    }
  };

  const toggleDone = async (item: CompraItem) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)));
    try {
      await api.setCompraItemDone(item.id, !item.done);
    } catch {
      load();
    }
  };

  const remove = (item: CompraItem) => {
    setDialog({
      title: 'Remover item',
      message: `Remover "${item.name}" da lista?`,
      buttons: [
        { label: 'Cancelar', variant: 'cancel', onPress: closeDialog },
        {
          label: 'Remover',
          variant: 'destructive',
          onPress: async () => {
            closeDialog();
            try {
              await api.deleteCompraItem(item.id);
              load();
            } catch (e: any) {
              showInfo('Erro', e.message || 'Não foi possível remover.');
            }
          },
        },
      ],
    });
  };

  const pending = items.filter((i) => !i.done);
  const done = items.filter((i) => i.done);

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="admin-conveniencia-compras-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={16} testID="back-button">
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} testID="compras-title">Lista de Compras</Text>
          <Text style={styles.subtitle}>Conveniência</Text>
        </View>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={20}>
        <View style={styles.addRow}>
          <TextInput
            testID="compra-name-input"
            style={[styles.input, { flex: 2 }]}
            value={name}
            onChangeText={setName}
            placeholder="Item para comprar"
            placeholderTextColor={colors.onSurfaceTertiary}
          />
          <TextInput
            testID="compra-qty-input"
            style={[styles.input, { flex: 1 }]}
            value={quantity}
            onChangeText={setQuantity}
            placeholder="Qtd."
            placeholderTextColor={colors.onSurfaceTertiary}
          />
          <Pressable testID="compra-add" onPress={() => add()} disabled={adding} style={styles.addBtn}>
            {adding ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Ionicons name="add" size={24} color="#FFFFFF" />}
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
        >
          {outOfStock.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Sugestões (produtos sem estoque)</Text>
              {outOfStock.map((p) => (
                <Pressable key={p.id} testID={`compra-suggest-${p.id}`} onPress={() => add(p.name)} style={styles.suggestRow}>
                  <Ionicons name="alert-circle-outline" size={18} color={colors.brandSecondary} />
                  <Text style={styles.suggestText}>{p.name}</Text>
                  <Ionicons name="add-circle-outline" size={20} color={colors.brandPrimary} />
                </Pressable>
              ))}
            </View>
          ) : null}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>A comprar {pending.length > 0 ? `(${pending.length})` : ''}</Text>
            {pending.length === 0 ? (
              <Text style={styles.empty}>Nada pendente na lista.</Text>
            ) : (
              pending.map((item) => (
                <Pressable key={item.id} testID={`compra-item-${item.id}`} onPress={() => toggleDone(item)} onLongPress={() => remove(item)} style={styles.itemRow}>
                  <Ionicons name="square-outline" size={22} color={colors.onSurfaceTertiary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemName}>{item.name}</Text>
                    {item.quantity ? <Text style={styles.itemMeta}>{item.quantity}</Text> : null}
                  </View>
                  <Pressable testID={`compra-delete-${item.id}`} onPress={() => remove(item)} hitSlop={8}>
                    <Ionicons name="trash-outline" size={18} color={colors.error} />
                  </Pressable>
                </Pressable>
              ))
            )}
          </View>

          {done.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Compradas</Text>
              {done.map((item) => (
                <Pressable key={item.id} testID={`compra-item-${item.id}`} onPress={() => toggleDone(item)} onLongPress={() => remove(item)} style={[styles.itemRow, { opacity: 0.55 }]}>
                  <Ionicons name="checkbox" size={22} color={colors.success} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.itemName, { textDecorationLine: 'line-through' }]}>{item.name}</Text>
                    {item.quantity ? <Text style={styles.itemMeta}>{item.quantity}</Text> : null}
                  </View>
                  <Pressable testID={`compra-delete-${item.id}`} onPress={() => remove(item)} hitSlop={8}>
                    <Ionicons name="trash-outline" size={18} color={colors.error} />
                  </Pressable>
                </Pressable>
              ))}
            </View>
          ) : null}
        </ScrollView>
      )}

      <AppDialog visible={!!dialog} title={dialog?.title || ''} message={dialog?.message} buttons={dialog?.buttons || []} onRequestClose={closeDialog} testID="compras-dialog" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg, gap: spacing.md },
  title: { color: colors.onSurface, fontSize: typography.xxl, fontWeight: '800' },
  subtitle: { color: colors.onSurfaceSecondary, fontSize: typography.sm, marginTop: 2 },
  addRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, marginBottom: spacing.md },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    backgroundColor: colors.surfaceSecondary, fontSize: typography.base, color: colors.onSurface,
  },
  addBtn: { width: 48, height: 48, borderRadius: radius.md, backgroundColor: colors.brandPrimary, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.xl },
  section: { gap: spacing.sm },
  sectionTitle: { color: colors.onSurface, fontSize: typography.lg, fontWeight: '800' },
  empty: { color: colors.onSurfaceSecondary, fontSize: typography.base },
  suggestRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.brandTertiary, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.md,
  },
  suggestText: { flex: 1, color: colors.onBrandTertiary, fontSize: typography.base, fontWeight: '600' },
  itemRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  itemName: { color: colors.onSurface, fontSize: typography.base, fontWeight: '700' },
  itemMeta: { color: colors.onSurfaceSecondary, fontSize: typography.sm, marginTop: 2 },
});
