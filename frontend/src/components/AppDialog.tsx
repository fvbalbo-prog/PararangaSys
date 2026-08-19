import { Modal, View, Text, Pressable, StyleSheet } from 'react-native';
import { colors, spacing, radius, typography } from '@/src/theme';

export type DialogButton = {
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'cancel' | 'destructive';
  testID?: string;
};

export function AppDialog({
  visible,
  title,
  message,
  buttons,
  onRequestClose,
  testID,
}: {
  visible: boolean;
  title: string;
  message?: string;
  buttons: DialogButton[];
  onRequestClose?: () => void;
  testID?: string;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onRequestClose}>
      <View style={styles.backdrop}>
        <View style={styles.card} testID={testID}>
          <Text style={styles.title}>{title}</Text>
          {message ? <Text style={styles.message}>{message}</Text> : null}
          <View style={styles.actions}>
            {buttons.map((b, i) => {
              const isCancel = b.variant === 'cancel';
              const isDestructive = b.variant === 'destructive';
              return (
                <Pressable
                  key={i}
                  testID={b.testID}
                  onPress={b.onPress}
                  style={({ pressed }) => [
                    styles.btn,
                    isCancel ? styles.btnCancel : isDestructive ? styles.btnDestructive : styles.btnPrimary,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <Text
                    style={[
                      styles.btnText,
                      isCancel ? styles.btnTextCancel : styles.btnTextSolid,
                    ]}
                  >
                    {b.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  card: { width: '100%', maxWidth: 380, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.xl },
  title: { color: colors.onSurface, fontSize: typography.xl, fontWeight: '800' },
  message: { color: colors.onSurfaceSecondary, fontSize: typography.base, marginTop: spacing.sm, lineHeight: 22 },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xl },
  btn: { flex: 1, paddingVertical: spacing.md, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  btnPrimary: { backgroundColor: colors.brandPrimary },
  btnDestructive: { backgroundColor: colors.error },
  btnCancel: { backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  btnText: { fontSize: typography.base, fontWeight: '700' },
  btnTextSolid: { color: '#FFFFFF' },
  btnTextCancel: { color: colors.onSurfaceSecondary },
});
