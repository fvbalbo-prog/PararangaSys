import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { colors, spacing, radius, typography } from '@/src/theme';
import { api } from '@/src/api';
import type { User } from '@/src/api';

type Item = {
  id: string;
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  route: string;
  testID: string;
  color: string;
};

const ITEMS: Item[] = [
  { id: 'desc-sub', title: 'Descida / Subida', subtitle: 'Solicitar e alterar movimentações', icon: 'boat-outline', route: '/home', testID: 'menu-descida-subida', color: colors.brandPrimary },
  { id: 'fila', title: 'Fila em Tempo Real', subtitle: 'Sua posição na fila do dia', icon: 'time-outline', route: '/fila', testID: 'menu-fila', color: '#B45309' },
  { id: 'conv', title: 'Conveniência', subtitle: 'Produtos e serviços da marina', icon: 'cart-outline', route: '/conveniencia', testID: 'menu-conveniencia', color: '#0E7490' },
  { id: 'autoriz', title: 'Autorizar Entrada', subtitle: 'Liberar terceiros a usar a lancha', icon: 'shield-checkmark-outline', route: '/autorizar', testID: 'menu-autorizar', color: '#4D7C0F' },
  { id: 'emerg', title: 'Emergência', subtitle: 'Acionar socorro e contatos', icon: 'alert-circle-outline', route: '/emergencia', testID: 'menu-emergencia', color: colors.error },
  { id: 'fatura', title: 'Minha Fatura', subtitle: 'Consumo e cobrança mensal', icon: 'receipt-outline', route: '/fatura', testID: 'menu-fatura', color: '#7C3AED' },
];

export default function MenuScreen() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [newInvoice, setNewInvoice] = useState(false);
  const [unread, setUnread] = useState(0);

  const loadUser = useCallback(async () => {
    const raw = await AsyncStorage.getItem('user');
    if (!raw) return router.replace('/');
    const u: User = JSON.parse(raw);
    setUser(u);
    setLoading(false);
    try {
      const sts = await api.listStatements(u.cpf);
      setNewInvoice(sts.some((s) => !s.read));
    } catch {
      setNewInvoice(false);
    }
    try {
      const notifs = await api.listNotifications(u.cpf);
      setUnread(notifs.filter((n) => !n.read).length);
    } catch {
      setUnread(0);
    }
  }, [router]);

  useFocusEffect(useCallback(() => { loadUser(); }, [loadUser]));

  const logout = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await AsyncStorage.removeItem('user');
    router.replace('/');
  };

  if (loading || !user) {
    return <View style={[styles.root, { justifyContent: 'center', alignItems: 'center' }]}><ActivityIndicator color={colors.onBrandPrimary} /></View>;
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>MARINA PARARANGA</Text>
          <Text style={styles.name} testID="menu-user-name">Olá, {user.name.split(' ')[0]}</Text>
        </View>
        <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/avisos'); }} hitSlop={12} testID="menu-avisos" style={[styles.logoutBtn, { marginRight: spacing.sm }]}>
          <Ionicons name="notifications-outline" size={22} color={colors.onBrandPrimary} />
          {unread > 0 ? (
            <View style={styles.bellBadge} testID="menu-avisos-badge">
              <Text style={styles.bellBadgeText}>{unread > 9 ? '9+' : unread}</Text>
            </View>
          ) : null}
        </Pressable>
        <Pressable onPress={logout} hitSlop={12} testID="menu-logout" style={styles.logoutBtn}>
          <Ionicons name="log-out-outline" size={22} color={colors.onBrandPrimary} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionTitle}>Menu principal</Text>
        <Text style={styles.sectionSubtitle}>Escolha uma opção</Text>

        {ITEMS.map((it) => (
          <Pressable
            key={it.id}
            testID={it.testID}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(it.route as any); }}
            style={({ pressed }) => [styles.row, pressed && { transform: [{ scale: 0.99 }] }]}
          >
            <View style={[styles.iconWrap, { backgroundColor: it.color }]}>
              <Ionicons name={it.icon} size={26} color="#FFFFFF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{it.title}</Text>
              <Text style={styles.rowSubtitle}>{it.subtitle}</Text>
            </View>
            {it.id === 'fatura' && newInvoice ? (
              <View style={styles.newBadge} testID="menu-fatura-badge"><Text style={styles.newBadgeText}>Novo</Text></View>
            ) : null}
            <Ionicons name="chevron-forward" size={20} color={colors.onSurfaceTertiary} />
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.brandPrimary },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.xl },
  kicker: { color: colors.brandSecondary, letterSpacing: 3, fontSize: 11, fontWeight: '700' },
  name: { color: colors.onBrandPrimary, fontSize: 28, fontWeight: '800', marginTop: 4 },
  logoutBtn: { padding: spacing.sm, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.08)' },
  bellBadge: { position: 'absolute', top: 2, right: 2, backgroundColor: colors.error, borderRadius: radius.pill, minWidth: 16, height: 16, paddingHorizontal: 3, alignItems: 'center', justifyContent: 'center' },
  bellBadgeText: { color: '#FFFFFF', fontSize: 9, fontWeight: '800' },
  content: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.xl, paddingBottom: spacing.xxxl, minHeight: '100%', gap: spacing.md },
  sectionTitle: { color: colors.onSurface, fontSize: typography.xxl, fontWeight: '800' },
  sectionSubtitle: { color: colors.onSurfaceSecondary, fontSize: typography.base, marginTop: spacing.xs, marginBottom: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.border },
  iconWrap: { width: 52, height: 52, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { color: colors.onSurface, fontSize: typography.lg, fontWeight: '800' },
  rowSubtitle: { color: colors.onSurfaceSecondary, fontSize: typography.sm, marginTop: 2 },
  newBadge: { backgroundColor: colors.error, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  newBadgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
});
