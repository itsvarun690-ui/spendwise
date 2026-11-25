export function formatCurrency(value: number, currency = 'INR'): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);
}

export function formatCompactCurrency(value: number, currency = 'INR'): string {
  if (Math.abs(value) < 100_000) return formatCurrency(value, currency);
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

export function toLocalDateInput(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getMonthStart(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
}

export function getNextMonthStart(date: Date): string {
  return getMonthStart(new Date(date.getFullYear(), date.getMonth() + 1, 1));
}

export function sameMonth(dateA: string, dateB: Date): boolean {
  return dateA.slice(0, 7) === `${dateB.getFullYear()}-${String(dateB.getMonth() + 1).padStart(2, '0')}`;
}

export function monthLabel(date: Date, options: Intl.DateTimeFormatOptions = { month: 'long', year: 'numeric' }): string {
  return new Intl.DateTimeFormat('en-IN', options).format(date);
}

export function formatDateLong(date: string): string {
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    .format(new Date(`${date}T12:00:00`));
}

export function formatDateShort(date: string): string {
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' })
    .format(new Date(`${date}T12:00:00`));
}

export function elapsedDaysForMonth(selectedMonth: Date, now = new Date()): number {
  const selected = new Date(selectedMonth.getFullYear(), selectedMonth.getMonth(), 1);
  const current = new Date(now.getFullYear(), now.getMonth(), 1);
  if (selected > current) return 0;
  const daysInSelectedMonth = new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() + 1, 0).getDate();
  if (selected < current) return daysInSelectedMonth;
  return now.getDate();
}

export function startOfWeekFor(date: string): string {
  const value = new Date(`${date}T12:00:00`);
  const offset = (value.getDay() + 6) % 7;
  value.setDate(value.getDate() - offset);
  return toLocalDateInput(value);
}
