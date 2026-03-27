/**
 * Parse and execute [ADJUST: ...] blocks from coach AI responses.
 * These blocks trigger workout modifications via weeklyAdjustments.ts.
 */

import {
  swapWorkoutDay, modifyWorkout, skipWorkout, addWorkout,
  rescheduleRemainingWorkouts,
} from '../engine/weeklyAdjustments';

export interface ParsedAdjustment {
  type: 'swap' | 'modify' | 'skip' | 'add' | 'reschedule';
  params: Record<string, string>;
  rawBlock: string;
}

export interface AdjustmentResult {
  success: boolean;
  message: string;
  changes?: string[];
}

/**
 * Parse [ADJUST: type | key=value | key=value] blocks from AI response text.
 */
export function parseAdjustmentBlocks(response: string): ParsedAdjustment[] {
  const regex = /\[ADJUST:\s*(swap|modify|skip|add|reschedule)\s*\|([^\]]+)\]/gi;
  const adjustments: ParsedAdjustment[] = [];

  let match;
  while ((match = regex.exec(response)) !== null) {
    const type = match[1].toLowerCase() as ParsedAdjustment['type'];
    const paramStr = match[2];
    const params: Record<string, string> = {};

    paramStr.split('|').forEach(pair => {
      const eqIdx = pair.indexOf('=');
      if (eqIdx > 0) {
        const key = pair.substring(0, eqIdx).trim();
        const value = pair.substring(eqIdx + 1).trim();
        params[key] = value;
      }
    });

    adjustments.push({ type, params, rawBlock: match[0] });
  }

  return adjustments;
}

/**
 * Execute parsed adjustments against the database.
 * Returns results for each adjustment.
 */
export function executeAdjustments(adjustments: ParsedAdjustment[]): AdjustmentResult[] {
  const results: AdjustmentResult[] = [];

  for (const adj of adjustments) {
    try {
      let result: AdjustmentResult;

      switch (adj.type) {
        case 'swap':
          result = swapWorkoutDay(adj.params.workout, adj.params.to);
          break;

        case 'modify': {
          const changes: Record<string, any> = {};
          if (adj.params.distance) changes.targetDistanceMiles = parseFloat(adj.params.distance);
          if (adj.params.type) changes.workoutType = adj.params.type;
          if (adj.params.description) changes.description = adj.params.description;
          if (adj.params.pace) changes.targetPaceZone = adj.params.pace;
          if (adj.params.title) changes.title = adj.params.title;
          result = modifyWorkout(adj.params.workout, changes);
          break;
        }

        case 'skip':
          result = skipWorkout(adj.params.workout, adj.params.reason || 'Skipped by coach');
          break;

        case 'add':
          result = addWorkout(adj.params.date, {
            workoutType: adj.params.type || 'easy',
            targetDistanceMiles: parseFloat(adj.params.distance || '3'),
            description: adj.params.description || 'Coach-added workout',
            targetPaceZone: adj.params.pace,
          });
          break;

        case 'reschedule': {
          const unavailable = (adj.params.unavailable || '').split(',').map(d => d.trim());
          const reschedResult = rescheduleRemainingWorkouts(unavailable, adj.params.longrun);
          result = { success: reschedResult.success, message: reschedResult.changes.join('; ') || 'No changes needed', changes: reschedResult.changes };
          break;
        }

        default:
          result = { success: false, message: `Unknown adjustment type: ${adj.type}` };
      }

      results.push(result);
      console.log(`[Adjustment] ${adj.type}: ${result.success ? 'OK' : 'FAIL'} — ${result.message}`);
    } catch (e: any) {
      results.push({ success: false, message: `Error executing ${adj.type}: ${e.message}` });
      console.error(`[Adjustment] ${adj.type} threw:`, e.message);
    }
  }

  return results;
}

/**
 * Strip [ADJUST: ...] blocks from the display message.
 * The user sees the coach's explanation but not the raw blocks.
 */
export function stripAdjustmentBlocks(response: string): string {
  return response.replace(/\[ADJUST:[^\]]+\]/gi, '').replace(/\n{3,}/g, '\n\n').trim();
}
