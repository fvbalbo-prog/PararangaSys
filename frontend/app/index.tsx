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
} from 'react-native';
import { Image } from 'expo-image';
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    setError(null);
    const digits = cpf.replace(/\D/g, '');
    if (digits.length !== 5) {
      setError('Digite os 5 primeiros números do CPF.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    try {
      setLoading(true);
      const user = await api.login(digits);
      await AsyncStorage.setItem('user', JSON.stringify(user));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace(user.is_admin ? '/admin' : user.is_staff ? '/staff' : '/home');
    } catch (e: any) {
      setError(e.message || 'CPF não cadastrado.');
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
      <View style={{ flex: 1 }}>
          <View style={styles.hero}>
            <Image
              source={require('../assets/images/logo-trans.png')}
              style={styles.logoOverlay}
              contentFit="contain"
              tintColor="#FFFFFF"
              testID="brand-logo"
            />
            <Text style={styles.heroTagline}>Solicitações de descida e subida</Text>
          </View>

          <View style={styles.form}>
            <Text style={styles.label}>CPF</Text>
            <TextInput
              testID="cpf-input"
              style={styles.input}
              value={cpf}
              onChangeText={(v) => setCpf(formatCpf(v))}
              placeholder="00000"
              placeholderTextColor={colors.onSurfaceTertiary}
              keyboardType="number-pad"
              inputMode="numeric"
              maxLength={5}
              autoFocus
            />
            {error ? (
              <Text style={styles.errorText} testID="login-error">
                {error}
              </Text>
            ) : (
              <Text style={styles.hint}>Digite os 5 primeiros números do seu CPF</Text>
            )}

            <Pressable
              testID="login-submit-button"
              style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
              onPress={handleLogin}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color={colors.onBrandPrimary} />
              ) : (
                <Text style={styles.buttonText}>Entrar</Text>
              )}
            </Pressable>
          </View>
        </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  hero: { height: '46%', justifyContent: 'center', alignItems: 'center', backgroundColor: colors.brandPrimary },
  logoBadge: {
    alignSelf: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: radius.lg,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.xl,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 8,
  },
  logoOverlay: { width: 300, height: 150 },
  heroTagline: {
    color: colors.onBrandPrimary,
    opacity: 0.85,
    fontSize: typography.base,
    marginTop: spacing.xl,
    letterSpacing: 0.3,
  },
  heroContent: { padding: spacing.xl, paddingBottom: spacing.lg },
  heroKicker: {
    color: colors.brandSecondary,
    letterSpacing: 4,
    fontSize: typography.sm,
    fontWeight: '700',
  },
  heroTitle: {
    color: colors.onBrandPrimary,
    fontSize: 40,
    fontWeight: '800',
    marginTop: spacing.xs,
  },
  heroSubtitle: {
    color: colors.onBrandPrimary,
    opacity: 0.9,
    fontSize: typography.lg,
    marginTop: spacing.sm,
  },
  logo: { width: '70%', height: 70, alignSelf: 'center', marginBottom: spacing.md },
  form: { flex: 1, padding: spacing.xl, justifyContent: 'space-between' },
  label: {
    color: colors.onSurface,
    fontSize: typography.base,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    fontSize: 22,
    letterSpacing: 1.5,
    color: colors.onSurface,
    backgroundColor: colors.surfaceSecondary,
  },
  hint: { color: colors.onSurfaceTertiary, fontSize: typography.sm, marginTop: spacing.sm },
  errorText: { color: colors.error, fontSize: typography.base, marginTop: spacing.sm },
  button: {
    backgroundColor: colors.brandPrimary,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  buttonPressed: { opacity: 0.85 },
  buttonText: {
    color: colors.onBrandPrimary,
    fontSize: typography.lg,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
