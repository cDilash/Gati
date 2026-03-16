/**
 * shoes.ts — Shoe mileage tracking via Strava gear.
 *
 * Strava already tracks cumulative distance per gear item — we mirror it.
 * syncShoes() pulls the athlete's shoe list and upserts into SQLite.
 * checkShoeMileage() generates alerts at 80% / 90% / 100% of max miles.
 */

import * as Crypto from 'expo-crypto';
import { getAthleteProfile, getGearDetail } from './api';
import { metersToMiles } from './convert';
import { Shoe, ShoeAlert } from '../types';

// ─── SQLite helpers ────────────────────────────────────────

function getDb() {
  const { getDatabase } = require('../db/database');
  return getDatabase();
}

function upsertShoe(shoe: Shoe): void {
  const db = getDb();
  db.runSync(
    `INSERT INTO shoes (id, strava_gear_id, name, brand, total_miles, max_miles, retired)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(strava_gear_id) DO UPDATE SET
       name = excluded.name,
       brand = excluded.brand,
       total_miles = excluded.total_miles,
       retired = excluded.retired`,
    shoe.id,
    shoe.stravaGearId,
    shoe.name,
    shoe.brand,
    shoe.totalMiles,
    shoe.maxMiles,
    shoe.retired ? 1 : 0,
  );
}

export function getAllShoes(): Shoe[] {
  try {
    const db = getDb();
    const rows = db.getAllSync('SELECT * FROM shoes ORDER BY total_miles DESC') as any[];
    return rows.map(r => ({
      id: r.id,
      stravaGearId: r.strava_gear_id,
      name: r.name,
      brand: r.brand,
      totalMiles: r.total_miles,
      maxMiles: r.max_miles,
      retired: !!r.retired,
    }));
  } catch {
    return [];
  }
}

export function getShoeByGearId(gearId: string): Shoe | null {
  try {
    const db = getDb();
    const r = db.getFirstSync('SELECT * FROM shoes WHERE strava_gear_id = ?', gearId) as any;
    if (!r) return null;
    return {
      id: r.id,
      stravaGearId: r.strava_gear_id,
      name: r.name,
      brand: r.brand,
      totalMiles: r.total_miles,
      maxMiles: r.max_miles,
      retired: !!r.retired,
    };
  } catch {
    return null;
  }
}

// ─── Sync from Strava ──────────────────────────────────────

/**
 * Sync shoes from Strava athlete profile.
 * Strava returns shoes[] on GET /athlete with cumulative distance in meters.
 * We also fetch gear detail for brand info on first encounter.
 */
export async function syncShoes(): Promise<Shoe[]> {
  const athlete = await getAthleteProfile();
  if (!athlete?.shoes) return [];

  const synced: Shoe[] = [];

  for (const gear of athlete.shoes as any[]) {
    const gearId: string = gear.id;
    const distanceMeters: number = gear.converted_distance ?? gear.distance ?? 0;
    const totalMiles = Math.round(metersToMiles(distanceMeters) * 10) / 10;
    const isRetired: boolean = gear.retired ?? false;

    // Try to get existing shoe for its max_miles setting
    const existing = getShoeByGearId(gearId);

    // Fetch gear detail for brand if we haven't seen this shoe before
    let brand: string | null = null;
    let name: string = gear.name || gear.nickname || 'Unknown Shoe';

    if (!existing) {
      const detail = await getGearDetail(gearId);
      if (detail) {
        brand = detail.brand_name ?? null;
        name = detail.name ?? name;
      }
    } else {
      brand = existing.brand;
      name = existing.name;
    }

    const shoe: Shoe = {
      id: existing?.id ?? Crypto.randomUUID(),
      stravaGearId: gearId,
      name,
      brand,
      totalMiles,
      maxMiles: existing?.maxMiles ?? 500,
      retired: isRetired,
    };

    upsertShoe(shoe);
    synced.push(shoe);
  }

  return synced;
}

// ─── Alert Logic ───────────────────────────────────────────

/**
 * Generate alerts for shoes approaching or past replacement threshold.
 * Only alerts on active (non-retired) shoes.
 */
export function checkShoeMileage(shoes: Shoe[]): ShoeAlert[] {
  const alerts: ShoeAlert[] = [];

  for (const shoe of shoes) {
    if (shoe.retired) continue;

    const ratio = shoe.totalMiles / shoe.maxMiles;
    const remaining = Math.round(shoe.maxMiles - shoe.totalMiles);

    if (ratio >= 1.0) {
      alerts.push({
        shoeId: shoe.id,
        name: shoe.name,
        currentMiles: shoe.totalMiles,
        maxMiles: shoe.maxMiles,
        severity: 'critical',
        message: `${shoe.name} has ${shoe.totalMiles}mi — replace immediately. High injury risk. Don't debut new shoes on race day.`,
      });
    } else if (ratio >= 0.9) {
      alerts.push({
        shoeId: shoe.id,
        name: shoe.name,
        currentMiles: shoe.totalMiles,
        maxMiles: shoe.maxMiles,
        severity: 'warning',
        message: `${shoe.name} has ${shoe.totalMiles}mi — only ~${remaining}mi left. Break in a new pair soon.`,
      });
    } else if (ratio >= 0.8) {
      alerts.push({
        shoeId: shoe.id,
        name: shoe.name,
        currentMiles: shoe.totalMiles,
        maxMiles: shoe.maxMiles,
        severity: 'info',
        message: `${shoe.name} has ${shoe.totalMiles}mi — ~${remaining}mi remaining. Start thinking about a replacement.`,
      });
    }
  }

  // Sort: critical first, then warning, then info
  return alerts.sort((a, b) => {
    const order = { critical: 0, warning: 1, info: 2 };
    return order[a.severity] - order[b.severity];
  });
}

/**
 * Format shoe list for AI coach prompt.
 * Returns a compact string like "Nike Pegasus 41 (342mi), Brooks Ghost 15 (89mi, new)"
 */
export function formatShoesForPrompt(shoes: Shoe[]): string {
  const active = shoes.filter(s => !s.retired);
  if (active.length === 0) return 'No shoes synced from Strava.';
  return active.map(s => {
    const tags: string[] = [];
    if (s.totalMiles < 50) tags.push('new');
    if (s.totalMiles >= s.maxMiles) tags.push('OVERDUE FOR REPLACEMENT');
    else if (s.totalMiles >= s.maxMiles * 0.9) tags.push('near end of life');
    const tagStr = tags.length > 0 ? `, ${tags.join(', ')}` : '';
    return `${s.name} (${s.totalMiles}mi${tagStr})`;
  }).join(', ');
}
