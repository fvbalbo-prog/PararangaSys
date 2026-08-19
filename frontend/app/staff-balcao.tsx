import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { colors, spacing, radius, typography } from '@/src/theme';
import { formatMoney as money } from '@/src/format';
import { api } from '@/src/api';
import type { ConvenienceOrder, OrderStatus } from '@/src/api';

function todayISO() {
  const d = new Date();
  const p = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

const LABEL: Record<string, string> = { pendente: 'Recebido', em_preparo: 'Em preparo', pronto: 'Pronto', entregue: 'Entregue', cancelada: 'Cancelada' };
const COLOR: Record<string, string> = { pendente: colors.warning, em_preparo: '#B45309', pronto: '#0E7490', entregue: colors.success, cancelada: colors.error };

export default function StaffBalcaoScreen() {
  const router = useRouter();
  const [orders, setOrders] = useState<ConvenienceOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const raw = await AsyncStorage.getItem('user');
    if (!raw) return router.replace('/');
    try {
      const all = await api.listOrders();
      const iso = todayISO();
      setOrders(all.filter((o) => (o.created_at || '').startsWith(iso)).sort((a, b) => b.created_at.localeCompare(a.created_at)));
    } catch {
      setOrders([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [router]);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    load();
    const interval = setInterval(load, 12000);
    return () => clearInterval(interval);
  }, [load]));

  const update = async (id: string, status: OrderStatus) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, status } : o)));
    try { await api.setOrderStatus(id, status); } catch { load(); }
  };

  const pending = orders.filter((o) => o.status !== 'entregue' && o.status !== 'cancelada');
  const done = orders.filter((o) => o.status === 'entregue' || o.status === 'cancelada');
  const data = [...pending, ...done];

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="staff-balcao-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={16} testID="back-button" style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.onBrandPrimary} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>CONVENIÊNCIA</Text>
          <Text style={styles.title} testID="balcao-title">Balcão de Pedidos</Text>
          <Text style={styles.sub}>{pending.length} em aberto • hoje</Text>
        </View>
      </View>

      <View style={styles.sheet}>
        {loading ? (
          <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
        ) : data.length === 0 ? (
          <View style={styles.center}>
            <View style={styles.emptyIcon}><Ionicons name="cart-outline" size={44} color={colors.brandSecondary} /></View>
            <Text style={styles.emptyTitle}>Nenhum pedido hoje</Text>
          </View>
        ) : (
          <FlatList
            data={data}
            keyExtractor={(o) => o.id}
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
            renderItem={({ item }) => {
              const isLancha = item.delivery_method === 'lancha';
              return (
                <View style={[styles.card, isLancha && item.status !== 'entregue' && item.status !== 'cancelada' && styles.cardLancha]} testID={`balcao-order-${item.id}`}>
                  <View style={styles.cardTop}>
                    <View style={[styles.deliveryTag, { backgroundColor: isLancha ? '#7C3AED' : colors.brandPrimary }]}>
                      <Ionicons name={isLancha ? 'boat' : 'storefront'} size={13} color="#FFFFFF" />
                      <Text style={styles.deliveryTagText}>{isLancha ? 'Entrega na lancha' : 'Retirada no balcão'}</Text>
                    </View>
                    <View style={[styles.badge, { backgroundColor: COLOR[item.status] }]}>
                      <Text style={styles.badgeText}>{LABEL[item.status]}</Text>
                    </View>
                  </View>
                  <Text style={styles.orderMeta}>{item.boat_name || 'Cliente'} • {fmtTime(item.created_at)} • {money(item.total)}</Text>
                  <Text style={styles.orderItems}>{item.items.map((i) => `${i.qty}x ${i.name}`).join(', ')}</Text>
                  {item.observation ? <Text style={styles.orderObs}>Obs.: {item.observation}</Text> : null}

                  {item.status === 'pendente' || item.status === 'em_preparo' || item.status === 'pronto' ? (
                    <View style={styles.actions}>
                      {item.status === 'pendente' ? (
                        <Pressable testID={`balcao-prepare-${item.id}`} onPress={() => update(item.id, 'em_preparo')} style={[styles.actionBtn, { backgroundColor: '#B45309' }]}>
                          <Ionicons name="flame" size={16} color="#FFFFFF" /><Text style={styles.actionText}>Preparar</Text>
                        </Pressable>
                      ) : null}
                      {item.status === 'em_preparo' ? (
                        <Pressable testID={`balcao-ready-${item.id}`} onPress={() => update(item.id, 'pronto')} style={[styles.actionBtn, { backgroundColor: '#0E7490' }]}>
                          <Ionicons name="checkmark-done" size={16} color="#FFFFFF" /><Text style={styles.actionText}>Pronto</Text>
                        </Pressable>
                      ) : null}
                      {item.status === 'pronto' ? (
                        <Pressable testID={`balcao-deliver-${item.id}`} onPress={() => update(item.id, 'entregue')} style={[styles.actionBtn, { backgroundColor: colors.success }]}>
                          <Ionicons name="bag-check" size={16} color="#FFFFFF" /><Text style={styles.actionText}>Entregue</Text>
                        </Pressable>
                      ) : null}
                      <Pressable testID={`balcao-cancel-${item.id}`} onPress={() => update(item.id, 'cancelada')} style={[styles.actionBtn, styles.cancelBtn]}>
                        <Ionicons name="close" size={16} color={colors.error} /><Text style={[styles.actionText, { color: colors.error }]}>Cancelar</Text>
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              );
            }}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.brandPrimary },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.lg },
  backBtn: { padding: spacing.sm, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.08)' },
  kicker: { color: colors.brandSecondary, letterSpacing: 3, fontSize: 11, fontWeight: '700' },
  title: { color: colors.onBrandPrimary, fontSize: 22, fontWeight: '800', marginTop: 4 },
  sub: { color: colors.onBrandPrimary, opacity: 0.8, fontSize: typography.sm, marginTop: 2 },
  sheet: { flex: 1, backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingTop: spacing.lg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  emptyIcon: { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg },
  emptyTitle: { color: colors.onSurface, fontSize: typography.xl, fontWeight: '700' },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.md },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
  cardLancha: { borderColor: '#7C3AED', borderWidth: 1.5 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  deliveryTag: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill },
  deliveryTagText: { color: '#FFFFFF', fontSize: typography.sm, fontWeight: '700' },
  badge: { borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 4 },
  badgeText: { color: '#FFFFFF', fontSize: typography.sm, fontWeight: '700' },
  orderMeta: { color: colors.onSurface, fontSize: typography.base, fontWeight: '700', marginTop: spacing.md },
  orderItems: { color: colors.onSurfaceSecondary, fontSize: typography.base, marginTop: 4 },
  orderObs: { color: colors.onSurfaceTertiary, fontSize: typography.sm, marginTop: 2 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  actionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.sm, flexGrow: 1 },
  actionText: { color: '#FFFFFF', fontSize: typography.base, fontWeight: '700' },
  cancelBtn: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
});
