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
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, spacing, radius, typography } from '@/src/theme';
import { api } from '@/src/api';
import type { Product } from '@/src/api';

const money = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`;

export default function AdminProdutosScreen() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      await api.createProduct({ name: name.trim(), price: priceNum });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setName('');
      setPrice('');
      await load();
    } catch (e: any) {
      setError(e.message || 'Erro ao adicionar.');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (p: Product) => {
    Haptics.selectionAsync();
    setProducts((prev) => prev.map((x) => (x.id === p.id ? { ...x, active: !x.active } : x)));
    try { await api.updateProduct(p.id, { active: !p.active }); } catch { load(); }
  };

  const remove = (p: Product) => {
    Alert.alert('Remover produto', `Remover "${p.name}"?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Remover',
        style: 'destructive',
        onPress: async () => {
          setProducts((prev) => prev.filter((x) => x.id !== p.id));
          try { await api.deleteProduct(p.id); } catch { load(); }
        },
      },
    ]);
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
        {error ? <Text style={styles.errorText} testID="produtos-error">{error}</Text> : null}

        {loading ? (
          <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
        ) : (
          <FlatList
            data={products}
            keyExtractor={(p) => p.id}
            contentContainerStyle={styles.list}
            ListEmptyComponent={<Text style={styles.empty}>Nenhum produto cadastrado.</Text>}
            renderItem={({ item }) => (
              <View style={styles.card} testID={`produto-${item.id}`}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.prodName, !item.active && styles.inactive]}>{item.name}</Text>
                  <Text style={styles.prodPrice}>{money(item.price)}</Text>
                </View>
                <Pressable testID={`produto-toggle-${item.id}`} onPress={() => toggleActive(item)} style={styles.iconBtn} hitSlop={8}>
                  <Ionicons name={item.active ? 'eye-outline' : 'eye-off-outline'} size={22} color={item.active ? colors.success : colors.onSurfaceTertiary} />
                </Pressable>
                <Pressable testID={`produto-remove-${item.id}`} onPress={() => remove(item)} style={styles.iconBtn} hitSlop={8}>
                  <Ionicons name="trash-outline" size={22} color={colors.error} />
                </Pressable>
              </View>
            )}
          />
        )}
      </KeyboardAvoidingView>
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
  errorText: { color: colors.error, fontSize: typography.sm, paddingHorizontal: spacing.lg, marginTop: spacing.sm },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.sm },
  empty: { color: colors.onSurfaceSecondary, fontSize: typography.base, textAlign: 'center', marginTop: spacing.xxl },
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
  prodName: { color: colors.onSurface, fontSize: typography.lg, fontWeight: '700' },
  inactive: { color: colors.onSurfaceTertiary, textDecorationLine: 'line-through' },
  prodPrice: { color: colors.onSurfaceSecondary, fontSize: typography.base, marginTop: 2 },
  iconBtn: { padding: spacing.xs },
});
