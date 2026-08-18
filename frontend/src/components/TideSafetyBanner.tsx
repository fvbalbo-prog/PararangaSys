import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, typography } from '@/src/theme';
import {
  tideHeightAt,
  isTideUnsafe,
  tideThresholdForLength,
  nextSafeTime,
  formatTide,
  type TidePoint,
} from '@/src/tide';

type Props = {
  points: TidePoint[];
  type: 'descida' | 'subida';
  time: string | null;
  boatLength?: number | null;
  testID?: string;
};

export function TideSafetyBanner({ points, type, time, boatLength, testID }: Props) {
  if (!time) return null;
  const height = tideHeightAt(points, time);
  const threshold = tideThresholdForLength(boatLength);
  if (!isTideUnsafe(height, boatLength)) return null;

  const next = nextSafeTime(points, type, time, boatLength);
  return (
    <View style={styles.banner} testID={testID}>
      <Ionicons name="warning" size={20} color="#FFFFFF" />
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>Maré baixa para esta lancha</Text>
        <Text style={styles.text}>
          Maré prevista {formatTide(height)} — mínimo seguro {formatTide(threshold)} para o porte da lancha.
        </Text>
        <Text style={styles.text}>
          {next
            ? `Próximo horário com maré segura: ${next}`
            : 'Não há horário com maré segura neste dia.'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    gap: spacing.md,
    backgroundColor: colors.error,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
    alignItems: 'flex-start',
  },
  title: { color: '#FFFFFF', fontSize: typography.base, fontWeight: '800' },
  text: { color: '#FFFFFF', fontSize: typography.sm, marginTop: 2, lineHeight: 18 },
});
