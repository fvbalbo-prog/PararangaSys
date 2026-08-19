import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radius, typography } from '@/src/theme';
import { api } from '@/src/api';
import type { MarinaRequest } from '@/src/api';
import { StatusBadge } from '@/src/components/StatusBadge';

// Paleta escura dedicada para melhor visualização em ambiente claro
const D = {
  bg: '#0B1B2B',
  card: '#12293F',
  cardAlt: '#0F2236',
  head: '#17324C',
  border: '#24425F',
  text: '#FFFFFF',
  sub: '#9FB3C8',
  accent: '#4FB0E6',
  danger: '#F87171',
};

function Section({
  title,
  icon,
  data,
  emergencyBoats,
}: {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  data: MarinaRequest[];
  emergencyBoats: Set<string>;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Ionicons name={icon} size={18} color={D.accent} />
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
        data.map((r, i) => {
          const hasEmergency = !!r.boat_name && emergencyBoats.has(r.boat_name);
          return (
            <View key={r.id} style={[styles.row, i % 2 === 1 && { backgroundColor: D.cardAlt }, hasEmergency && styles.rowAlert]} testID={`status-row-${r.id}`}>
              <View style={{ flex: 1.6 }}>
                <Text style={styles.boat} numberOfLines={1}>{r.boat_name}</Text>
                {hasEmergency ? (
                  <View style={styles.emgTag} testID={`status-emergency-${r.id}`}>
                    <Ionicons name="alert-circle" size={12} color="#FFFFFF" />
                    <Text style={styles.emgTagText}>EMERGÊNCIA</Text>
                  </View>
                ) : null}
                {r.observation ? <Text style={styles.obs} numberOfLines={2}>Obs.: {r.observation}</Text> : null}
              </View>
              <Text style={[styles.time, styles.colTime]}>{r.time}</Text>
              <View style={styles.colStatus}><StatusBadge status={r.status} /></View>
            </View>
          );
        })
      )}
    </View>
  );
}

export default function AdminStatusScreen() {
  const router = useRouter();
  const [items, setItems] = useState<MarinaRequest[]>([]);
  const [emergencyBoats, setEmergencyBoats] = useState<Set<string>>(new Set());
  const [openCount, setOpenCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [data, emgs] = await Promise.all([
        api.dayRequests(),
        api.listEmergencies(undefined, 'aberta').catch(() => []),
      ]);
      setItems(data);
      setEmergencyBoats(new Set(emgs.map((e) => e.boat_name).filter(Boolean) as string[]));
      setOpenCount(emgs.length);
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
      const interval = setInterval(load, 15000);
      return () => clearInterval(interval);
    }, [load])
  );

  const byTime = (a: MarinaRequest, b: MarinaRequest) => a.time.localeCompare(b.time);
  const descidas = items.filter((i) => i.type === 'descida').sort(byTime);
  const subidas = items.filter((i) => i.type === 'subida').sort(byTime);

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={16} testID="back-button">
          <Ionicons name="chevron-back" size={26} color={D.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} testID="status-title">Status das Lanchas</Text>
          <Text style={styles.subtitle}>Somente leitura • hoje</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={D.accent} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={D.accent} />}
        >
          {openCount > 0 ? (
            <View style={styles.alertBanner} testID="status-emergency-banner">
              <Ionicons name="alert-circle" size={22} color="#FFFFFF" />
              <Text style={styles.alertBannerText}>
                {openCount === 1 ? '1 emergência aberta' : `${openCount} emergências abertas`} — verifique as lanchas destacadas
              </Text>
            </View>
          ) : null}
          <Section title="Descidas solicitadas" icon="boat-outline" data={descidas} emergencyBoats={emergencyBoats} />
          <Section title="Subidas solicitadas" icon="arrow-up-circle-outline" data={subidas} emergencyBoats={emergencyBoats} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: D.bg },
  header: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg, gap: spacing.md },
  title: { color: D.text, fontSize: typography.xxl, fontWeight: '800' },
  subtitle: { color: D.sub, fontSize: typography.sm, marginTop: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.xl },
  alertBanner: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: D.danger, borderRadius: radius.md, padding: spacing.lg },
  alertBannerText: { color: '#FFFFFF', fontSize: typography.base, fontWeight: '700', flex: 1 },
  section: { borderWidth: 1, borderColor: D.border, borderRadius: radius.md, overflow: 'hidden', backgroundColor: D.card },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, backgroundColor: D.head },
  sectionTitle: { flex: 1, color: D.text, fontSize: typography.lg, fontWeight: '800' },
  countPill: { backgroundColor: D.accent, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 2 },
  countText: { color: '#04121F', fontSize: typography.sm, fontWeight: '800' },
  tableHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: D.cardAlt },
  th: { color: D.sub, fontSize: typography.sm, fontWeight: '800' },
  colTime: { width: 64, textAlign: 'center' },
  colStatus: { width: 96, alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.md, borderTopWidth: 1, borderTopColor: D.border },
  rowAlert: { backgroundColor: 'rgba(248,113,113,0.14)', borderLeftWidth: 3, borderLeftColor: D.danger },
  boat: { color: D.text, fontSize: typography.base, fontWeight: '700' },
  emgTag: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', backgroundColor: D.danger, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 2, marginTop: 4 },
  emgTagText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  obs: { color: D.sub, fontSize: typography.sm, marginTop: 2 },
  time: { color: D.text, fontSize: typography.lg, fontWeight: '800' },
  empty: { color: D.sub, fontStyle: 'italic', padding: spacing.md },
});
