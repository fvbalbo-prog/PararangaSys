import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { colors, spacing, radius, typography } from '@/src/theme';
import { api, boatName } from '@/src/api';
import type { User, Product, ConvenienceOrder } from '@/src/api';

const money = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`;

const STATUS_LABEL: Record<string, string> = {
  pendente: 'Pendente',
  entregue: 'Entregue',
  cancelada: 'Cancelada',
};
const STATUS_COLOR: Record<string, string> = {
  pendente: colors.warning,
  entregue: colors.success,
  cancelada: colors.error,
};

export default function ConvenienciaScreen() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [observation, setObservation] = useState('');
  const [orders, setOrders] = useState<ConvenienceOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadOrders = useCallback(async (cpf: string) => {
    try {
      setOrders(await api.listOrders(cpf));
    } catch {
      setOrders([]);
    }
  }, []);

  const boot = useCallback(async () => {
    const raw = await AsyncStorage.getItem('user');
    if (!raw) return router.replace('/');
    const u: User = JSON.parse(raw);
    setUser(u);
    try {
      const [prods] = await Promise.all([api.listProducts(), loadOrders(u.cpf)]);
      setProducts(prods);
    } catch {
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, [router, loadOrders]);

  useEffect(() => {
    boot();
  }, [boot]);

  useFocusEffect(
    useCallback(() => {
      if (user) loadOrders(user.cpf);
    }, [user, loadOrders])
  );

  const step = (id: string, delta: number) => {
    Haptics.selectionAsync();
    setQty((prev) => {
      const next = Math.max(0, (prev[id] || 0) + delta);
      return { ...prev, [id]: next };
    });
  };

  const selected = products.filter((p) => (qty[p.id] || 0) > 0);
  const total = selected.reduce((sum, p) => sum + p.price * qty[p.id], 0);

  const submit = async () => {
    setError(null);
    if (!user || selected.length === 0) {
      setError('Selecione ao menos um produto.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    const firstBoat = user.boats && user.boats.length ? boatName(user.boats[0]) : user.boat_name;
    try {
      setSaving(true);
      await api.createOrder({
        cpf: user.cpf,
        boat_name: firstBoat,
        items: selected.map((p) => ({ product_id: p.id, name: p.name, price: p.price, qty: qty[p.id] })),
        observation: observation.trim() || null,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setQty({});
      setObservation('');
      await loadOrders(user.cpf);
    } catch (e: any) {
      setError(e.message || 'Erro ao enviar pedido.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']} testID="conveniencia-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={16} testID="back-button">
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Conveniência</Text>
          <Text style={styles.subtitle}>Peça produtos da marina</Text>
        </View>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={20}>
        {loading ? (
          <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
        ) : (
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text style={styles.sectionLabel}>Produtos</Text>
            {products.length === 0 ? (
              <Text style={styles.empty}>Nenhum produto disponível no momento.</Text>
            ) : (
              products.map((p) => {
                const c = qty[p.id] || 0;
                return (
                  <View key={p.id} style={styles.prodRow} testID={`product-${p.id}`}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.prodName}>{p.name}</Text>
                      <Text style={styles.prodPrice}>{money(p.price)}</Text>
                    </View>
                    <View style={styles.stepper}>
                      <Pressable testID={`product-minus-${p.id}`} onPress={() => step(p.id, -1)} style={styles.stepBtn} disabled={c === 0}>
                        <Ionicons name="remove" size={18} color={c === 0 ? colors.onSurfaceTertiary : colors.brandPrimary} />
                      </Pressable>
                      <Text style={styles.qtyText} testID={`product-qty-${p.id}`}>{c}</Text>
                      <Pressable testID={`product-plus-${p.id}`} onPress={() => step(p.id, 1)} style={styles.stepBtn}>
                        <Ionicons name="add" size={18} color={colors.brandPrimary} />
                      </Pressable>
                    </View>
                  </View>
                );
              })
            )}

            <Text style={[styles.sectionLabel, { marginTop: spacing.xl }]}>Observação</Text>
            <TextInput
              testID="conveniencia-observation"
              style={[styles.input, styles.textarea]}
              value={observation}
              onChangeText={setObservation}
              placeholder="Detalhes do pedido (opcional)"
              placeholderTextColor={colors.onSurfaceTertiary}
              multiline
              textAlignVertical="top"
            />

            {error ? <Text style={styles.errorText} testID="conveniencia-error">{error}</Text> : null}

            {orders.length > 0 ? (
              <>
                <Text style={[styles.sectionLabel, { marginTop: spacing.xl }]}>Meus pedidos</Text>
                {orders.map((o) => (
                  <View key={o.id} style={styles.orderCard} testID={`order-${o.id}`}>
                    <View style={styles.orderTop}>
                      <Text style={styles.orderTotal}>{money(o.total)}</Text>
                      <View style={[styles.badge, { backgroundColor: STATUS_COLOR[o.status] }]}>
                        <Text style={styles.badgeText}>{STATUS_LABEL[o.status]}</Text>
                      </View>
                    </View>
                    <Text style={styles.orderItems} numberOfLines={2}>
                      {o.items.map((i) => `${i.qty}x ${i.name}`).join(', ')}
                    </Text>
                    {o.observation ? <Text style={styles.orderObs}>Obs.: {o.observation}</Text> : null}
                  </View>
                ))}
              </>
            ) : null}
          </ScrollView>
        )}

        <View style={styles.footer}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue} testID="conveniencia-total">{money(total)}</Text>
          </View>
          <Pressable
            testID="conveniencia-submit"
            onPress={submit}
            disabled={saving || selected.length === 0}
            style={({ pressed }) => [styles.button, (selected.length === 0) && styles.buttonDisabled, pressed && { opacity: 0.85 }]}
          >
            {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.buttonText}>Enviar pedido</Text>}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg, gap: spacing.md },
  title: { color: colors.onSurface, fontSize: typography.xxl, fontWeight: '800' },
  subtitle: { color: colors.onSurfaceSecondary, fontSize: typography.sm, marginTop: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.lg, paddingBottom: 160 },
  sectionLabel: { color: colors.brandPrimary, fontWeight: '700', fontSize: typography.sm, letterSpacing: 1, textTransform: 'uppercase', marginBottom: spacing.md },
  empty: { color: colors.onSurfaceSecondary, fontSize: typography.base },
  prodRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.sm },
  prodName: { color: colors.onSurface, fontSize: typography.lg, fontWeight: '700' },
  prodPrice: { color: colors.onSurfaceSecondary, fontSize: typography.base, marginTop: 2 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  stepBtn: { width: 34, height: 34, borderRadius: radius.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  qtyText: { color: colors.onSurface, fontSize: typography.lg, fontWeight: '800', minWidth: 22, textAlign: 'center' },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.lg, fontSize: typography.lg, color: colors.onSurface, backgroundColor: colors.surfaceSecondary },
  textarea: { minHeight: 90 },
  errorText: { color: colors.error, backgroundColor: '#FEF2F2', padding: spacing.md, borderRadius: radius.sm, fontSize: typography.base, marginTop: spacing.md },
  orderCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.sm },
  orderTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs },
  orderTotal: { color: colors.onSurface, fontSize: typography.lg, fontWeight: '800' },
  orderItems: { color: colors.onSurfaceSecondary, fontSize: typography.base },
  orderObs: { color: colors.onSurfaceTertiary, fontSize: typography.sm, marginTop: 2 },
  badge: { paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.pill },
  badgeText: { color: '#FFFFFF', fontSize: typography.sm, fontWeight: '700' },
  footer: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: colors.surface, padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.divider },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  totalLabel: { color: colors.onSurfaceSecondary, fontSize: typography.base, fontWeight: '600' },
  totalValue: { color: colors.onSurface, fontSize: typography.xl, fontWeight: '800' },
  button: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.lg, alignItems: 'center' },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: colors.onBrandPrimary, fontSize: typography.lg, fontWeight: '700' },
});
