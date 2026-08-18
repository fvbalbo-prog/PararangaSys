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
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, spacing, radius, typography } from '@/src/theme';
import { api } from '@/src/api';
import type { MarinaRequest, RequestType } from '@/src/api';
import { StatusBadge } from '@/src/components/StatusBadge';

export default function AlterarScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ type?: string }>();
  const type: RequestType = params.type === 'subida' ? 'subida' : 'descida';

  const [items, setItems] = useState<MarinaRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await api.todayRequests(type);
      setItems(data);
    } catch (e: any) {
      setError(e.message || 'Erro ao carregar.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [type]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
    }, [load])
  );

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const goEdit = (item: MarinaRequest) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const path = item.type === 'descida' ? '/descida' : '/subida';
    router.push({ pathname: path, params: { id: item.id } } as any);
  };

  const doCancel = async (id: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    setItems((prev) => prev.map((r) => (r.id === id ? { ...r, status: 'cancelada' } : r)));
    try {
      await api.cancelRequest(id);
    } catch {
      load();
    }
  };

  const title = type === 'descida' ? 'Alterar Descida' : 'Alterar Subida';

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={16} testID="back-button">
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} testID="alterar-title">{title}</Text>
          <Text style={styles.subtitle}>Solicitações de hoje</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.brandPrimary} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={48} color={colors.error} />
          <Text style={styles.errorText}>{error}</Text>
          <Pressable style={styles.retryBtn} onPress={load}>
            <Text style={styles.retryText}>Tentar novamente</Text>
          </Pressable>
        </View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <View style={styles.emptyIcon}>
            <Ionicons name="compass-outline" size={48} color={colors.brandSecondary} />
          </View>
          <Text style={styles.emptyTitle}>Nenhuma solicitação para hoje</Text>
          <Text style={styles.emptySubtitle}>
            {type === 'descida'
              ? 'Ainda não há descidas agendadas para hoje.'
              : 'Ainda não há subidas agendadas para hoje.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brandPrimary} />}
          renderItem={({ item }) => {
            const isActive = item.status === 'agendada';
            return (
              <View style={styles.card} testID={`request-row-${item.id}`}>
                <Pressable
                  style={({ pressed }) => [styles.row, pressed && isActive && { opacity: 0.9 }]}
                  onPress={() => isActive && goEdit(item)}
                  disabled={!isActive}
                >
                  <View style={[styles.timeBlock, !isActive && { backgroundColor: colors.onSurfaceTertiary }]}>
                    <Text style={styles.timeText}>{item.time}</Text>
                    <Text style={styles.timeLabel}>{item.type === 'descida' ? 'DESCIDA' : 'SUBIDA'}</Text>
                  </View>
                  <View style={styles.rowBody}>
                    <View style={styles.rowTop}>
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {item.user_name || 'Solicitante'} • {item.boat_name || ''}
                      </Text>
                    </View>
                    {item.type === 'descida' ? (
                      <View style={{ marginTop: 2 }}>
                        <Text style={styles.rowMeta} numberOfLines={1}>
                          <Ionicons name="location-outline" size={12} color={colors.onSurfaceSecondary} />{' '}
                          {item.destination || '—'}
                        </Text>
                        <Text style={styles.rowMeta}>
                          <Ionicons name="people-outline" size={12} color={colors.onSurfaceSecondary} />{' '}
                          {item.passengers} passageiros • Ret. {item.expected_return_time}
                        </Text>
                      </View>
                    ) : (
                      <Text style={styles.rowMeta}>Retorno agendado</Text>
                    )}
                    <View style={{ marginTop: spacing.sm }}>
                      <StatusBadge status={item.status} />
                    </View>
                  </View>
                  {isActive && <Ionicons name="chevron-forward" size={20} color={colors.onSurfaceTertiary} />}
                </Pressable>

                {isActive && (
                  <View style={styles.actions}>
                    <Pressable
                      testID={`cancel-request-${item.id}`}
                      style={({ pressed }) => [styles.actionBtn, styles.cancelBtn, pressed && { opacity: 0.85 }]}
                      onPress={() => doCancel(item.id)}
                    >
                      <Ionicons name="close-circle-outline" size={16} color={colors.error} />
                      <Text style={[styles.actionText, { color: colors.error }]}>Cancelar solicitação</Text>
                    </Pressable>
                  </View>
                )}
                {item.status === 'concluida' && item.returned_at && (
                  <Text style={styles.returnedText}>
                    Retorno confirmado às {new Date(item.returned_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                )}
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    gap: spacing.md,
  },
  title: { color: colors.onSurface, fontSize: typography.xxl, fontWeight: '800' },
  subtitle: { color: colors.onSurfaceSecondary, fontSize: typography.sm, marginTop: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  errorText: { color: colors.error, fontSize: typography.base, marginTop: spacing.md, textAlign: 'center' },
  retryBtn: {
    marginTop: spacing.lg,
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
  },
  retryText: { color: colors.onBrandPrimary, fontWeight: '700' },
  emptyIcon: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.brandTertiary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  emptyTitle: { color: colors.onSurface, fontSize: typography.xl, fontWeight: '700', textAlign: 'center' },
  emptySubtitle: {
    color: colors.onSurfaceSecondary,
    fontSize: typography.base,
    marginTop: spacing.sm,
    textAlign: 'center',
    lineHeight: 20,
  },
  list: { padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.md },
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.md,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  actions: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
  },
  confirmBtn: { borderRightWidth: 1, borderRightColor: colors.border },
  cancelBtn: {},
  actionText: { fontSize: typography.base, fontWeight: '700' },
  returnedText: {
    color: colors.success,
    fontSize: typography.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    fontWeight: '600',
  },
  timeBlock: {
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    alignItems: 'center',
    minWidth: 72,
  },
  timeText: { color: colors.onBrandPrimary, fontSize: typography.lg, fontWeight: '800' },
  timeLabel: { color: colors.brandSecondary, fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  rowBody: { flex: 1 },
  rowTitle: { color: colors.onSurface, fontSize: typography.base, fontWeight: '700' },
  rowMeta: { color: colors.onSurfaceSecondary, fontSize: typography.sm, marginTop: 2 },
});
