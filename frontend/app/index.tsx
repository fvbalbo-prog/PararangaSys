import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { colors, spacing, radius, typography } from '@/src/theme';
import { api } from '@/src/api';

function formatCpf(value: string) {
  return value.replace(/\D/g, '').slice(0, 5);
}

export default function LoginScreen() {
  const router = useRouter();
  const [cpf, setCpf] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cpfFocused, setCpfFocused] = useState(false);
  const [phoneFocused, setPhoneFocused] = useState(false);

  const handleLogin = async () => {
    setError(null);
    const digits = cpf.replace(/\D/g, '');
    const phoneDigits = phone.replace(/\D/g, '');
    if (digits.length !== 5) {
      setError('Digite os 5 primeiros números do CPF.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    if (phoneDigits.length !== 4) {
      setError('Digite os 4 últimos números do celular.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    try {
      setLoading(true);
      const user = await api.login(digits, phoneDigits);
      await AsyncStorage.setItem('user', JSON.stringify(user));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace(user.is_admin ? '/admin' : user.is_staff ? '/staff' : '/menu');
    } catch (e: any) {
      setError(e.message || 'CPF ou celular não confere.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.root}
      testID="login-screen"
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" bounces={false}>
        <LinearGradient
          colors={['#0B2545', '#123A63', '#1B4E82']}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={styles.hero}
        >
          <View style={[styles.porthole, styles.portholeA]} />
          <View style={[styles.porthole, styles.portholeB]} />
          <View style={[styles.porthole, styles.portholeC]} />
          <Ionicons name="boat-outline" size={26} color="rgba(255,255,255,0.18)" style={styles.boatIcon} />
          <Ionicons name="compass-outline" size={34} color="rgba(197,160,89,0.22)" style={styles.compassIcon} />

          <View style={styles.logoWrap}>
            <Image
              source={require('../assets/images/logo-trans.png')}
              style={styles.logoOverlay}
              contentFit="contain"
              tintColor="#FFFFFF"
              testID="brand-logo"
            />
          </View>
          <View style={styles.taglineRow}>
            <View style={styles.taglineLine} />
            <Text style={styles.tagline}>MARINA & NÁUTICA</Text>
            <View style={styles.taglineLine} />
          </View>

          <View style={styles.waveRow}>
            <View style={[styles.waveDot, { opacity: 0.35 }]} />
            <View style={[styles.waveDot, { opacity: 0.6 }]} />
            <View style={[styles.waveDot, { opacity: 1 }]} />
            <View style={[styles.waveDot, { opacity: 0.6 }]} />
            <View style={[styles.waveDot, { opacity: 0.35 }]} />
          </View>
        </LinearGradient>

        <View style={styles.card}>
          <Text style={styles.welcome}>Bem-vindo de volta</Text>
          <Text style={styles.welcomeSub}>Entre com seus dados para acessar sua marina</Text>

          <Text style={styles.label}>CPF</Text>
          <View style={[styles.inputRow, cpfFocused && styles.inputRowFocused]}>
            <Ionicons name="card-outline" size={18} color={cpfFocused ? colors.brandSecondary : colors.onSurfaceTertiary} />
            <TextInput
              testID="cpf-input"
              style={styles.input}
              value={cpf}
              onChangeText={(v) => setCpf(formatCpf(v))}
              onFocus={() => setCpfFocused(true)}
              onBlur={() => setCpfFocused(false)}
              placeholder="00000"
              placeholderTextColor={colors.onSurfaceTertiary}
              keyboardType="number-pad"
              inputMode="numeric"
              maxLength={5}
              autoFocus
            />
          </View>

          <Text style={[styles.label, { marginTop: spacing.lg }]}>Celular (4 últimos números)</Text>
          <View style={[styles.inputRow, phoneFocused && styles.inputRowFocused]}>
            <Ionicons name="call-outline" size={18} color={phoneFocused ? colors.brandSecondary : colors.onSurfaceTertiary} />
            <TextInput
              testID="phone-input"
              style={styles.input}
              value={phone}
              onChangeText={(v) => setPhone(v.replace(/\D/g, '').slice(0, 4))}
              onFocus={() => setPhoneFocused(true)}
              onBlur={() => setPhoneFocused(false)}
              placeholder="0000"
              placeholderTextColor={colors.onSurfaceTertiary}
              keyboardType="number-pad"
              inputMode="numeric"
              maxLength={4}
            />
          </View>

          {error ? (
            <View style={styles.errorBox} testID="login-error">
              <Ionicons name="alert-circle" size={16} color={colors.error} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : (
            <View style={styles.hintBox}>
              <Ionicons name="information-circle-outline" size={15} color={colors.onSurfaceTertiary} />
              <Text style={styles.hint}>5 primeiros números do CPF e 4 últimos do celular</Text>
            </View>
          )}

          <Pressable
            testID="login-submit-button"
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
            onPress={handleLogin}
            disabled={loading}
          >
            <LinearGradient
              colors={['#0B2545', '#1B4E82']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.buttonGradient}
            >
              {loading ? (
                <ActivityIndicator color={colors.onBrandPrimary} />
              ) : (
                <>
                  <Text style={styles.buttonText}>Entrar</Text>
                  <Ionicons name="arrow-forward" size={18} color={colors.onBrandPrimary} />
                </>
              )}
            </LinearGradient>
          </Pressable>

          <View style={styles.footerRow}>
            <Ionicons name="boat-outline" size={13} color={colors.onSurfaceTertiary} />
            <Text style={styles.footerText}>Marina Pararanga — acesso exclusivo para associados</Text>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.brandPrimary },
  scroll: { flexGrow: 1 },
  hero: {
    minHeight: 340,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: spacing.xxxl,
    paddingBottom: spacing.xxl,
    overflow: 'hidden',
  },
  porthole: { position: 'absolute', borderRadius: 999, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.10)' },
  portholeA: { width: 140, height: 140, top: -30, left: -40 },
  portholeB: { width: 90, height: 90, bottom: 10, right: -20 },
  portholeC: { width: 50, height: 50, top: 60, right: 40 },
  boatIcon: { position: 'absolute', bottom: 24, left: 28 },
  compassIcon: { position: 'absolute', top: 20, right: 24 },
  logoWrap: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: radius.lg,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  logoOverlay: { width: 260, height: 130 },
  taglineRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.xl },
  taglineLine: { width: 24, height: 1, backgroundColor: colors.brandSecondary, opacity: 0.6 },
  tagline: { color: colors.brandSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 3 },
  waveRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.lg },
  waveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.onBrandPrimary },
  card: {
    flex: 1,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    marginTop: -28,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xxl,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 8,
  },
  welcome: { color: colors.onSurface, fontSize: typography.xxl, fontWeight: '800' },
  welcomeSub: { color: colors.onSurfaceSecondary, fontSize: typography.base, marginTop: 4, marginBottom: spacing.xl },
  label: {
    color: colors.onSurface,
    fontSize: typography.base,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surfaceSecondary,
  },
  inputRowFocused: { borderColor: colors.brandSecondary, backgroundColor: colors.surface },
  input: {
    flex: 1,
    paddingVertical: spacing.lg,
    fontSize: 22,
    letterSpacing: 1.5,
    color: colors.onSurface,
  },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.sm },
  hintBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.sm },
  errorText: { color: colors.error, fontSize: typography.sm, flex: 1 },
  hint: { color: colors.onSurfaceTertiary, fontSize: typography.sm, flex: 1 },
  button: {
    borderRadius: radius.md,
    marginTop: spacing.xl,
    overflow: 'hidden',
    shadowColor: colors.brandPrimary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 4,
  },
  buttonPressed: { opacity: 0.88 },
  buttonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  buttonText: {
    color: colors.onBrandPrimary,
    fontSize: typography.lg,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  footerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: spacing.xl },
  footerText: { color: colors.onSurfaceTertiary, fontSize: 11 },
});
