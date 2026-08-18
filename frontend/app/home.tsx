import { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { colors, spacing, radius, typography } from '@/src/theme';
import type { User } from '@/src/api';

type CardDef = {
  id: string;
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  variant: 'primary' | 'secondary';
  route: string;
  testID: string;
};

const CARDS: CardDef[] = [
  {
    id: 'sol-desc',
    title: 'Solicitar Descida',
    subtitle: 'Agendar lançamento da lancha',
    icon: 'boat-outline',
    variant: 'primary',
    route: '/descida',
    testID: 'card-solicitar-descida',
  },
  {
    id: 'sol-sub',
    title: 'Solicitar Subida',
    subtitle: 'Agendar retorno da lancha',
    icon: 'arrow-up-circle-outline',
    variant: 'primary',
    route: '/subida',
    testID: 'card-solicitar-subida',
  },
  {
    id: 'alt-desc',
    title: 'Alterar Descida',
    subtitle: 'Editar solicitações do dia',
    icon: 'create-outline',
    variant: 'secondary',
    route: '/alterar?type=descida',
    testID: 'card-alterar-descida',
  },
  {
    id: 'alt-sub',
    title: 'Alterar Subida',
    subtitle: 'Editar solicitações do dia',
    icon: 'time-outline',
    variant: 'secondary',
    route: '/alterar?type=subida',
    testID: 'card-alterar-subida',
  },
];

export default function HomeScreen() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const loadUser = useCallback(async () => {
    const raw = await AsyncStorage.getItem('user');
    if (!raw) {
      router.replace('/');
      return;
    }
    setUser(JSON.parse(raw));
    setLoading(false);
  }, [router]);

  useFocusEffect(
    useCallback(() => {
      loadUser();
    }, [loadUser])
  );

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  if (loading || !user) {
    return (
      <View style={[styles.root, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color={colors.brandPrimary} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header} testID="home-header">
        <Pressable onPress={() => router.back()} hitSlop={12} testID="home-back" style={[styles.logoutBtn, { marginRight: spacing.md }]}>
          <Ionicons name="chevron-back" size={22} color={colors.onBrandPrimary} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>DESCIDA / SUBIDA</Text>
          <Text style={styles.name} testID="home-user-name">Olá, {user.name.split(' ')[0]}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionTitle}>O que deseja fazer?</Text>
        <Text style={styles.sectionSubtitle}>
          Selecione uma das opções abaixo
        </Text>

        <View style={styles.grid}>
          {CARDS.map((c) => {
            const isPrimary = c.variant === 'primary';
            return (
              <Pressable
                key={c.id}
                testID={c.testID}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push(c.route as any);
                }}
                style={({ pressed }) => [
                  styles.card,
                  pressed && { transform: [{ scale: 0.98 }] },
                ]}
              >
                <View
                  style={[
                    styles.iconWrap,
                    { backgroundColor: isPrimary ? colors.brandPrimary : colors.brandTertiary },
                  ]}
                >
                  <Ionicons
                    name={c.icon}
                    size={26}
                    color={isPrimary ? colors.onBrandPrimary : colors.brandSecondary}
                  />
                </View>
                <Text style={styles.cardTitle}>{c.title}</Text>
                <Text style={styles.cardSubtitle}>{c.subtitle}</Text>
                <View style={styles.cardArrow}>
                  <Ionicons name="arrow-forward" size={16} color={colors.onSurfaceSecondary} />
                </View>
              </Pressable>
            );
          })}
        </View>

        <Pressable
          testID="card-historico"
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push('/historico');
          }}
          style={({ pressed }) => [styles.historyRow, pressed && { opacity: 0.9 }]}
        >
          <View style={styles.historyIcon}>
            <Ionicons name="albums-outline" size={22} color={colors.brandPrimary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.historyTitle}>Histórico</Text>
            <Text style={styles.historySubtitle}>Ver todas as suas solicitações</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.onSurfaceTertiary} />
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.brandPrimary },
  header: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
  },
  kicker: {
    color: colors.brandSecondary,
    letterSpacing: 3,
    fontSize: 11,
    fontWeight: '700',
  },
  name: {
    color: colors.onBrandPrimary,
    fontSize: 28,
    fontWeight: '800',
    marginTop: 4,
  },
  boatRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.xs, gap: spacing.xs },
  boatText: { color: colors.onBrandPrimary, opacity: 0.85, fontSize: typography.base },
  logoutBtn: {
    padding: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  content: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.xl,
    paddingBottom: spacing.xxxl,
    minHeight: '100%',
  },
  sectionTitle: {
    color: colors.onSurface,
    fontSize: typography.xxl,
    fontWeight: '800',
  },
  sectionSubtitle: {
    color: colors.onSurfaceSecondary,
    fontSize: typography.base,
    marginTop: spacing.xs,
    marginBottom: spacing.xl,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  card: {
    width: '48%',
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.lg,
    minHeight: 170,
    borderWidth: 1,
    borderColor: colors.border,
  },
  iconWrap: {
    width: 46,
    height: 46,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  cardTitle: {
    color: colors.onSurface,
    fontSize: typography.lg,
    fontWeight: '700',
  },
  cardSubtitle: {
    color: colors.onSurfaceSecondary,
    fontSize: typography.sm,
    marginTop: spacing.xs,
  },
  cardArrow: {
    position: 'absolute',
    right: spacing.md,
    bottom: spacing.md,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.lg,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  historyIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.brandTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyTitle: { color: colors.onSurface, fontSize: typography.lg, fontWeight: '700' },
  historySubtitle: { color: colors.onSurfaceSecondary, fontSize: typography.sm, marginTop: 2 },
});
