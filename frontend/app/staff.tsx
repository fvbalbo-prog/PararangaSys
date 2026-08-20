import { useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  Vibration,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { useAudioPlayer } from 'expo-audio';
import { colors, spacing, radius, typography } from '@/src/theme';
import { api } from '@/src/api';
import type { MarinaRequest, ConvenienceOrder } from '@/src/api';

const alertSound = require('@/assets/sounds/alert.wav');

function todayISO() {
  const d = new Date();
  const p = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const ACTIVE_ORDER = (o: ConvenienceOrder) =>
  (o.created_at || '').startsWith(todayISO()) && o.status !== 'entregue' && o.status !== 'cancelada';

export default function StaffScreen() {
  const router = useRouter();
  const [items, setItems] = useState<MarinaRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [openEmergencies, setOpenEmergencies] = useState(0);
  const [balcaoCount, setBalcaoCount] = useState(0);
  const [lanchaPending, setLanchaPending] = useState(0);
  const prevEmgRef = useRef<number | null>(null);
  const prevLanchaRef = useRef<number | null>(null);
  const player = useAudioPlayer(alertSound);

  const playAlert = useCallback(() => {
    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Vibration.vibrate([0, 400, 200, 400, 200, 400]);
      player.seekTo(0);
      player.play();
    } catch {}
  }, [player]);

  const load = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem('user');
      if (!raw) return router.replace('/');
      const [data, emgs, orders] = await Promise.all([
        api.dayRequests(),
        api.listEmergencies(undefined, 'aberta').catch(() => []),
        api.listOrders().catch(() => [] as ConvenienceOrder[]),
      ]);
      setItems(data);
      const count = emgs.length;
      setOpenEmergencies(count);
      if (prevEmgRef.current !== null && count > prevEmgRef.current) playAlert();
      prevEmgRef.current = count;

      const active = orders.filter(ACTIVE_ORDER);
      setBalcaoCount(active.length);
      const lancha = active.filter((o) => o.delivery_method === 'lancha').length;
      setLanchaPending(lancha);
      if (prevLanchaRef.current !== null && lancha > prevLanchaRef.current) playAlert();
      prevLanchaRef.current = lancha;
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [router, playAlert]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
      const interval = setInterval(load, 15000);
      return () => clearInterval(interval);
    }, [load])
  );

  const logout = async () => {
    await AsyncStorage.removeItem('user');
    router.replace('/');
  };

  const go = (path: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(path);
  };

  const pendingDescidas = items.filter((i) => i.type === 'descida' && i.status === 'agendada').length;
  const pendingSubidas = items.filter((i) => i.type === 'subida' && i.status === 'agendada').length;

  const MENU: { key: string; title: string; subtitle: string; icon: keyof typeof Ionicons.glyphMap; color: string; route: string; badge?: number }[] = [
    { key: 'descida', title: 'Confirmar Descida', subtitle: 'Lanchas que entraram na água', icon: 'boat', color: colors.brandPrimary, route: '/staff-movimentacoes?filter=descida', badge: pendingDescidas },
    { key: 'subida', title: 'Confirmar Subida', subtitle: 'Lanchas que voltaram ao seco', icon: 'arrow-up-circle', color: colors.success, route: '/staff-movimentacoes?filter=subida', badge: pendingSubidas },
    { key: 'todas', title: 'Painel de Movimentações', subtitle: 'Todas as movimentações do dia', icon: 'list', color: '#0E7490', route: '/staff-movimentacoes?filter=all' },
    { key: 'balcao', title: 'Balcão de Pedidos', subtitle: 'Conveniência: preparar e entregar', icon: 'cart', color: '#7C3AED', route: '/staff-balcao', badge: balcaoCount },
    { key: 'autorizados', title: 'Pessoas Autorizadas', subtitle: 'Consulta das autorizações de hoje', icon: 'shield-checkmark', color: '#4D7C0F', route: '/staff-autorizacoes' },
    { key: 'ponto', title: 'Ponto Eletrônico', subtitle: 'Registrar entrada, almoço e saída', icon: 'time', color: '#0369A1', route: '/ponto' },
  ];

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>FUNCIONÁRIOS</Text>
          <Text style={styles.title} testID="staff-title">Painel do funcionário</Text>
        </View>
        <Pressable onPress={logout} hitSlop={12} testID="staff-logout" style={styles.logoutBtn}>
          <Ionicons name="log-out-outline" size={22} color={colors.onBrandPrimary} />
        </Pressable>
      </View>

      <View style={styles.sheet}>
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
        >
          {openEmergencies > 0 ? (
            <Pressable
              testID="staff-emergency-banner"
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); router.push('/admin-emergencias'); }}
              style={({ pressed }) => [styles.emgBanner, pressed && { opacity: 0.9 }]}
            >
              <Ionicons name="alert-circle" size={24} color="#FFFFFF" />
              <View style={{ flex: 1 }}>
                <Text style={styles.emgTitle}>
                  {openEmergencies === 1 ? '1 emergência aberta!' : `${openEmergencies} emergências abertas!`}
                </Text>
                <Text style={styles.emgSub}>Toque para atender agora</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#FFFFFF" />
            </Pressable>
          ) : null}

          {lanchaPending > 0 ? (
            <Pressable
              testID="staff-balcao-banner"
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); router.push('/staff-balcao'); }}
              style={({ pressed }) => [styles.balcaoBanner, pressed && { opacity: 0.9 }]}
            >
              <Ionicons name="boat" size={22} color="#FFFFFF" />
              <View style={{ flex: 1 }}>
                <Text style={styles.emgTitle}>
                  {lanchaPending === 1 ? '1 entrega na lancha aguardando' : `${lanchaPending} entregas na lancha aguardando`}
                </Text>
                <Text style={styles.emgSub}>Toque para preparar e agilizar a saída</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#FFFFFF" />
            </Pressable>
          ) : null}

          {loading ? (
            <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
          ) : (
            MENU.map((m) => (
              <Pressable
                key={m.key}
                testID={`staff-menu-${m.key}`}
                onPress={() => go(m.route)}
                style={({ pressed }) => [styles.menuCard, pressed && { opacity: 0.9 }]}
              >
                <View style={[styles.menuIcon, { backgroundColor: m.color }]}>
                  <Ionicons name={m.icon} size={24} color="#FFFFFF" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.menuTitle}>{m.title}</Text>
                  <Text style={styles.menuSub}>{m.subtitle}</Text>
                </View>
                {m.badge && m.badge > 0 ? (
                  <View style={styles.countBadge}>
                    <Text style={styles.countBadgeText}>{m.badge}</Text>
                  </View>
                ) : null}
                <Ionicons name="chevron-forward" size={20} color={colors.onSurfaceTertiary} />
              </Pressable>
            ))
          )}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.brandPrimary },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.lg },
  kicker: { color: colors.brandSecondary, letterSpacing: 3, fontSize: 11, fontWeight: '700' },
  title: { color: colors.onBrandPrimary, fontSize: 24, fontWeight: '800', marginTop: 4 },
  logoutBtn: { padding: spacing.sm, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.08)' },
  sheet: { flex: 1, backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingTop: spacing.lg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.md },
  emgBanner: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.error, padding: spacing.lg, borderRadius: radius.md, marginBottom: spacing.xs },
  balcaoBanner: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: '#7C3AED', padding: spacing.lg, borderRadius: radius.md, marginBottom: spacing.xs },
  emgTitle: { color: '#FFFFFF', fontSize: typography.lg, fontWeight: '800' },
  emgSub: { color: '#FFFFFF', opacity: 0.9, fontSize: typography.sm, marginTop: 2 },
  center: { paddingVertical: spacing.xxxl, alignItems: 'center', justifyContent: 'center' },
  menuCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
  menuIcon: { width: 52, height: 52, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  menuTitle: { color: colors.onSurface, fontSize: typography.lg, fontWeight: '800' },
  menuSub: { color: colors.onSurfaceSecondary, fontSize: typography.sm, marginTop: 2 },
  countBadge: { backgroundColor: colors.error, borderRadius: radius.pill, minWidth: 24, height: 24, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  countBadgeText: { color: '#FFFFFF', fontSize: typography.sm, fontWeight: '800' },
});
