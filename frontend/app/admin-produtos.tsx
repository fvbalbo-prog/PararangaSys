import { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Image,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { colors, spacing, radius, typography } from '@/src/theme';
import { api, fileUrl, PRODUCT_CATEGORIES } from '@/src/api';
import type { Product, ProductCategory } from '@/src/api';
import { categoryMeta } from '@/src/categories';
import { AppDialog, type DialogButton } from '@/src/components/AppDialog';

import { formatMoney as money } from '@/src/format';

export default function AdminProdutosScreen() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [category, setCategory] = useState<ProductCategory>('Outros');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ title: string; message?: string; buttons: DialogButton[] } | null>(null);
  const closeDialog = () => setDialog(null);
  const showInfo = (title: string, message?: string) =>
    setDialog({ title, message, buttons: [{ label: 'OK', variant: 'primary', onPress: closeDialog }] });

  const load = useCallback(async () => {
    try {
      setProducts(await api.listProducts(true));
    } catch {
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  const add = async () => {
    setError(null);
    const priceNum = parseFloat(price.replace(',', '.'));
    if (!name.trim() || isNaN(priceNum) || priceNum <= 0) {
      setError('Informe nome e preço válido.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    try {
      setSaving(true);
      await api.createProduct({ name: name.trim(), price: priceNum, category });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setName('');
      setPrice('');
      setCategory('Outros');
      await load();
    } catch (e: any) {
      setError(e.message || 'Erro ao adicionar.');
    } finally {
      setSaving(false);
    }
  };

  const pickImage = async (p: Product) => {
    Haptics.selectionAsync();
    const perm = await ImagePicker.getMediaLibraryPermissionsAsync();
    let status = perm.status;
    if (status !== 'granted') {
      if (perm.canAskAgain) {
        const req = await ImagePicker.requestMediaLibraryPermissionsAsync();
        status = req.status;
      }
      if (status !== 'granted') {
        setDialog({
          title: 'Permissão necessária',
          message: 'Precisamos acessar suas fotos para escolher a imagem do produto.',
          buttons: [
            { label: 'Cancelar', variant: 'cancel', onPress: closeDialog },
            { label: 'Abrir Ajustes', variant: 'primary', onPress: () => { closeDialog(); Linking.openSettings(); } },
          ],
        });
        return;
      }
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.6,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    const filename = asset.fileName || `produto-${Date.now()}.jpg`;
    const type = asset.mimeType || 'image/jpeg';
    try {
      setUploadingId(p.id);
      const updated = await api.uploadProductImage(p.id, asset.uri, filename, type);
      setProducts((prev) => prev.map((x) => (x.id === p.id ? updated : x)));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      showInfo('Erro', e.message || 'Falha ao enviar a foto.');
    } finally {
      setUploadingId(null);
    }
  };

  const toggleActive = async (p: Product) => {
    Haptics.selectionAsync();
    setProducts((prev) => prev.map((x) => (x.id === p.id ? { ...x, active: !x.active } : x)));
    try { await api.updateProduct(p.id, { active: !p.active }); } catch { load(); }
  };

  const toggleStock = async (p: Product) => {
    Haptics.selectionAsync();
    const next = p.in_stock === false;
    setProducts((prev) => prev.map((x) => (x.id === p.id ? { ...x, in_stock: next } : x)));
    try { await api.updateProduct(p.id, { in_stock: next }); } catch { load(); }
  };

  const remove = (p: Product) => {
    setDialog({
      title: 'Remover produto',
      message: `Remover "${p.name}"?`,
      buttons: [
        { label: 'Cancelar', variant: 'cancel', onPress: closeDialog },
        {
          label: 'Remover',
          variant: 'destructive',
          testID: `confirm-remove-${p.id}`,
          onPress: async () => {
            closeDialog();
            setProducts((prev) => prev.filter((x) => x.id !== p.id));
            try { await api.deleteProduct(p.id); } catch { load(); }
          },
        },
      ],
    });
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={16} testID="back-button" style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.onBrandPrimary} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>CONVENIÊNCIA</Text>
          <Text style={styles.title} testID="produtos-title">Produtos</Text>
        </View>
      </View>

      <KeyboardAvoidingView style={styles.sheet} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={20}>
        <View style={styles.addRow}>
          <TextInput
            testID="produto-name-input"
            style={[styles.input, { flex: 2 }]}
            value={name}
            onChangeText={setName}
            placeholder="Nome do produto"
            placeholderTextColor={colors.onSurfaceTertiary}
          />
          <TextInput
            testID="produto-price-input"
            style={[styles.input, { flex: 1 }]}
            value={price}
            onChangeText={(v) => setPrice(v.replace(/[^\d.,]/g, ''))}
            placeholder="Preço"
            placeholderTextColor={colors.onSurfaceTertiary}
            keyboardType="decimal-pad"
          />
          <Pressable testID="produto-add" onPress={add} disabled={saving} style={styles.addBtn}>
            {saving ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Ionicons name="add" size={24} color="#FFFFFF" />}
          </Pressable>
        </View>
        <View style={styles.catRow}>
          {PRODUCT_CATEGORIES.map((c) => {
            const meta = categoryMeta(c);
            const on = category === c;
            return (
              <Pressable
                key={c}
                testID={`produto-cat-${c}`}
                onPress={() => { setCategory(c); Haptics.selectionAsync(); }}
                style={[styles.catChip, on && { backgroundColor: meta.color, borderColor: meta.color }]}
              >
                <Ionicons name={meta.icon} size={14} color={on ? '#FFFFFF' : meta.color} />
                <Text style={[styles.catChipText, on && { color: '#FFFFFF' }]}>{c}</Text>
              </Pressable>
            );
          })}
        </View>
        {error ? <Text style={styles.errorText} testID="produtos-error">{error}</Text> : null}

        {loading ? (
          <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
        ) : (
          <FlatList
            data={products}
            keyExtractor={(p) => p.id}
            contentContainerStyle={styles.list}
            ListEmptyComponent={<Text style={styles.empty}>Nenhum produto cadastrado.</Text>}
            renderItem={({ item }) => {
              const meta = categoryMeta(item.category);
              const img = fileUrl(item.image_url);
              return (
                <View style={styles.card} testID={`produto-${item.id}`}>
                  <Pressable testID={`produto-image-${item.id}`} onPress={() => pickImage(item)} style={styles.thumbWrap}>
                    {uploadingId === item.id ? (
                      <ActivityIndicator color={colors.brandPrimary} />
                    ) : img ? (
                      <Image source={{ uri: img }} style={styles.thumb} />
                    ) : (
                      <Ionicons name="camera-outline" size={22} color={colors.onSurfaceTertiary} />
                    )}
                  </Pressable>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.prodName, !item.active && styles.inactive]}>{item.name}</Text>
                    <Text style={styles.prodPrice}>{money(item.price)}</Text>
                    <View style={styles.catTag}>
                      <Ionicons name={meta.icon} size={12} color={meta.color} />
                      <Text style={[styles.catTagText, { color: meta.color }]}>{item.category}</Text>
                    </View>
                    {item.in_stock === false ? <Text style={styles.noStockTag}>Sem estoque</Text> : null}
                  </View>
                  <Pressable testID={`produto-stock-${item.id}`} onPress={() => toggleStock(item)} style={styles.iconBtn} hitSlop={8}>
                    <Ionicons name={item.in_stock === false ? 'cube-outline' : 'cube'} size={22} color={item.in_stock === false ? colors.error : colors.brandPrimary} />
                  </Pressable>
                  <Pressable testID={`produto-toggle-${item.id}`} onPress={() => toggleActive(item)} style={styles.iconBtn} hitSlop={8}>
                    <Ionicons name={item.active ? 'eye-outline' : 'eye-off-outline'} size={22} color={item.active ? colors.success : colors.onSurfaceTertiary} />
                  </Pressable>
                  <Pressable testID={`produto-remove-${item.id}`} onPress={() => remove(item)} style={styles.iconBtn} hitSlop={8}>
                    <Ionicons name="trash-outline" size={22} color={colors.error} />
                  </Pressable>
                </View>
              );
            }}
          />
        )}
      </KeyboardAvoidingView>
      <AppDialog
        visible={!!dialog}
        title={dialog?.title || ''}
        message={dialog?.message}
        buttons={dialog?.buttons || []}
        onRequestClose={closeDialog}
        testID="produtos-dialog"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.brandPrimary },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.lg },
  backBtn: { padding: spacing.sm, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.08)' },
  kicker: { color: colors.brandSecondary, letterSpacing: 3, fontSize: 11, fontWeight: '700' },
  title: { color: colors.onBrandPrimary, fontSize: 24, fontWeight: '800', marginTop: 4 },
  sheet: { flex: 1, backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingTop: spacing.lg },
  addRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, alignItems: 'center' },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, fontSize: typography.base, color: colors.onSurface, backgroundColor: colors.surfaceSecondary },
  addBtn: { width: 46, height: 46, borderRadius: radius.md, backgroundColor: colors.brandPrimary, alignItems: 'center', justifyContent: 'center' },
  catRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingHorizontal: spacing.lg, marginTop: spacing.md },
  catChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  catChipText: { color: colors.onSurfaceSecondary, fontSize: typography.sm, fontWeight: '700' },
  errorText: { color: colors.error, fontSize: typography.sm, paddingHorizontal: spacing.lg, marginTop: spacing.sm },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.sm },
  empty: { color: colors.onSurfaceSecondary, fontSize: typography.base, textAlign: 'center', marginTop: spacing.xxl },
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  thumbWrap: { width: 52, height: 52, borderRadius: radius.sm, backgroundColor: colors.surfaceTertiary, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  thumb: { width: 52, height: 52 },
  prodName: { color: colors.onSurface, fontSize: typography.lg, fontWeight: '700' },
  inactive: { color: colors.onSurfaceTertiary, textDecorationLine: 'line-through' },
  prodPrice: { color: colors.onSurfaceSecondary, fontSize: typography.base, marginTop: 2 },
  catTag: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  catTagText: { fontSize: typography.sm, fontWeight: '700' },
  noStockTag: { color: colors.error, fontSize: typography.sm, fontWeight: '700', marginTop: 2 },
  iconBtn: { padding: spacing.xs },
});
