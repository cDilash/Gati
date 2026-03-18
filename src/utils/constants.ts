export const COLORS = {
  background: '#1C1C1E',
  surface: '#2C2C2E',
  surfaceLight: '#3A3A3C',
  accent: '#FF6B35', // bold orange
  accentLight: '#FF8A5C',
  primary: '#007AFF',
  success: '#34C759',
  warning: '#FF9500',
  danger: '#FF3B30',
  text: '#FFFFFF',
  textSecondary: '#AEAEB2',
  textTertiary: '#636366',
  border: '#48484A',
  rest: '#636366',
} as const;

export const PHASE_COLORS: Record<string, string> = {
  base: '#007AFF',
  build: '#FF9500',
  peak: '#FF3B30',
  taper: '#34C759',
};

export const WORKOUT_TYPE_LABELS: Record<string, string> = {
  easy: 'Easy Run',
  long_run: 'Long Run',
  threshold: 'Threshold',
  intervals: 'Intervals',
  tempo: 'Tempo',
  hill_repeats: 'Hill Repeats',
  fartlek: 'Fartlek',
  marathon_pace: 'Marathon Pace',
  recovery: 'Recovery',
  rest: 'Rest Day',
};

export const WORKOUT_TYPE_ICONS: Record<string, string> = {
  easy: 'person-simple-run',
  long_run: 'mountains',
  threshold: 'lightning',
  intervals: 'timer',
  tempo: 'speedometer',
  hill_repeats: 'mountains',
  fartlek: 'shuffle',
  marathon_pace: 'flag',
  recovery: 'heart',
  rest: 'battery-heart-outline',
};

export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const DAY_NAMES_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
