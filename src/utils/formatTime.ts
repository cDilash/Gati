/**
 * Relative time formatting for dynamic value timestamps.
 * Returns human-readable "5 min ago", "yesterday", "Mar 14", etc.
 */

export function formatRelativeTime(isoOrDate: string | null | undefined): string {
  if (!isoOrDate) return 'not yet synced';

  try {
    const d = new Date(isoOrDate.includes('T') ? isoOrDate : isoOrDate + 'T12:00:00');
    if (isNaN(d.getTime())) return 'not yet synced';
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHrs = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHrs / 24);

    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin} min ago`;
    if (diffHrs < 24) return `${diffHrs} hr${diffHrs > 1 ? 's' : ''} ago`;

    // Check if today
    const isToday = d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    if (isToday) return 'today';

    // Yesterday
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.getDate() === yesterday.getDate() && d.getMonth() === yesterday.getMonth() && d.getFullYear() === yesterday.getFullYear()) return 'yesterday';

    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    if (diffDays < 14) return '1 week ago';
    if (diffDays < 28) return `${Math.floor(diffDays / 7)} weeks ago`;

    // Over 4 weeks — show date
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const dateStr = `${months[d.getMonth()]} ${d.getDate()}`;

    // Over 8 weeks — stale warning
    if (diffDays > 56) return `${dateStr} ⚠️`;

    return dateStr;
  } catch {
    return 'unknown';
  }
}

/**
 * Check if a timestamp is stale (older than threshold in days).
 */
/**
 * Format sleep duration from total minutes → "7h 36m"
 */
export function formatSleepDuration(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = Math.round(totalMinutes % 60);
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

/**
 * Format sleep duration from decimal hours → "7h 36m"
 * e.g. 7.6 → "7h 36m"
 */
export function formatSleepHours(decimalHours: number): string {
  const totalMinutes = Math.round(decimalHours * 60);
  return formatSleepDuration(totalMinutes);
}

export function isStale(isoOrDate: string | null | undefined, thresholdDays: number): boolean {
  if (!isoOrDate) return true;
  try {
    const d = new Date(isoOrDate.includes('T') ? isoOrDate : isoOrDate + 'T12:00:00');
    const diffDays = Math.floor((Date.now() - d.getTime()) / 86400000);
    return diffDays > thresholdDays;
  } catch {
    return true;
  }
}
