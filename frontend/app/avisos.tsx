import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors, spacing, radius, typography } from '@/src/theme';
import { api } from '@/src/api';
import type { AppNotification, User } from '@/src/api';

const fmt = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function iconFor(kind: string): keyof typeof Ionicons.glyphMap {
  if (kind === 'descida') return 'boat';
  if (kind === 'subida') return 'arrow-up-circle';
  if (kind === 'fatura') return 'receipt';
  if (kind === 'encomenda') return 'cube';
  return 'notifications';
}
function colorFor(kind: string): string {
  if (kind === 'descida') return colors.brandPrimary;
  if (kind === 'subida') return colors.success;
  if (kind === 'fatura') return colors.brandSecondary;
  if (kind === 'encomenda') return '#0E7490';
  return colors.brandSecondary;
}

export default function AvisosScreen() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const raw = await AsyncStorage.getItem('user');
    if (!raw) return router.replace('/');
    const u: User = JSON.parse(raw);
    setUser(u);
    try {
      const data = await api.listNotifications(u.cpf);
      setItems(data);
      // marca todos como lidos ao abrir a tela
      if (data.some((n) => !n.read)) {
        api.readAllNotifications(u.cpf).catch(() => {});
      }
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [router]);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']} testID="avisos-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={16} testID="back-button">
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Avisos</Text>
          <Text style={styles.subtitle}>Atualizações da sua lancha</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <View style={styles.emptyIcon}>
            <Ionicons name="notifications-off-outline" size={44} color={colors.brandSecondary} />
          </View>
          <Text style={styles.emptyTitle}>Nenhum aviso ainda</Text>
          <Text style={styles.emptySubtitle}>Você será avisado quando sua lancha for para a água ou voltar ao seco.</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(n) => n.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
          renderItem={({ item }) => {
            const openable = item.kind === 'fatura' && !!item.ref_id;
            const Wrapper = openable ? Pressable : View;
            return (
              <Wrapper
                style={[styles.card, !item.read && styles.cardUnread]}
                testID={`aviso-${item.id}`}
                {...(openable ? { onPress: () => router.push({ pathname: '/fatura', params: { openId: item.ref_id! } }) } : {})}
              >
                <View style={[styles.iconWrap, { backgroundColor: colorFor(item.kind) }]}>
                  <Ionicons name={iconFor(item.kind)} size={22} color="#FFFFFF" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{item.title}</Text>
                  <Text style={styles.cardBody}>{item.body}</Text>
                  <Text style={styles.cardTime}>{fmt(item.created_at)}</Text>
                </View>
                {openable ? <Ionicons name="document-text-outline" size={20} color={colors.brandPrimary} /> : null}
              </Wrapper>
            );
          }}
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  emptyIcon: { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg },
  emptyTitle: { color: colors.onSurface, fontSize: typography.xl, fontWeight: '700' },
  emptySubtitle: { color: colors.onSurfaceSecondary, fontSize: typography.base, marginTop: spacing.sm, textAlign: 'center' },
  list: { padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.md },
  card: { flexDirection: 'row', gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.border },
  cardUnread: { borderColor: colors.brandPrimary, borderWidth: 1.5, backgroundColor: colors.brandTertiary },
  iconWrap: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { color: colors.onSurface, fontSize: typography.lg, fontWeight: '800' },
  cardBody: { color: colors.onSurfaceSecondary, fontSize: typography.base, marginTop: 2, lineHeight: 20 },
  cardTime: { color: colors.onSurfaceTertiary, fontSize: typography.sm, marginTop: spacing.xs },
});
