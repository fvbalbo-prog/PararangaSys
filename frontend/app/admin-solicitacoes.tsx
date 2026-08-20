import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, spacing, radius, typography } from '@/src/theme';
import { api, isAuthValidOn, authValidityLabel } from '@/src/api';
import type { Authorization } from '@/src/api';

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

export default function AdminSolicitacoesScreen() {
  const router = useRouter();
  const [authScope, setAuthScope] = useState<'hoje' | 'todas'>('hoje');
  const [auths, setAuths] = useState<Authorization[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setAuths(await api.listAuthorizations());
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
  const visibleAuths =
    authScope === 'hoje'
      ? auths.filter((a) => a.status === 'ativa' && isAuthValidOn(a, todayISO))
      : auths;

  const cancelAuth = async (id: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    setAuths((prev) => prev.map((a) => (a.id === id ? { ...a, status: 'cancelada' } : a)));
    try { await api.cancelAuthorization(id); } catch { load(); }
  };
  const checkinAuth = async (id: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const nowIso = new Date().toISOString();
    setAuths((prev) => prev.map((a) => (a.id === id ? { ...a, entered_at: nowIso } : a)));
    try { await api.checkinAuthorization(id); } catch { load(); }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={16} testID="back-button" style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.onBrandPrimary} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>MARINA</Text>
          <Text style={styles.title} testID="solicitacoes-title">Autorizações</Text>
        </View>
      </View>

      <View style={styles.sheet}>
        {loading ? (
          <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
        ) : (
          <FlatList
            data={visibleAuths}
            keyExtractor={(a) => a.id}
            contentContainerStyle={styles.list}
            ListHeaderComponent={
              <View style={styles.scopeRow}>
                {(['hoje', 'todas'] as const).map((s) => (
                  <Pressable
                    key={s}
                    testID={`auth-scope-${s}`}
                    onPress={() => { setAuthScope(s); Haptics.selectionAsync(); }}
                    style={[styles.scopeBtn, authScope === s && styles.scopeBtnActive]}
                  >
                    <Text style={[styles.scopeText, authScope === s && styles.scopeTextActive]}>
                      {s === 'hoje' ? 'Válidas hoje' : 'Todas'}
                    </Text>
                  </Pressable>
                ))}
              </View>
            }
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
            ListEmptyComponent={<Text style={styles.empty}>{authScope === 'hoje' ? 'Nenhuma autorização válida para hoje.' : 'Nenhuma autorização.'}</Text>}
            renderItem={({ item }) => (
              <View style={styles.card} testID={`auth-${item.id}`}>
                <View style={styles.cardTop}>
                  <Text style={styles.cardName}>{item.person_name}</Text>
                  <Text style={styles.cardMeta}>{authValidityLabel(item)}</Text>
                </View>
                <Text style={styles.cardMeta}>Lancha: {item.boat_name} • Titular: {item.user_name}</Text>
                <Text style={styles.cardMeta}>Descer a lancha: {item.can_lower ? 'Sim' : 'Não'}{item.service ? ` • Serviço: ${item.service}` : ''}</Text>
                {item.entered_at ? (
                  <View style={styles.enteredTag}>
                    <Ionicons name="log-in-outline" size={14} color={colors.success} />
                    <Text style={styles.enteredText}>Entrou às {fmtTime(item.entered_at)}</Text>
                  </View>
                ) : null}
                {item.status === 'ativa' ? (
                  <View style={styles.actions}>
                    {!item.entered_at ? (
                      <Pressable testID={`auth-checkin-${item.id}`} onPress={() => checkinAuth(item.id)} style={[styles.actionBtn, { borderRightWidth: 1, borderRightColor: colors.border }]}>
                        <Ionicons name="log-in-outline" size={16} color={colors.success} />
                        <Text style={[styles.actionText, { color: colors.success }]}>Registrar entrada</Text>
                      </Pressable>
                    ) : null}
                    <Pressable testID={`auth-cancel-${item.id}`} onPress={() => cancelAuth(item.id)} style={styles.actionBtn}>
                      <Ionicons name="close-circle-outline" size={16} color={colors.error} />
                      <Text style={[styles.actionText, { color: colors.error }]}>Cancelar</Text>
                    </Pressable>
                  </View>
                ) : (
                  <View style={[styles.statusTag, { backgroundColor: colors.surfaceTertiary }]}>
                    <Text style={[styles.statusTagText, { color: colors.onSurfaceTertiary }]}>Cancelada</Text>
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.md },
  empty: { color: colors.onSurfaceSecondary, fontSize: typography.base, textAlign: 'center', marginTop: spacing.xxl },
  enteredTag: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: spacing.sm },
  enteredText: { color: colors.success, fontSize: typography.sm, fontWeight: '700' },
  scopeRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  scopeBtn: { flex: 1, paddingVertical: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, alignItems: 'center', backgroundColor: colors.surface },
  scopeBtnActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  scopeText: { color: colors.onSurfaceSecondary, fontSize: typography.sm, fontWeight: '700' },
  scopeTextActive: { color: colors.onBrandPrimary },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs },
  cardName: { color: colors.onSurface, fontSize: typography.lg, fontWeight: '800' },
  cardMeta: { color: colors.onSurfaceSecondary, fontSize: typography.base, marginTop: 2 },
  actions: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.border, marginTop: spacing.md },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingVertical: spacing.md },
  actionText: { fontSize: typography.base, fontWeight: '700' },
  statusTag: { alignSelf: 'flex-start', paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.pill, marginTop: spacing.sm },
  statusTagText: { color: '#FFFFFF', fontSize: typography.sm, fontWeight: '700' },
});
