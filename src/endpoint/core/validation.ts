import type { FieldDescriptor } from '../types.js';

export function extractMaxLength(field: any): number | null {
  const schemaMax = field?.schema?.max_length;
  if (typeof schemaMax === 'number' && schemaMax > 0) return schemaMax;
  const validationMax = field?.meta?.validation?.max_length;
  if (typeof validationMax === 'number' && validationMax > 0) return validationMax;
  return null;
}

export function extractIsUnique(field: any): boolean {
  return Boolean(field?.schema?.is_unique);
}

export function clampNumber(value: number, min?: number, max?: number): number {
  let v = value;
  if (typeof min === 'number' && v < min) v = min;
  if (typeof max === 'number' && v > max) v = max;
  return v;
}

export function truncateString(value: string, maxLength: number | null | undefined): string {
  if (!maxLength || maxLength <= 0) return value;
  if (value.length <= maxLength) return value;
  return value.slice(0, maxLength);
}

export function applyUniqueness(value: unknown, isUnique: boolean | undefined, rowIndex: number): unknown {
  if (!isUnique) return value;
  if (value === null || value === undefined) return value;
  const suffix = `-${rowIndex}-${Math.random().toString(36).slice(2, 8)}`;
  if (typeof value === 'string') return value + suffix;
  if (typeof value === 'number') return value + rowIndex;
  return value;
}

export function postProcessValue(
  value: unknown,
  descriptor: FieldDescriptor,
  rowIndex: number
): unknown {
  let v = value;

  if (typeof v === 'string' && descriptor.maxLength) {
    v = truncateString(v, descriptor.maxLength);
  }

  if (typeof v === 'number') {
    const min = descriptor.validation?.min ?? descriptor.validation?.range?.min;
    const max = descriptor.validation?.max ?? descriptor.validation?.range?.max;
    v = clampNumber(v, min, max);
  }

  if (descriptor.isUnique) {
    v = applyUniqueness(v, true, rowIndex);
    if (typeof v === 'string' && descriptor.maxLength) {
      v = truncateString(v as string, descriptor.maxLength);
    }
  }

  return v;
}

export function formatSequence(pattern: string, rowIndex: number, startFrom: number = 0): string {
  const number = startFrom + rowIndex;
  return pattern
    .replace(/\{(0+)\}/g, (_match, zeros: string) => {
      const width = zeros.length;
      return String(number).padStart(width, '0');
    })
    .replace(/\{uuid\}/g, () => crypto.randomUUID());
}
