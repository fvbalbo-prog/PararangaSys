import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, spacing, radius, typography } from '@/src/theme';
import { formatMoney as money } from '@/src/format';
import { api } from '@/src/api';
import type { ConvenienceOrder, OrderStatus } from '@/src/api';

const fmt = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export default function AdminConvenienciaPedidosScreen() {
  const router = useRouter();
  const [orders, setOrders] = useState<ConvenienceOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setOrders(await api.listOrders());
    } catch {
      // keep previous
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
      const interval = setInterval(load, 15000);
      return () => clearInterval(interval);
    }, [load])
  );

  const todayISO = (() => {
    const d = new Date();
    const p = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  })();
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
  const caixaHoje = orders
    .filter((o) => o.status !== 'cancelada' && o.created_at.startsWith(todayISO))
    .reduce((s, o) => s + o.total, 0);
  const caixaSemana = orders
    .filter((o) => o.status !== 'cancelada' && new Date(o.created_at) >= weekAgo)
    .reduce((s, o) => s + o.total, 0);

  const setOrderStatus = async (id: string, status: OrderStatus) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, status } : o)));
    try { await api.setOrderStatus(id, status); } catch { load(); }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="admin-conveniencia-pedidos-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={16} testID="back-button">
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} testID="conveniencia-pedidos-title">Pedidos</Text>
          <Text style={styles.subtitle}>Conveniência</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(o) => o.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
          ListHeaderComponent={
            <Pressable style={styles.caixa} testID="caixa-summary" onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/admin-relatorio'); }}>
              <Ionicons name="cash-outline" size={22} color={colors.success} />
              <View style={styles.caixaCol}>
                <Text style={styles.caixaLabel}>Hoje</Text>
                <Text style={styles.caixaValue} testID="caixa-hoje">{money(caixaHoje)}</Text>
              </View>
              <View style={styles.caixaDivider} />
              <View style={styles.caixaCol}>
                <Text style={styles.caixaLabel}>Semana</Text>
                <Text style={styles.caixaValue} testID="caixa-semana">{money(caixaSemana)}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.success} />
            </Pressable>
          }
          ListEmptyComponent={<Text style={styles.empty}>Nenhum pedido.</Text>}
          renderItem={({ item }) => (
            <View style={styles.card} testID={`order-${item.id}`}>
              <View style={styles.cardTop}>
                <Text style={styles.cardName}>{item.user_name} • {item.boat_name}</Text>
                <Text style={styles.cardTotal}>{money(item.total)}</Text>
              </View>
              <Text style={styles.cardMeta}>{item.items.map((i) => `${i.qty}x ${i.name}`).join(', ')}</Text>
              <View style={styles.deliveryTag}>
                <Ionicons name={item.delivery_method === 'lancha' ? 'boat-outline' : 'storefront-outline'} size={13} color={colors.brandPrimary} />
                <Text style={styles.deliveryTagText}>{item.delivery_method === 'lancha' ? 'Entrega na lancha' : 'Retirada no balcão'}</Text>
              </View>
              {item.status === 'em_preparo' || item.status === 'pronto' ? (
                <View style={[styles.statusChip, { backgroundColor: item.status === 'pronto' ? '#0E7490' : '#B45309' }]}>
                  <Text style={styles.statusChipText}>{item.status === 'pronto' ? 'Pronto' : 'Em preparo'}</Text>
                </View>
              ) : null}
              {item.observation ? <Text style={styles.cardMeta}>Obs.: {item.observation}</Text> : null}
              <Text style={styles.cardTime}>{fmt(item.created_at)}</Text>
              {item.status !== 'entregue' && item.status !== 'cancelada' ? (
                <View style={styles.actions}>
                  {item.status === 'pendente' ? (
                    <Pressable testID={`order-prepare-${item.id}`} onPress={() => setOrderStatus(item.id, 'em_preparo')} style={[styles.actionBtn, { borderRightWidth: 1, borderRightColor: colors.border }]}>
                      <Ionicons name="flame-outline" size={16} color="#B45309" />
                      <Text style={[styles.actionText, { color: '#B45309' }]}>Preparar</Text>
                    </Pressable>
                  ) : null}
                  {item.status === 'em_preparo' ? (
                    <Pressable testID={`order-ready-${item.id}`} onPress={() => setOrderStatus(item.id, 'pronto')} style={[styles.actionBtn, { borderRightWidth: 1, borderRightColor: colors.border }]}>
                      <Ionicons name="checkmark-done-outline" size={16} color="#0E7490" />
                      <Text style={[styles.actionText, { color: '#0E7490' }]}>Pronto</Text>
                    </Pressable>
                  ) : null}
                  {item.status === 'pronto' ? (
                    <Pressable testID={`order-deliver-${item.id}`} onPress={() => setOrderStatus(item.id, 'entregue')} style={[styles.actionBtn, { borderRightWidth: 1, borderRightColor: colors.border }]}>
                      <Ionicons name="bag-check-outline" size={16} color={colors.success} />
                      <Text style={[styles.actionText, { color: colors.success }]}>Entregar</Text>
                    </Pressable>
                  ) : null}
                  <Pressable testID={`order-cancel-${item.id}`} onPress={() => setOrderStatus(item.id, 'cancelada')} style={styles.actionBtn}>
                    <Ionicons name="close-circle-outline" size={16} color={colors.error} />
                    <Text style={[styles.actionText, { color: colors.error }]}>Cancelar</Text>
                  </Pressable>
                </View>
              ) : (
                <View style={[styles.statusTag, { backgroundColor: item.status === 'entregue' ? colors.success : colors.error }]}>
                  <Text style={styles.statusTagText}>{item.status === 'entregue' ? 'Entregue' : 'Cancelada'}</Text>
                </View>
              )}
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg, gap: spacing.md },
  title: { color: colors.onSurface, fontSize: typography.xxl, fontWeight: '800' },
  subtitle: { color: colors.onSurfaceSecondary, fontSize: typography.sm, marginTop: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.md },
  empty: { color: colors.onSurfaceSecondary, fontSize: typography.base, textAlign: 'center', marginTop: spacing.xxl },
  caixa: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: '#ECFDF5', borderRadius: radius.md, borderWidth: 1, borderColor: '#A7F3D0', padding: spacing.lg, marginBottom: spacing.md },
  caixaCol: { flex: 1 },
  caixaLabel: { color: '#047857', fontSize: typography.sm, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  caixaValue: { color: '#065F46', fontSize: typography.xl, fontWeight: '800', marginTop: 2 },
  caixaDivider: { width: 1, height: 32, backgroundColor: '#A7F3D0' },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs },
  cardName: { color: colors.onSurface, fontSize: typography.lg, fontWeight: '800' },
  cardTotal: { color: colors.onSurface, fontSize: typography.lg, fontWeight: '800' },
  cardMeta: { color: colors.onSurfaceSecondary, fontSize: typography.base, marginTop: 2 },
  deliveryTag: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6, alignSelf: 'flex-start', backgroundColor: colors.brandTertiary, paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill },
  deliveryTagText: { color: colors.brandPrimary, fontSize: typography.sm, fontWeight: '700' },
  statusChip: { alignSelf: 'flex-start', borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 3, marginTop: 6 },
  statusChipText: { color: '#FFFFFF', fontSize: typography.sm, fontWeight: '700' },
  cardTime: { color: colors.onSurfaceTertiary, fontSize: typography.sm, marginTop: 4 },
  actions: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.border, marginTop: spacing.md },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingVertical: spacing.md },
  actionText: { fontSize: typography.base, fontWeight: '700' },
  statusTag: { alignSelf: 'flex-start', paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.pill, marginTop: spacing.sm },
  statusTagText: { color: '#FFFFFF', fontSize: typography.sm, fontWeight: '700' },
});
