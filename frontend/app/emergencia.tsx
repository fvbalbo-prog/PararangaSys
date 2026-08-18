import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Pressable,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { colors, spacing, radius, typography } from '@/src/theme';
import { api, boatName } from '@/src/api';
import type { User, Emergency } from '@/src/api';

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function EmergenciaScreen() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [location, setLocation] = useState('');
  const [observation, setObservation] = useState('');
  const [list, setList] = useState<Emergency[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const loadList = useCallback(async (cpf: string) => {
    try {
      setList(await api.listEmergencies(cpf));
    } catch {
      setList([]);
    }
  }, []);

  const boot = useCallback(async () => {
    const raw = await AsyncStorage.getItem('user');
    if (!raw) return router.replace('/');
    const u: User = JSON.parse(raw);
    setUser(u);
    await loadList(u.cpf);
    setLoading(false);
  }, [router, loadList]);

  useEffect(() => {
    boot();
  }, [boot]);

  useFocusEffect(
    useCallback(() => {
      if (user) loadList(user.cpf);
    }, [user, loadList])
  );

  const dispatch = async () => {
    if (!user) return;
    const firstBoat = user.boats && user.boats.length ? boatName(user.boats[0]) : user.boat_name;
    try {
      setSending(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      await api.createEmergency({
        cpf: user.cpf,
        boat_name: firstBoat,
        location: location.trim() || null,
        observation: observation.trim() || null,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setLocation('');
      setObservation('');
      await loadList(user.cpf);
      Alert.alert('Emergência enviada', 'A equipe da marina foi notificada e entrará em contato.');
    } catch (e: any) {
      Alert.alert('Erro', e.message || 'Não foi possível enviar a emergência.');
    } finally {
      setSending(false);
    }
  };

  const confirmDispatch = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    Alert.alert(
      'Acionar emergência?',
      'A equipe da marina será notificada imediatamente com seus dados e da sua lancha.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Acionar', style: 'destructive', onPress: dispatch },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']} testID="emergencia-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={16} testID="back-button">
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Emergência</Text>
          <Text style={styles.subtitle}>Acione a equipe da marina</Text>
        </View>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={20}>
        {loading ? (
          <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
        ) : (
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Pressable
              testID="emergencia-button"
              onPress={confirmDispatch}
              disabled={sending}
              style={({ pressed }) => [styles.sosButton, pressed && { opacity: 0.9 }]}
            >
              {sending ? (
                <ActivityIndicator color="#FFFFFF" size="large" />
              ) : (
                <>
                  <Ionicons name="alert-circle" size={56} color="#FFFFFF" />
                  <Text style={styles.sosText}>ACIONAR EMERGÊNCIA</Text>
                  <Text style={styles.sosSub}>Toque para notificar a marina</Text>
                </>
              )}
            </Pressable>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Localização (opcional)</Text>
              <TextInput
                testID="emergencia-location"
                style={styles.input}
                value={location}
                onChangeText={setLocation}
                placeholder="Ex.: Próximo à Ilha do Campeche"
                placeholderTextColor={colors.onSurfaceTertiary}
              />
            </View>
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Descrição (opcional)</Text>
              <TextInput
                testID="emergencia-observation"
                style={[styles.input, styles.textarea]}
                value={observation}
                onChangeText={setObservation}
                placeholder="O que está acontecendo?"
                placeholderTextColor={colors.onSurfaceTertiary}
                multiline
                textAlignVertical="top"
              />
            </View>

            {list.length > 0 ? (
              <>
                <Text style={styles.sectionLabel}>Meus acionamentos</Text>
                {list.map((e) => (
                  <View key={e.id} style={styles.card} testID={`emergency-${e.id}`}>
                    <View style={[styles.dot, { backgroundColor: e.status === 'aberta' ? colors.error : colors.success }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cardTitle}>{e.status === 'aberta' ? 'Em atendimento' : 'Atendida'}</Text>
                      <Text style={styles.cardMeta}>{formatDateTime(e.created_at)}{e.location ? ` • ${e.location}` : ''}</Text>
                      {e.observation ? <Text style={styles.cardMeta}>{e.observation}</Text> : null}
                    </View>
                  </View>
                ))}
              </>
            ) : null}
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg, gap: spacing.md },
  title: { color: colors.onSurface, fontSize: typography.xxl, fontWeight: '800' },
  subtitle: { color: colors.onSurfaceSecondary, fontSize: typography.sm, marginTop: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.lg, paddingBottom: 120 },
  sosButton: { backgroundColor: colors.error, borderRadius: radius.lg, paddingVertical: spacing.xxl, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xl, minHeight: 200 },
  sosText: { color: '#FFFFFF', fontSize: typography.xl, fontWeight: '800', marginTop: spacing.md, letterSpacing: 1 },
  sosSub: { color: '#FFFFFF', opacity: 0.85, fontSize: typography.base, marginTop: spacing.xs },
  fieldGroup: { marginBottom: spacing.lg },
  label: { color: colors.onSurface, fontSize: typography.base, fontWeight: '600', marginBottom: spacing.sm },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.lg, fontSize: typography.lg, color: colors.onSurface, backgroundColor: colors.surfaceSecondary },
  textarea: { minHeight: 90 },
  sectionLabel: { color: colors.brandPrimary, fontWeight: '700', fontSize: typography.sm, letterSpacing: 1, textTransform: 'uppercase', marginBottom: spacing.md, marginTop: spacing.sm },
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
  cardTitle: { color: colors.onSurface, fontSize: typography.lg, fontWeight: '700' },
  cardMeta: { color: colors.onSurfaceSecondary, fontSize: typography.sm, marginTop: 2 },
});
