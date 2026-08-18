import { View, Text, StyleSheet, Platform } from 'react-native';
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
function toInputDate(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function toInputTime(d: Date) {
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
  minimumDate,
}: Props) {
  const inputType = mode === 'date' ? 'date' : 'time';
  const currentValue = value
    ? mode === 'date'
      ? toInputDate(value)
      : toInputTime(value)
    : '';

  const handleChange = (raw: string) => {
    if (!raw) return;
    if (mode === 'date') {
      const [y, m, d] = raw.split('-').map(Number);
      const nd = new Date(y, (m || 1) - 1, d || 1);
      onChange(nd);
    } else {
      const [h, m] = raw.split(':').map(Number);
      const nd = new Date();
      // clamp
      let hh = h || 0;
      let mm = m || 0;
      const total = hh * 60 + mm;
      if (minTime) {
        const min = minTime.h * 60 + minTime.m;
        if (total < min) {
          hh = minTime.h;
          mm = minTime.m;
        }
      }
      if (maxTime) {
        const max = maxTime.h * 60 + maxTime.m;
        if (hh * 60 + mm > max) {
          hh = maxTime.h;
          mm = maxTime.m;
        }
      }
      nd.setHours(hh, mm, 0, 0);
      onChange(nd);
    }
  };

  // React Native Web supports rendering raw <input> via createElement fallback.
  // We render an accessible native input element for web preview.
  const inputProps: any = {
    type: inputType,
    value: currentValue,
    onChange: (e: any) => handleChange(e.target.value),
    'data-testid': testID,
    style: {
      border: 'none',
      outline: 'none',
      background: 'transparent',
      fontSize: 16,
      fontWeight: 600,
      color: colors.onSurface,
      width: '100%',
      fontFamily: 'inherit',
    },
    min: mode === 'date' && minimumDate ? toInputDate(minimumDate) : undefined,
    ...(mode === 'time' && minTime ? { min: `${pad(minTime.h)}:${pad(minTime.m)}` } : {}),
    ...(mode === 'time' && maxTime ? { max: `${pad(maxTime.h)}:${pad(maxTime.m)}` } : {}),
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.field}>
        {Platform.OS === 'web' ? (
          // @ts-ignore - web-only element
          <input {...inputProps} />
        ) : null}
        <Ionicons
          name={mode === 'date' ? 'calendar-outline' : 'time-outline'}
          size={20}
          color={colors.onSurfaceSecondary}
        />
      </View>
    </View>
  );
}

export const DateHelpers = { formatDate, formatTime, pad };

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
});
