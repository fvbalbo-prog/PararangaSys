import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radius, typography } from '@/src/theme';
import { tideColor, formatTide } from '@/src/tide';

type Props = { height: number | null; small?: boolean; testID?: string };

export function TideChip({ height, small, testID }: Props) {
  const c = tideColor(height);
  return (
    <View
      testID={testID}
      style={[styles.chip, { backgroundColor: c.bg }, small && styles.small]}
    >
      <Ionicons name="water" size={small ? 10 : 12} color={c.fg} />
      <Text style={[styles.text, { color: c.fg }, small && styles.textSmall]}>{formatTide(height)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  small: { paddingHorizontal: 5, paddingVertical: 1 },
  text: { fontSize: typography.sm, fontWeight: '700' },
  textSmall: { fontSize: 10 },
});
