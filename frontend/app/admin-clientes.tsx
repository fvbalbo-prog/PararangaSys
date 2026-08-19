import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, spacing, radius, typography } from '@/src/theme';
import { api } from '@/src/api';
import type { Client } from '@/src/api';

export default function CadastrosScreen() {
  const router = useRouter();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setClients(await api.listUsers());
    } catch {
      setClients([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  const active = clients.filter((c) => (c as any).active !== false);
  const numClientes = active.filter((c) => !c.is_staff).length;
  const numFuncionarios = active.filter((c) => c.is_staff).length;
  const numLanchas = clients.filter((c) => !c.is_staff).reduce((s, c) => s + (c.boats?.length || 0), 0);

  const go = (path: string) => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(path); };

  const MENU: { key: string; title: string; subtitle: string; icon: keyof typeof Ionicons.glyphMap; color: string; route: string; count: number }[] = [
    { key: 'clientes', title: 'Clientes', subtitle: 'Cadastrar e gerenciar clientes', icon: 'people', color: colors.brandPrimary, route: '/admin-cad-clientes', count: numClientes },
    { key: 'lanchas', title: 'Lanchas', subtitle: 'Embarcações de cada cliente', icon: 'boat', color: '#0E7490', route: '/admin-cad-lanchas', count: numLanchas },
    { key: 'funcionarios', title: 'Funcionários', subtitle: 'Equipe com acesso ao painel', icon: 'briefcase', color: '#4D7C0F', route: '/admin-cad-funcionarios', count: numFuncionarios },
  ];

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="cadastros-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={16} testID="back-button">
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} testID="cadastros-title">Cadastros</Text>
          <Text style={styles.subtitle}>Clientes, lanchas e funcionários</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
      >
        {loading ? (
          <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
        ) : (
          MENU.map((m) => (
            <Pressable
              key={m.key}
              testID={`cadastros-menu-${m.key}`}
              onPress={() => go(m.route)}
              style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}
            >
              <View style={[styles.icon, { backgroundColor: m.color }]}>
                <Ionicons name={m.icon} size={24} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{m.title}</Text>
                <Text style={styles.cardSub}>{m.subtitle}</Text>
              </View>
              <View style={styles.countPill}>
                <Text style={styles.countText}>{m.count}</Text>
              </View>
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
  content: { padding: spacing.lg, gap: spacing.md },
  center: { paddingVertical: spacing.xxxl, alignItems: 'center', justifyContent: 'center' },
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
  icon: { width: 52, height: 52, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { color: colors.onSurface, fontSize: typography.lg, fontWeight: '800' },
  cardSub: { color: colors.onSurfaceSecondary, fontSize: typography.sm, marginTop: 2 },
  countPill: { backgroundColor: colors.brandTertiary, borderRadius: radius.pill, minWidth: 28, height: 24, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' },
  countText: { color: colors.brandPrimary, fontSize: typography.sm, fontWeight: '800' },
});
