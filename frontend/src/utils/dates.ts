const parseDate = (value: string | Date): Date => {
  if (value instanceof Date) return value;
  return new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value);
};

// Calendar grouping and labels use the browser's local zone, as the table does.
export const localDateKey = (value: string | Date | null | undefined): string => {
  if (!value) return '';
  const date = parseDate(value);
  if (Number.isNaN(date.getTime())) return '';
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')].join('-');
};

export const formatLocalDate = (value: string | null | undefined): string => (
  value && localDateKey(value) ? parseDate(value).toLocaleDateString('ru-RU') : ''
);

const utcRange = (from: Date, until: Date): { from: string; to: string } => ({
  from: from.toISOString(),
  // The API upper bound is inclusive; PostgreSQL timestamps retain microseconds.
  to: new Date(until.getTime() - 1).toISOString().replace('.999Z', '.999999Z'),
});

export const localDayUtcRange = (key: string): { from: string; to: string } => {
  const from = parseDate(key);
  const until = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1);
  return utcRange(from, until);
};

export const localMonthUtcRange = (year: number, month: number): { from: string; to: string } => (
  utcRange(new Date(year, month, 1), new Date(year, month + 1, 1))
);
