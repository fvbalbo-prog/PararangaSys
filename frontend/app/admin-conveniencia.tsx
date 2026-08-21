import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, spacing, radius, typography } from '@/src/theme';
import { api } from '@/src/api';
import type { Product, ConvenienceOrder, CompraItem } from '@/src/api';

export default function ConvenienciaHubScreen() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<ConvenienceOrder[]>([]);
  const [compras, setCompras] = useState<CompraItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, o, c] = await Promise.all([
        api.listProducts(true),
        api.listOrders(),
        api.listCompraItems(false),
      ]);
      setProducts(p);
      setOrders(o);
      setCompras(c);
    } catch {
      // keep previous
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  const go = (path: string) => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(path); };

  const activeProducts = products.filter((p) => p.active).length;
  const pendingOrders = orders.filter((o) => o.status !== 'entregue' && o.status !== 'cancelada').length;
  const pendingCompras = compras.length;

  const MENU: { key: string; title: string; subtitle: string; icon: keyof typeof Ionicons.glyphMap; color: string; route: string; count: number }[] = [
    { key: 'produtos', title: 'Produtos', subtitle: 'Cadastrar e gerenciar o cardápio', icon: 'pricetags', color: colors.brandPrimary, route: '/admin-produtos', count: activeProducts },
    { key: 'pedidos', title: 'Pedidos', subtitle: 'Acompanhar e preparar pedidos', icon: 'cart', color: '#7C3AED', route: '/admin-conveniencia-pedidos', count: pendingOrders },
    { key: 'compras', title: 'Lista de Compras', subtitle: 'O que precisa repor', icon: 'basket', color: '#0E7490', route: '/admin-conveniencia-compras', count: pendingCompras },
  ];

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="admin-conveniencia-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={16} testID="back-button">
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} testID="conveniencia-title">Conveniência</Text>
          <Text style={styles.subtitle}>Produtos, pedidos e compras em um só lugar</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
      >
        {loading ? (
          <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
        ) : (
          MENU.map((m) => (
            <Pressable key={m.key} testID={`conveniencia-menu-${m.key}`} onPress={() => go(m.route)} style={({ pressed }) => [styles.menuCard, pressed && { opacity: 0.9 }]}>
              <View style={[styles.menuIcon, { backgroundColor: m.color }]}>
                <Ionicons name={m.icon} size={24} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.menuTitle}>{m.title}</Text>
                <Text style={styles.menuSub}>{m.subtitle}</Text>
              </View>
              {m.count > 0 ? (
                <View style={styles.countBadge}>
                  <Text style={styles.countBadgeText}>{m.count}</Text>
                </View>
              ) : null}
              <Ionicons name="chevron-forward" size={20} color={colors.onSurfaceTertiary} />
            </Pressable>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg, gap: spacing.md },
  title: { color: colors.onSurface, fontSize: typography.xxl, fontWeight: '800' },
  subtitle: { color: colors.onSurfaceSecondary, fontSize: typography.sm, marginTop: 2 },
  content: { padding: spacing.lg, paddingTop: 0, gap: spacing.md },
  center: { paddingVertical: spacing.xxxl, alignItems: 'center' },
  menuCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
  menuIcon: { width: 52, height: 52, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  menuTitle: { color: colors.onSurface, fontSize: typography.lg, fontWeight: '800' },
  menuSub: { color: colors.onSurfaceSecondary, fontSize: typography.sm, marginTop: 2 },
  countBadge: { backgroundColor: colors.brandSecondary, borderRadius: radius.pill, minWidth: 26, height: 26, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  countBadgeText: { color: '#FFFFFF', fontSize: typography.sm, fontWeight: '800' },
});
