import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, typography } from '@/src/theme';
import { api } from '@/src/api';
import type { MarinaRequest } from '@/src/api';
import { StatusBadge } from '@/src/components/StatusBadge';

function Section({ title, icon, data }: { title: string; icon: keyof typeof Ionicons.glyphMap; data: MarinaRequest[] }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Ionicons name={icon} size={18} color={colors.brandPrimary} />
        <Text style={styles.sectionTitle}>{title}</Text>
        <View style={styles.countPill}><Text style={styles.countText}>{data.length}</Text></View>
      </View>

      <View style={styles.tableHead}>
        <Text style={[styles.th, { flex: 1.6 }]}>Lancha</Text>
        <Text style={[styles.th, styles.colTime]}>Horário</Text>
        <Text style={[styles.th, styles.colStatus]}>Status</Text>
      </View>

      {data.length === 0 ? (
        <Text style={styles.empty}>Nenhuma solicitação.</Text>
      ) : (
        data.map((r, i) => (
          <View key={r.id} style={[styles.row, i % 2 === 1 && { backgroundColor: colors.surfaceSecondary }]} testID={`status-row-${r.id}`}>
            <View style={{ flex: 1.6 }}>
              <Text style={styles.boat} numberOfLines={1}>{r.boat_name}</Text>
              {r.observation ? <Text style={styles.obs} numberOfLines={2}>Obs.: {r.observation}</Text> : null}
            </View>
            <Text style={[styles.time, styles.colTime]}>{r.time}</Text>
            <View style={styles.colStatus}><StatusBadge status={r.status} /></View>
          </View>
        ))
      )}
    </View>
  );
}

export default function AdminStatusScreen() {
  const router = useRouter();
  const [items, setItems] = useState<MarinaRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.dayRequests();
      setItems(data);
    } catch {
      setItems([]);
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

  const byTime = (a: MarinaRequest, b: MarinaRequest) => a.time.localeCompare(b.time);
  const descidas = items.filter((i) => i.type === 'descida').sort(byTime);
  const subidas = items.filter((i) => i.type === 'subida').sort(byTime);

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={16} testID="back-button">
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} testID="status-title">Status das Lanchas</Text>
          <Text style={styles.subtitle}>Somente leitura • hoje</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
        >
          <Section title="Descidas solicitadas" icon="boat-outline" data={descidas} />
          <Section title="Subidas solicitadas" icon="arrow-up-circle-outline" data={subidas} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg, gap: spacing.md },
  title: { color: colors.onSurface, fontSize: typography.xxl, fontWeight: '800' },
  subtitle: { color: colors.onSurfaceSecondary, fontSize: typography.sm, marginTop: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.xl },
  section: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden' },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, backgroundColor: colors.brandTertiary },
  sectionTitle: { flex: 1, color: colors.brandPrimary, fontSize: typography.lg, fontWeight: '800' },
  countPill: { backgroundColor: colors.brandPrimary, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 2 },
  countText: { color: colors.onBrandPrimary, fontSize: typography.sm, fontWeight: '800' },
  tableHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.surfaceSecondary },
  th: { color: colors.onSurfaceSecondary, fontSize: typography.sm, fontWeight: '800' },
  colTime: { width: 64, textAlign: 'center' },
  colStatus: { width: 96, alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider },
  boat: { color: colors.onSurface, fontSize: typography.base, fontWeight: '700' },
  obs: { color: colors.onSurfaceSecondary, fontSize: typography.sm, marginTop: 2 },
  time: { color: colors.onSurface, fontSize: typography.lg, fontWeight: '800' },
  empty: { color: colors.onSurfaceTertiary, fontStyle: 'italic', padding: spacing.md },
});
