import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, Platform, Modal } from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, typography } from '@/src/theme';

type Props = {
  label: string;
  mode: 'date' | 'time';
  value: Date | null;
  onChange: (d: Date) => void;
  minTime?: { h: number; m: number };
  maxTime?: { h: number; m: number };
  testID?: string;
  placeholder?: string;
  minimumDate?: Date;
};

function pad(n: number) {
  return n.toString().padStart(2, '0');
}
function formatDate(d: Date) {
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}
function formatTime(d: Date) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function DateField({
  label,
  mode,
  value,
  onChange,
  minTime,
  maxTime,
  testID,
  placeholder,
  minimumDate,
}: Props) {
  const [show, setShow] = useState(false);
  const [tempValue, setTempValue] = useState<Date>(value || new Date());

  const displayValue = value
    ? mode === 'date'
      ? formatDate(value)
      : formatTime(value)
    : placeholder || '';

  const handleChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === 'android') {
      setShow(false);
      if (event.type === 'set' && selected) {
        const clamped = clampTime(selected, mode, minTime, maxTime);
        onChange(clamped);
      }
    } else if (selected) {
      setTempValue(selected);
    }
  };

  const openPicker = () => {
    setTempValue(value || defaultForMode(mode, minTime));
    setShow(true);
  };

  const confirmIOS = () => {
    const clamped = clampTime(tempValue, mode, minTime, maxTime);
    onChange(clamped);
    setShow(false);
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        testID={testID}
        style={({ pressed }) => [styles.field, pressed && { opacity: 0.85 }]}
        onPress={openPicker}
      >
        <Text style={[styles.value, !value && styles.placeholder]}>
          {displayValue || (mode === 'date' ? 'DD/MM/AAAA' : 'HH:MM')}
        </Text>
        <Ionicons
          name={mode === 'date' ? 'calendar-outline' : 'time-outline'}
          size={20}
          color={colors.onSurfaceSecondary}
        />
      </Pressable>

      {show && Platform.OS === 'android' && (
        <DateTimePicker
          value={value || defaultForMode(mode, minTime)}
          mode={mode}
          is24Hour
          minuteInterval={5}
          minimumDate={minimumDate}
          onChange={handleChange}
        />
      )}

      {Platform.OS === 'ios' && (
        <Modal visible={show} transparent animationType="fade" onRequestClose={() => setShow(false)}>
          <Pressable style={styles.backdrop} onPress={() => setShow(false)}>
            <Pressable style={styles.iosSheet} onPress={(e) => e.stopPropagation()}>
              <View style={styles.iosHeader}>
                <Pressable onPress={() => setShow(false)}>
                  <Text style={styles.iosCancel}>Cancelar</Text>
                </Pressable>
                <Text style={styles.iosTitle}>{label}</Text>
                <Pressable onPress={confirmIOS} testID={`${testID}-confirm`}>
                  <Text style={styles.iosConfirm}>OK</Text>
                </Pressable>
              </View>
              <DateTimePicker
                value={tempValue}
                mode={mode}
                display="spinner"
                is24Hour
                minuteInterval={5}
                minimumDate={minimumDate}
                onChange={handleChange}
                textColor={colors.onSurface}
                themeVariant="light"
              />
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </View>
  );
}

function defaultForMode(mode: 'date' | 'time', minTime?: { h: number; m: number }) {
  if (mode === 'time' && minTime) {
    const d = new Date();
    d.setHours(minTime.h, minTime.m, 0, 0);
    return d;
  }
  return new Date();
}

function clampTime(
  d: Date,
  mode: 'date' | 'time',
  minTime?: { h: number; m: number },
  maxTime?: { h: number; m: number }
) {
  if (mode !== 'time') return d;
  if (!minTime && !maxTime) return d;
  const total = d.getHours() * 60 + d.getMinutes();
  if (minTime) {
    const min = minTime.h * 60 + minTime.m;
    if (total < min) {
      const nd = new Date(d);
      nd.setHours(minTime.h, minTime.m, 0, 0);
      return nd;
    }
  }
  if (maxTime) {
    const max = maxTime.h * 60 + maxTime.m;
    if (total > max) {
      const nd = new Date(d);
      nd.setHours(maxTime.h, maxTime.m, 0, 0);
      return nd;
    }
  }
  return d;
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
  value: { color: colors.onSurface, fontSize: typography.lg, fontWeight: '600' },
  placeholder: { color: colors.onSurfaceTertiary, fontWeight: '400' },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  iosSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingBottom: spacing.xl,
  },
  iosHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  iosTitle: { color: colors.onSurface, fontWeight: '700', fontSize: typography.lg },
  iosCancel: { color: colors.onSurfaceSecondary, fontSize: typography.lg },
  iosConfirm: { color: colors.brandPrimary, fontWeight: '700', fontSize: typography.lg },
});

export const DateHelpers = { formatDate, formatTime, pad };
