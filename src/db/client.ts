/**
 * Re-export from database.ts for backward compatibility.
 * Legacy modules (backup, strava sync) import from this path.
 */
export { getDatabase, initializeDatabase } from './database';
