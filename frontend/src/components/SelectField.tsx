import { useState } from 'react';
import { View, Text, StyleSheet, Pressable, Modal, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, typography } from '@/src/theme';

type Props = {
  label: string;
  value: string | null;
  options: string[];
  onChange: (v: string) => void;
  placeholder?: string;
  testID?: string;
};

export function SelectField({ label, value, options, onChange, placeholder, testID }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        testID={testID}
        style={({ pressed }) => [styles.field, pressed && { opacity: 0.85 }]}
        onPress={() => setOpen(true)}
      >
        <Text style={[styles.value, !value && styles.placeholder]}>
          {value || placeholder || 'Selecione'}
        </Text>
        <Ionicons name="chevron-down" size={20} color={colors.onSurfaceSecondary} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{label}</Text>
              <Pressable onPress={() => setOpen(false)} hitSlop={12} testID={`${testID}-close`}>
                <Ionicons name="close" size={24} color={colors.onSurfaceSecondary} />
              </Pressable>
            </View>
            <ScrollView style={{ maxHeight: 320 }}>
              {options.map((opt) => {
                const selected = opt === value;
                return (
                  <Pressable
                    key={opt}
                    testID={`${testID}-option-${opt}`}
                    style={({ pressed }) => [styles.option, pressed && { backgroundColor: colors.surfaceSecondary }]}
                    onPress={() => {
                      onChange(opt);
                      setOpen(false);
                    }}
                  >
                    <View style={styles.optionIconWrap}>
                      <Ionicons name="boat-outline" size={18} color={selected ? colors.brandPrimary : colors.onSurfaceTertiary} />
                    </View>
                    <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{opt}</Text>
                    {selected && <Ionicons name="checkmark-circle" size={20} color={colors.brandPrimary} />}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.lg },
  label: {
    color: colors.onSurface,
    fontSize: typography.base,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  field: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    backgroundColor: colors.surfaceSecondary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  value: { color: colors.onSurface, fontSize: typography.lg, fontWeight: '600' },
  placeholder: { color: colors.onSurfaceTertiary, fontWeight: '400' },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingBottom: spacing.xl,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  sheetTitle: { color: colors.onSurface, fontSize: typography.lg, fontWeight: '700' },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  optionIconWrap: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    backgroundColor: colors.brandTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionText: { flex: 1, color: colors.onSurface, fontSize: typography.lg, fontWeight: '500' },
  optionTextSelected: { fontWeight: '700', color: colors.brandPrimary },
});
