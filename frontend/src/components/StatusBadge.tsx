import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, radius, typography } from '@/src/theme';
import type { RequestStatus } from '@/src/api';

const MAP: Record<RequestStatus, { label: string; bg: string; fg: string }> = {
  agendada: { label: 'Aguardando', bg: '#DBEAFE', fg: '#1E3A8A' },
  cancelada: { label: 'Cancelada', bg: '#FEE2E2', fg: colors.error },
  concluida: { label: 'Concluída', bg: '#DCFCE7', fg: colors.success },
};

export function StatusBadge({ status }: { status: RequestStatus }) {
  const s = MAP[status] || MAP.agendada;
  return (
    <View style={[styles.badge, { backgroundColor: s.bg }]} testID={`status-badge-${status}`}>
      <Text style={[styles.text, { color: s.fg }]}>{s.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  text: { fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
});
