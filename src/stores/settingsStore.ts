import { create } from 'zustand';
import { UnitSystem } from '../utils/units';

// Simple key-value settings table in SQLite
// Lazy-initialized to avoid circular deps with db/client.ts

let _dbInitialized = false;

function ensureTable() {
  if (_dbInitialized) return;
  try {
    const SQLite = require('expo-sqlite');
    const db = SQLite.openDatabaseSync('marathon_coach.db');
    db.execSync('CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT);');
    _dbInitialized = true;
  } catch {
    // DB not ready yet, will retry
  }
}

function readSetting(key: string): string | null {
  try {
    ensureTable();
    const SQLite = require('expo-sqlite');
    const db = SQLite.openDatabaseSync('marathon_coach.db');
    const row = (db as any).getFirstSync('SELECT value FROM app_settings WHERE key = ?', key) as { value: string } | null;
    return row?.value ?? null;
  } catch {
    return null;
  }
}

function writeSetting(key: string, value: string) {
  try {
    ensureTable();
    const SQLite = require('expo-sqlite');
    const db = SQLite.openDatabaseSync('marathon_coach.db');
    db.runSync('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', key, value);
  } catch {
    // Silently fail — settings will reset on next launch
  }
}

interface SettingsState {
  units: UnitSystem;
  setUnits: (units: UnitSystem) => void;
  loadSettings: () => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  units: (readSetting('units') as UnitSystem) || 'imperial',

  setUnits: (units: UnitSystem) => {
    writeSetting('units', units);
    set({ units });
  },

  loadSettings: () => {
    const saved = readSetting('units') as UnitSystem | null;
    if (saved) set({ units: saved });
  },
}));
