import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { colors, spacing, radius, typography } from '@/src/theme';
import { api, isAuthValidOn, authValidityLabel } from '@/src/api';
import type { Authorization } from '@/src/api';

function todayISO() {
  const d = new Date();
  const p = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

export default function StaffAutorizacoesScreen() {
  const router = useRouter();
  const [auths, setAuths] = useState<Authorization[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const raw = await AsyncStorage.getItem('user');
    if (!raw) return router.replace('/');
    try {
      const all = await api.listAuthorizations();
      const iso = todayISO();
      setAuths(all.filter((a) => a.status === 'ativa' && isAuthValidOn(a, iso)));
    } catch {
      setAuths([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [router]);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  const checkinAuth = async (id: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const nowIso = new Date().toISOString();
    setAuths((prev) => prev.map((a) => (a.id === id ? { ...a, entered_at: nowIso } : a)));
    try { await api.checkinAuthorization(id); } catch { load(); }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="staff-autorizacoes-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={16} testID="back-button" style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.onBrandPrimary} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>FUNCIONÁRIOS</Text>
          <Text style={styles.title} testID="autorizacoes-title">Pessoas Autorizadas</Text>
          <Text style={styles.sub}>Válidas hoje • toque em "Registrar entrada" quando a pessoa chegar</Text>
        </View>
      </View>

      <View style={styles.sheet}>
        {loading ? (
          <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
        ) : auths.length === 0 ? (
          <View style={styles.center}>
            <View style={styles.emptyIcon}><Ionicons name="shield-checkmark-outline" size={44} color={colors.brandSecondary} /></View>
            <Text style={styles.emptyTitle}>Nenhuma autorização hoje</Text>
          </View>
        ) : (
          <FlatList
            data={auths}
            keyExtractor={(a) => a.id}
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
            renderItem={({ item }) => (
              <View style={styles.card} testID={`staff-auth-${item.id}`}>
                <View style={styles.avatar}>
                  <Ionicons name="person" size={20} color={colors.brandPrimary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{item.person_name}</Text>
                  <Text style={styles.meta}>Lancha: {item.boat_name}</Text>
                  <Text style={styles.meta}>Cliente: {item.user_name}</Text>
                  <Text style={styles.meta}>Validade: {authValidityLabel(item)}</Text>
                  {item.service ? <Text style={styles.meta}>Serviço: {item.service}</Text> : null}
                  <View style={styles.tagsRow}>
                    <View style={[styles.tag, { backgroundColor: item.can_lower ? colors.brandTertiary : colors.surfaceTertiary }]}>
                      <Ionicons name={item.can_lower ? 'boat' : 'close'} size={12} color={item.can_lower ? colors.brandPrimary : colors.onSurfaceTertiary} />
                      <Text style={[styles.tagText, { color: item.can_lower ? colors.brandPrimary : colors.onSurfaceTertiary }]}>
                        {item.can_lower ? 'Pode descer a lancha' : 'Sem descida'}
                      </Text>
                    </View>
                    {item.entered_at ? (
                      <View style={[styles.tag, { backgroundColor: '#DCFCE7' }]}>
                        <Ionicons name="checkmark-circle" size={12} color={colors.success} />
                        <Text style={[styles.tagText, { color: colors.success }]}>Entrou às {fmtTime(item.entered_at)}</Text>
                      </View>
                    ) : null}
                  </View>
                  {!item.entered_at ? (
                    <Pressable
                      testID={`staff-auth-checkin-${item.id}`}
                      onPress={() => checkinAuth(item.id)}
                      style={({ pressed }) => [styles.checkinBtn, pressed && { opacity: 0.85 }]}
                    >
                      <Ionicons name="log-in-outline" size={16} color="#FFFFFF" />
                      <Text style={styles.checkinBtnText}>Registrar entrada</Text>
                    </Pressable>
                  ) : null}
                </View>
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
  title: { color: colors.onBrandPrimary, fontSize: 22, fontWeight: '800', marginTop: 4 },
  sub: { color: colors.onBrandPrimary, opacity: 0.8, fontSize: typography.sm, marginTop: 2 },
  sheet: { flex: 1, backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingTop: spacing.lg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  emptyIcon: { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg },
  emptyTitle: { color: colors.onSurface, fontSize: typography.xl, fontWeight: '700' },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.md },
  card: { flexDirection: 'row', gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  name: { color: colors.onSurface, fontSize: typography.lg, fontWeight: '800' },
  meta: { color: colors.onSurfaceSecondary, fontSize: typography.sm, marginTop: 2 },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill },
  tagText: { fontSize: typography.sm, fontWeight: '700' },
  checkinBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, backgroundColor: colors.success, borderRadius: radius.sm, paddingVertical: spacing.sm, marginTop: spacing.md },
  checkinBtnText: { color: '#FFFFFF', fontSize: typography.sm, fontWeight: '700' },
});
