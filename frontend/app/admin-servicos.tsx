import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, FlatList, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, spacing, radius, typography } from '@/src/theme';
import { api, SERVICO_LABELS } from '@/src/api';
import type { Servico, ServicoStatus } from '@/src/api';

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function brDate(iso?: string | null) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

const STATUS_META: Record<ServicoStatus, { label: string; bg: string; fg: string }> = {
  pendente: { label: 'Pendente', bg: '#DBEAFE', fg: '#1E3A8A' },
  em_andamento: { label: 'Em andamento', bg: '#FEF3C7', fg: '#B45309' },
  concluido: { label: 'Concluído', bg: '#DCFCE7', fg: colors.success },
  cancelado: { label: 'Cancelado', bg: colors.surfaceTertiary, fg: colors.onSurfaceTertiary },
};

const STATUS_FILTERS: { key: ServicoStatus | 'todos'; label: string }[] = [
  { key: 'todos', label: 'Todos' },
  { key: 'pendente', label: 'Pendentes' },
  { key: 'em_andamento', label: 'Em andamento' },
  { key: 'concluido', label: 'Concluídos' },
  { key: 'cancelado', label: 'Cancelados' },
];

export default function AdminServicosScreen() {
  const router = useRouter();
  const [servicos, setServicos] = useState<Servico[]>([]);
  const [statusFilter, setStatusFilter] = useState<ServicoStatus | 'todos'>('todos');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setServicos(await api.listServicos());
    } catch {
      setServicos([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
      const interval = setInterval(load, 20000);
      return () => clearInterval(interval);
    }, [load])
  );

  const filtered = useMemo(
    () => (statusFilter === 'todos' ? servicos : servicos.filter((s) => s.status === statusFilter)),
    [servicos, statusFilter]
  );
  const pendingCount = servicos.filter((s) => s.status === 'pendente').length;

  const setStatus = async (id: string, status: ServicoStatus) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setServicos((prev) => prev.map((s) => (s.id === id ? { ...s, status } : s)));
    try { await api.setServicoStatus(id, status); } catch { load(); }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="admin-servicos-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={16} testID="back-button">
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} testID="admin-servicos-title">Serviços</Text>
          <Text style={styles.subtitle}>{pendingCount > 0 ? `${pendingCount} pendente(s)` : 'Lavagem, marinheiro e abastecimento'}</Text>
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow} style={styles.chipScroller}>
        {STATUS_FILTERS.map((f) => {
          const active = statusFilter === f.key;
          return (
            <Pressable key={f.key} testID={`servico-filter-${f.key}`} onPress={() => { setStatusFilter(f.key); Haptics.selectionAsync(); }} style={[styles.chip, active && styles.chipActive]}>
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{f.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
      ) : filtered.length === 0 ? (
        <View style={styles.center}>
          <View style={styles.emptyIcon}><Ionicons name="construct-outline" size={44} color={colors.brandSecondary} /></View>
          <Text style={styles.emptyTitle}>Nenhuma solicitação</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(s) => s.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
          renderItem={({ item }) => {
            const meta = STATUS_META[item.status];
            return (
              <View style={styles.card} testID={`admin-servico-${item.id}`}>
                <View style={styles.cardTop}>
                  <Text style={styles.cardTitle}>{SERVICO_LABELS[item.type]}</Text>
                  <View style={[styles.statusBadge, { backgroundColor: meta.bg }]}>
                    <Text style={[styles.statusText, { color: meta.fg }]}>{meta.label}</Text>
                  </View>
                </View>
                <Text style={styles.cardMeta}>{item.user_name}{item.boat_name ? ` • ${item.boat_name}` : ''}</Text>
                <Text style={styles.cardMeta}>Solicitado em {formatDateTime(item.created_at)}</Text>
                {item.desired_date ? <Text style={styles.cardMeta}>Desejado: {brDate(item.desired_date)}{item.desired_time ? ` às ${item.desired_time}` : ''}</Text> : null}
                {item.observation ? <Text style={styles.cardMeta}>{item.observation}</Text> : null}

                {item.status === 'pendente' || item.status === 'em_andamento' ? (
                  <View style={styles.actions}>
                    {item.status === 'pendente' ? (
                      <Pressable testID={`servico-start-${item.id}`} onPress={() => setStatus(item.id, 'em_andamento')} style={[styles.actionBtn, { borderRightWidth: 1, borderRightColor: colors.border }]}>
                        <Ionicons name="play-outline" size={16} color="#B45309" />
                        <Text style={[styles.actionText, { color: '#B45309' }]}>Iniciar</Text>
                      </Pressable>
                    ) : null}
                    {item.status === 'em_andamento' ? (
                      <Pressable testID={`servico-complete-${item.id}`} onPress={() => setStatus(item.id, 'concluido')} style={[styles.actionBtn, { borderRightWidth: 1, borderRightColor: colors.border }]}>
                        <Ionicons name="checkmark-done-outline" size={16} color={colors.success} />
                        <Text style={[styles.actionText, { color: colors.success }]}>Concluir</Text>
                      </Pressable>
                    ) : null}
                    <Pressable testID={`servico-cancel-${item.id}`} onPress={() => setStatus(item.id, 'cancelado')} style={styles.actionBtn}>
                      <Ionicons name="close-circle-outline" size={16} color={colors.error} />
                      <Text style={[styles.actionText, { color: colors.error }]}>Cancelar</Text>
                    </Pressable>
                  </View>
                ) : null}
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
  header: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg, gap: spacing.md },
  title: { color: colors.onSurface, fontSize: typography.xxl, fontWeight: '800' },
  subtitle: { color: colors.onSurfaceSecondary, fontSize: typography.sm, marginTop: 2 },
  chipScroller: { maxHeight: 56, flexGrow: 0 },
  chipRow: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  chip: { height: 36, paddingHorizontal: spacing.lg, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontSize: typography.base, fontWeight: '600' },
  chipTextActive: { color: colors.onBrandPrimary },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyIcon: { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg },
  emptyTitle: { color: colors.onSurface, fontSize: typography.lg, fontWeight: '700' },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.md },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs },
  cardTitle: { color: colors.onSurface, fontSize: typography.lg, fontWeight: '800' },
  cardMeta: { color: colors.onSurfaceSecondary, fontSize: typography.base, marginTop: 2 },
  statusBadge: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill },
  statusText: { fontSize: 11, fontWeight: '700' },
  actions: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.border, marginTop: spacing.md },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingVertical: spacing.md },
  actionText: { fontSize: typography.base, fontWeight: '700' },
});
