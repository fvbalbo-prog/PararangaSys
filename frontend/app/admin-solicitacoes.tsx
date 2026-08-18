import { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, spacing, radius, typography } from '@/src/theme';
import { api } from '@/src/api';
import type { ConvenienceOrder, Authorization, Emergency } from '@/src/api';

type Tab = 'pedidos' | 'autorizacoes' | 'emergencias';
const money = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`;
const fmt = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

export default function AdminSolicitacoesScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('pedidos');
  const [orders, setOrders] = useState<ConvenienceOrder[]>([]);
  const [auths, setAuths] = useState<Authorization[]>([]);
  const [emergencies, setEmergencies] = useState<Emergency[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [o, a, e] = await Promise.all([
        api.listOrders(),
        api.listAuthorizations(),
        api.listEmergencies(),
      ]);
      setOrders(o);
      setAuths(a);
      setEmergencies(e);
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
    }, [load])
  );

  const openEmergencies = emergencies.filter((e) => e.status === 'aberta').length;

  const setOrderStatus = async (id: string, status: 'entregue' | 'cancelada') => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, status } : o)));
    try { await api.setOrderStatus(id, status); } catch { load(); }
  };
  const cancelAuth = async (id: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    setAuths((prev) => prev.map((a) => (a.id === id ? { ...a, status: 'cancelada' } : a)));
    try { await api.cancelAuthorization(id); } catch { load(); }
  };
  const resolveEmergency = async (id: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setEmergencies((prev) => prev.map((e) => (e.id === id ? { ...e, status: 'atendida' } : e)));
    try { await api.resolveEmergency(id); } catch { load(); }
  };

  const TABS: { key: Tab; label: string; badge?: number }[] = [
    { key: 'pedidos', label: 'Conveniência' },
    { key: 'autorizacoes', label: 'Autorizações' },
    { key: 'emergencias', label: 'Emergências', badge: openEmergencies },
  ];

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={16} testID="back-button" style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.onBrandPrimary} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>MARINA</Text>
          <Text style={styles.title} testID="solicitacoes-title">Pedidos & Chamados</Text>
        </View>
        <Pressable
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/admin-produtos'); }}
          hitSlop={12}
          testID="produtos-manage-button"
          style={styles.backBtn}
        >
          <Ionicons name="pricetags-outline" size={22} color={colors.onBrandPrimary} />
        </Pressable>
      </View>

      <View style={styles.sheet}>
        <View style={styles.tabs}>
          {TABS.map((t) => (
            <Pressable
              key={t.key}
              testID={`tab-${t.key}`}
              onPress={() => { setTab(t.key); Haptics.selectionAsync(); }}
              style={[styles.tab, tab === t.key && styles.tabActive]}
            >
              <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>{t.label}</Text>
              {t.badge ? <View style={styles.tabBadge}><Text style={styles.tabBadgeText}>{t.badge}</Text></View> : null}
            </Pressable>
          ))}
        </View>

        {loading ? (
          <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
        ) : tab === 'pedidos' ? (
          <FlatList
            data={orders}
            keyExtractor={(o) => o.id}
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
            ListEmptyComponent={<Text style={styles.empty}>Nenhum pedido.</Text>}
            renderItem={({ item }) => (
              <View style={styles.card} testID={`order-${item.id}`}>
                <View style={styles.cardTop}>
                  <Text style={styles.cardName}>{item.user_name} • {item.boat_name}</Text>
                  <Text style={styles.cardTotal}>{money(item.total)}</Text>
                </View>
                <Text style={styles.cardMeta}>{item.items.map((i) => `${i.qty}x ${i.name}`).join(', ')}</Text>
                {item.observation ? <Text style={styles.cardMeta}>Obs.: {item.observation}</Text> : null}
                <Text style={styles.cardTime}>{fmt(item.created_at)}</Text>
                {item.status === 'pendente' ? (
                  <View style={styles.actions}>
                    <Pressable testID={`order-deliver-${item.id}`} onPress={() => setOrderStatus(item.id, 'entregue')} style={[styles.actionBtn, { borderRightWidth: 1, borderRightColor: colors.border }]}>
                      <Ionicons name="checkmark-circle-outline" size={16} color={colors.success} />
                      <Text style={[styles.actionText, { color: colors.success }]}>Entregar</Text>
                    </Pressable>
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
        ) : tab === 'autorizacoes' ? (
          <FlatList
            data={auths}
            keyExtractor={(a) => a.id}
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
            ListEmptyComponent={<Text style={styles.empty}>Nenhuma autorização.</Text>}
            renderItem={({ item }) => (
              <View style={styles.card} testID={`auth-${item.id}`}>
                <View style={styles.cardTop}>
                  <Text style={styles.cardName}>{item.person_name}</Text>
                  <Text style={styles.cardMeta}>{fmtDate(item.date)}</Text>
                </View>
                <Text style={styles.cardMeta}>Lancha: {item.boat_name} • Titular: {item.user_name}</Text>
                {item.status === 'ativa' ? (
                  <Pressable testID={`auth-cancel-${item.id}`} onPress={() => cancelAuth(item.id)} style={[styles.actionBtn, { justifyContent: 'flex-start', paddingHorizontal: 0, marginTop: spacing.sm }]}>
                    <Ionicons name="close-circle-outline" size={16} color={colors.error} />
                    <Text style={[styles.actionText, { color: colors.error }]}>Cancelar autorização</Text>
                  </Pressable>
                ) : (
                  <View style={[styles.statusTag, { backgroundColor: colors.surfaceTertiary }]}>
                    <Text style={[styles.statusTagText, { color: colors.onSurfaceTertiary }]}>Cancelada</Text>
                  </View>
                )}
              </View>
            )}
          />
        ) : (
          <FlatList
            data={emergencies}
            keyExtractor={(e) => e.id}
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
            ListEmptyComponent={<Text style={styles.empty}>Nenhuma emergência.</Text>}
            renderItem={({ item }) => (
              <View style={[styles.card, item.status === 'aberta' && styles.cardAlert]} testID={`emergency-${item.id}`}>
                <View style={styles.cardTop}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                    <Ionicons name="alert-circle" size={20} color={item.status === 'aberta' ? colors.error : colors.success} />
                    <Text style={styles.cardName}>{item.user_name}</Text>
                  </View>
                  <Text style={styles.cardTime}>{fmt(item.created_at)}</Text>
                </View>
                <Text style={styles.cardMeta}>Lancha: {item.boat_name}{item.phone ? ` • Tel.: ${item.phone}` : ''}</Text>
                {item.location ? <Text style={styles.cardMeta}>Local: {item.location}</Text> : null}
                {item.observation ? <Text style={styles.cardMeta}>{item.observation}</Text> : null}
                {item.status === 'aberta' ? (
                  <Pressable testID={`emergency-resolve-${item.id}`} onPress={() => resolveEmergency(item.id)} style={styles.resolveBtn}>
                    <Ionicons name="checkmark-circle" size={18} color="#FFFFFF" />
                    <Text style={styles.resolveText}>Marcar como atendida</Text>
                  </Pressable>
                ) : (
                  <View style={[styles.statusTag, { backgroundColor: colors.success }]}>
                    <Text style={styles.statusTagText}>Atendida</Text>
                  </View>
                )}
              </View>
            )}
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
  title: { color: colors.onBrandPrimary, fontSize: 24, fontWeight: '800', marginTop: 4 },
  sheet: { flex: 1, backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingTop: spacing.lg },
  tabs: { flexDirection: 'row', gap: spacing.sm, marginHorizontal: spacing.lg, marginBottom: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.xs },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: spacing.md, borderRadius: radius.sm },
  tabActive: { backgroundColor: colors.brandPrimary },
  tabText: { color: colors.onSurfaceSecondary, fontSize: typography.sm, fontWeight: '700' },
  tabTextActive: { color: colors.onBrandPrimary },
  tabBadge: { backgroundColor: colors.error, borderRadius: radius.pill, minWidth: 18, height: 18, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  tabBadgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.md },
  empty: { color: colors.onSurfaceSecondary, fontSize: typography.base, textAlign: 'center', marginTop: spacing.xxl },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
  cardAlert: { borderColor: colors.error, borderWidth: 1.5, backgroundColor: '#FEF2F2' },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs },
  cardName: { color: colors.onSurface, fontSize: typography.lg, fontWeight: '800' },
  cardTotal: { color: colors.onSurface, fontSize: typography.lg, fontWeight: '800' },
  cardMeta: { color: colors.onSurfaceSecondary, fontSize: typography.base, marginTop: 2 },
  cardTime: { color: colors.onSurfaceTertiary, fontSize: typography.sm, marginTop: 4 },
  actions: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.border, marginTop: spacing.md },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingVertical: spacing.md },
  actionText: { fontSize: typography.base, fontWeight: '700' },
  statusTag: { alignSelf: 'flex-start', paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.pill, marginTop: spacing.sm },
  statusTagText: { color: '#FFFFFF', fontSize: typography.sm, fontWeight: '700' },
  resolveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, backgroundColor: colors.success, paddingVertical: spacing.md, borderRadius: radius.sm, marginTop: spacing.md },
  resolveText: { color: '#FFFFFF', fontSize: typography.base, fontWeight: '700' },
});
