import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';

type IconName = ComponentProps<typeof Ionicons>['name'];

export const CATEGORY_META: Record<string, { icon: IconName; color: string }> = {
  Bebidas: { icon: 'beer-outline', color: '#0369A1' },
  Sorvetes: { icon: 'ice-cream-outline', color: '#DB2777' },
  'Açaí': { icon: 'nutrition-outline', color: '#7C3AED' },
  Outros: { icon: 'cube-outline', color: '#64748B' },
};

export function categoryMeta(cat?: string | null) {
  return CATEGORY_META[cat || 'Outros'] || CATEGORY_META.Outros;
}
