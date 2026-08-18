import { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable, Modal, ScrollView, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, typography } from '@/src/theme';
import { api } from '@/src/api';
import type { SlotInfo, RequestType } from '@/src/api';
import { tideHeightAt, formatTide, tideColor, type TidePoint } from '@/src/tide';

type Props = {
  label: string;
  type: RequestType;
  date: string | null; // YYYY-MM-DD
  value: string | null; // HH:MM
  onChange: (v: string) => void;
  tidePoints: TidePoint[];
  editingId?: string; // exclude own booking from full-count
  testID?: string;
};

export function TimeSlotField({ label, type, date, value, onChange, tidePoints, editingId, testID }: Props) {
  const [open, setOpen] = useState(false);
  const [slots, setSlots] = useState<SlotInfo[]>([]);
  const [loading, setLoading] = useState(false);

  const loadSlots = useCallback(async () => {
    if (!date) return;
    try {
      setLoading(true);
      const data = await api.slots(type, date);
      setSlots(data);
    } catch {
      setSlots([]);
    } finally {
      setLoading(false);
    }
  }, [type, date]);

  useEffect(() => {
    if (open) loadSlots();
  }, [open, loadSlots]);

  const openPicker = () => {
    if (!date) return;
    setOpen(true);
  };

  const selectedTide = value ? tideHeightAt(tidePoints, value) : null;
  const selectedColor = tideColor(selectedTide);

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        testID={testID}
        style={({ pressed }) => [styles.field, pressed && { opacity: 0.85 }, !date && styles.disabled]}
        onPress={openPicker}
        disabled={!date}
      >
        <Text style={[styles.value, !value && styles.placeholder]}>
          {value || (date ? 'Selecione o horário' : 'Escolha a data primeiro')}
        </Text>
        <Ionicons name="time-outline" size={20} color={colors.onSurfaceSecondary} />
      </Pressable>

      {value ? (
        <View style={[styles.tideRow, { backgroundColor: selectedColor.bg }]}>
          <Ionicons name="water" size={14} color={selectedColor.fg} />
          <Text style={[styles.tideText, { color: selectedColor.fg }]}>
            Maré às {value}: {formatTide(selectedTide)}
            {selectedTide == null ? ' (tábua não cadastrada)' : ''}
          </Text>
        </View>
      ) : null}

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{label}</Text>
              <Pressable onPress={() => setOpen(false)} hitSlop={12} testID={`${testID}-close`}>
                <Ionicons name="close" size={24} color={colors.onSurfaceSecondary} />
              </Pressable>
            </View>
            <Text style={styles.legend}>Máx. 3 lanchas por horário. Verde/amarelo/vermelho = altura da maré.</Text>
            {loading ? (
              <View style={{ padding: spacing.xl }}>
                <ActivityIndicator color={colors.brandPrimary} />
              </View>
            ) : (
              <ScrollView style={{ maxHeight: 380 }} contentContainerStyle={styles.slotGrid}>
                {slots.map((s) => {
                  const h = tideHeightAt(tidePoints, s.time);
                  const tc = tideColor(h);
                  const isFull = !s.available;
                  const selected = s.time === value;
                  return (
                    <Pressable
                      key={s.time}
                      testID={`${testID}-slot-${s.time}`}
                      disabled={isFull && !selected}
                      onPress={() => {
                        onChange(s.time);
                        setOpen(false);
                      }}
                      style={[
                        styles.slot,
                        { borderColor: tc.fg },
                        selected && styles.slotSelected,
                        isFull && styles.slotFull,
                      ]}
                    >
                      <Text style={[styles.slotTime, selected && { color: colors.onBrandPrimary }]}>{s.time}</Text>
                      <View style={[styles.slotTide, { backgroundColor: tc.bg }]}>
                        <Text style={[styles.slotTideText, { color: tc.fg }]}>{formatTide(h)}</Text>
                      </View>
                      <Text style={[styles.slotCount, selected && { color: colors.onBrandPrimary }]}>
                        {s.unlimited ? 'Livre' : isFull ? 'Lotado' : `${s.count}/3`}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.lg },
  label: { color: colors.onSurface, fontSize: typography.base, fontWeight: '600', marginBottom: spacing.sm },
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
  disabled: { opacity: 0.6 },
  value: { color: colors.onSurface, fontSize: typography.lg, fontWeight: '600' },
  placeholder: { color: colors.onSurfaceTertiary, fontWeight: '400' },
  tideRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
  },
  tideText: { fontSize: typography.sm, fontWeight: '700' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
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
  legend: { color: colors.onSurfaceSecondary, fontSize: typography.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  slotGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  slot: {
    width: '31%',
    borderWidth: 1.5,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  slotSelected: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  slotFull: { opacity: 0.4 },
  slotTime: { color: colors.onSurface, fontSize: typography.lg, fontWeight: '800' },
  slotTide: { borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 1, marginVertical: 3 },
  slotTideText: { fontSize: 10, fontWeight: '700' },
  slotCount: { color: colors.onSurfaceSecondary, fontSize: 11, fontWeight: '600' },
});
