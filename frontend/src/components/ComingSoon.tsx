import { View, Text, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, typography } from '@/src/theme';

type Props = {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  message: string;
  testID: string;
};

export function ComingSoon({ title, icon, message, testID }: Props) {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.root} edges={['top']} testID={testID}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={16} testID="back-button">
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>{title}</Text>
      </View>
      <View style={styles.center}>
        <View style={styles.iconWrap}>
          <Ionicons name={icon} size={56} color={colors.brandSecondary} />
        </View>
        <Text style={styles.heading}>Em breve</Text>
        <Text style={styles.text}>{message}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg },
  title: { color: colors.onSurface, fontSize: typography.xxl, fontWeight: '800' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  iconWrap: { width: 120, height: 120, borderRadius: 60, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xl },
  heading: { color: colors.onSurface, fontSize: typography.xxl, fontWeight: '800' },
  text: { color: colors.onSurfaceSecondary, fontSize: typography.base, textAlign: 'center', marginTop: spacing.sm, lineHeight: 22 },
});
