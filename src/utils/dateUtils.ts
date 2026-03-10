export function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export function formatDateLong(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

export function getToday(): string {
  return new Date().toISOString().split('T')[0];
}

export function isToday(dateStr: string): boolean {
  return dateStr === getToday();
}

export function isFuture(dateStr: string): boolean {
  return dateStr > getToday();
}

export function isPast(dateStr: string): boolean {
  return dateStr < getToday();
}

export function daysBetween(date1: string, date2: string): number {
  const d1 = new Date(date1 + 'T00:00:00');
  const d2 = new Date(date2 + 'T00:00:00');
  return Math.ceil((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
}

export function addDays(dateStr: string, days: number): string {
  const date = new Date(dateStr + 'T00:00:00');
  date.setDate(date.getDate() + days);
  return date.toISOString().split('T')[0];
}

export function getWeekday(dateStr: string): number {
  const date = new Date(dateStr + 'T00:00:00');
  // Convert JS Sunday=0 to our Monday=0 format
  const day = date.getDay();
  return day === 0 ? 6 : day - 1;
}
