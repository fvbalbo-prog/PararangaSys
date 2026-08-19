import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors, spacing, radius, typography } from '@/src/theme';
import { api } from '@/src/api';
import type { MarinaRequest, RequestType, User } from '@/src/api';

function todayISO() {
  const d = new Date();
  const p = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

type QueueEntry = {
  req: MarinaRequest;
  position: number; // 1-based
  ahead: number;
  total: number;
  mine: boolean;
};

export default function FilaScreen() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [descidaQueue, setDescidaQueue] = useState<QueueEntry[]>([]);
  const [subidaQueue, setSubidaQueue] = useState<QueueEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const buildQueue = (all: MarinaRequest[], type: RequestType, cpf: string): QueueEntry[] => {
    const pending = all
      .filter((r) => r.type === type && r.status === 'agendada')
      .sort((a, b) => (a.time === b.time ? a.created_at.localeCompare(b.created_at) : a.time.localeCompare(b.time)));
    const total = pending.length;
    return pending
      .map((req, idx) => ({ req, position: idx + 1, ahead: idx, total, mine: req.cpf === cpf }))
      .filter((e) => e.mine);
  };

  const load = useCallback(async () => {
    const raw = await AsyncStorage.getItem('user');
    if (!raw) return router.replace('/');
    const u: User = JSON.parse(raw);
    setUser(u);
    try {
      const all = await api.dayRequests(todayISO());
      setDescidaQueue(buildQueue(all, 'descida', u.cpf));
      setSubidaQueue(buildQueue(all, 'subida', u.cpf));
    } catch {
      setDescidaQueue([]);
      setSubidaQueue([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [router]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
      const interval = setInterval(load, 15000);
      return () => clearInterval(interval);
    }, [load])
  );

  const renderSection = (title: string, icon: keyof typeof Ionicons.glyphMap, entries: QueueEntry[], color: string) => (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <View style={[styles.sectionIcon, { backgroundColor: color }]}>
          <Ionicons name={icon} size={20} color="#FFFFFF" />
        </View>
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {entries.length === 0 ? (
        <Text style={styles.emptyLine}>Você não está na fila de {title.toLowerCase()} hoje.</Text>
      ) : (
        entries.map((e) => (
          <View key={e.req.id} style={styles.card} testID={`fila-${e.req.id}`}>
            <View style={[styles.posBadge, e.ahead === 0 && styles.posBadgeNext]}>
              <Text style={styles.posNumber}>{e.position}º</Text>
              <Text style={styles.posLabel}>na fila</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.boat}>{e.req.boat_name}</Text>
              <Text style={styles.meta}>Horário agendado: {e.req.time}</Text>
              {e.ahead === 0 ? (
                <View style={styles.nextTag}>
                  <Ionicons name="flag" size={13} color={colors.success} />
                  <Text style={styles.nextText}>Você é o próximo!</Text>
                </View>
              ) : (
                <Text style={styles.aheadText}>
                  {e.ahead} {e.ahead === 1 ? 'lancha na frente' : 'lanchas na frente'} • {e.total} no total
                </Text>
              )}
            </View>
          </View>
        ))
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']} testID="fila-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={16} testID="back-button">
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Fila em Tempo Real</Text>
          <Text style={styles.subtitle}>Sua posição na fila de hoje</Text>
        </View>
        <View style={styles.liveTag}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>AO VIVO</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
        >
          {descidaQueue.length === 0 && subidaQueue.length === 0 ? (
            <View style={styles.emptyBox}>
              <View style={styles.emptyIcon}>
                <Ionicons name="hourglass-outline" size={44} color={colors.brandSecondary} />
              </View>
              <Text style={styles.emptyTitle}>Sem solicitações na fila</Text>
              <Text style={styles.emptySubtitle}>Quando você agendar uma descida ou subida para hoje, sua posição aparecerá aqui.</Text>
            </View>
          ) : (
            <>
              {renderSection('Descida', 'boat', descidaQueue, colors.brandPrimary)}
              {renderSection('Subida', 'arrow-up-circle', subidaQueue, colors.success)}
              <Text style={styles.note}>A posição considera todas as lanchas aguardando, ordenadas pelo horário agendado. Atualiza automaticamente.</Text>
            </>
          )}
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
  liveTag: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#FEF2F2', paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.error },
  liveText: { color: colors.error, fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.xl },
  section: { gap: spacing.md },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sectionIcon: { width: 34, height: 34, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { color: colors.onSurface, fontSize: typography.xl, fontWeight: '800' },
  emptyLine: { color: colors.onSurfaceSecondary, fontSize: typography.base },
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.border },
  posBadge: { width: 60, height: 60, borderRadius: radius.md, backgroundColor: colors.brandPrimary, alignItems: 'center', justifyContent: 'center' },
  posBadgeNext: { backgroundColor: colors.success },
  posNumber: { color: '#FFFFFF', fontSize: typography.xl, fontWeight: '800' },
  posLabel: { color: '#FFFFFF', opacity: 0.85, fontSize: 10, fontWeight: '700' },
  boat: { color: colors.onSurface, fontSize: typography.lg, fontWeight: '800' },
  meta: { color: colors.onSurfaceSecondary, fontSize: typography.sm, marginTop: 2 },
  aheadText: { color: colors.onSurfaceSecondary, fontSize: typography.base, fontWeight: '600', marginTop: spacing.xs },
  nextTag: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: spacing.xs },
  nextText: { color: colors.success, fontSize: typography.base, fontWeight: '800' },
  note: { color: colors.onSurfaceTertiary, fontSize: typography.sm, textAlign: 'center', marginTop: spacing.sm },
  emptyBox: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xxxl },
  emptyIcon: { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg },
  emptyTitle: { color: colors.onSurface, fontSize: typography.xl, fontWeight: '700' },
  emptySubtitle: { color: colors.onSurfaceSecondary, fontSize: typography.base, marginTop: spacing.sm, textAlign: 'center', paddingHorizontal: spacing.lg },
});
