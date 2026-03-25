# Marathon Coach v2 — Project Guidelines

## Overview
A personal-use React Native marathon training app. AI-first architecture — Gemini generates training plans, adapts them based on performance, and provides coaching chat. Strava is the primary data source for run history. Local-first with Supabase cloud backup.

## Tech Stack
- **Framework**: React Native + Expo SDK 52+ (managed workflow)
- **Language**: TypeScript (strict)
- **Routing**: Expo Router (file-based)
- **Database**: expo-sqlite (local, primary) + Supabase (cloud backup only)
- **AI Engine**: Google Gemini (dual-model: 3.1 Pro for planning, 3 Flash for chat) via `@google/generative-ai` SDK
- **Run Data**: Strava API (OAuth2, activity sync, streams, segments)
- **State Management**: Zustand (single store at `src/store.ts`)
- **UI Framework**: Tamagui (configured in `tamagui.config.ts`)
- **Styling**: `StyleSheet.create()` with Tamagui theme tokens
- **Icons**: MaterialCommunityIcons (`@expo/vector-icons`) for fitness icons + Lucide (`@tamagui/lucide-icons`) for general UI
- **Maps**: react-native-maps (route display)
- **SVG**: react-native-svg (polyline thumbnails, interactive line graphs)
- **Gradients**: expo-linear-gradient + @react-native-masked-view/masked-view (gradient text)
- **Health Data**: Garmin Connect → Supabase Edge Function (every 15 min) → `garmin_health` table → app reads via Supabase client
- **UUID**: `expo-crypto` randomUUID() — NEVER use the `uuid` npm package

## Typography System

Three custom fonts loaded via `expo-font`. Every text element MUST use one of these — no system fonts, no fallbacks.

### Bebas Neue — Headings
- **Use for**: Screen titles, section headers, phase badges, stat labels, type badges, tab headers
- **Style**: Always uppercase, `letterSpacing: 1` or more
- **Font family**: `'BebasNeue_400Regular'`
- **Example**: `WEEK 5 OF 18 — BUILD PHASE`, `COACH BRIEFING`, `EASY RUN`

### Exo 2 — Body Text
- **Use for**: Workout descriptions, coaching text, chat messages, AI briefings, button labels, input text, subtitles
- **Weights**: 300 Light, 400 Regular, 500 Medium, 600 SemiBold, 700 Bold, 800 ExtraBold
- **Font families**: `'Exo2_400Regular'`, `'Exo2_600SemiBold'`, `'Exo2_700Bold'`, etc.
- **Example**: "Run at conversational pace. Focus on relaxed shoulders and quick turnover."

### JetBrains Mono — Numbers & Data
- **Use for**: ALL numbers — pace (8:42/mi), distance (6.2 mi), duration (52:14), HR (148 bpm), VDOT score, split tables, zone values, percentages, volumes
- **Weights**: 400 Regular, 500 Medium, 600 SemiBold, 700 Bold, 800 ExtraBold
- **Font families**: `'JetBrainsMono_700Bold'`, `'JetBrainsMono_400Regular'`, etc.
- **Rule**: EVERY number on EVERY screen uses JetBrains Mono. No exceptions. Remove `fontVariant: ['tabular-nums']` — it's already monospace.
- **Example**: `9:26 /mi`, `6.4 mi`, `148 bpm`, `VDOT 44`

### Font Application Rules
```typescript
// HEADING — section headers, badges, labels
{ fontFamily: 'BebasNeue_400Regular', letterSpacing: 1, textTransform: 'uppercase' }

// BODY — descriptions, messages, buttons
{ fontFamily: 'Exo2_400Regular' }        // body text
{ fontFamily: 'Exo2_600SemiBold' }       // emphasis
{ fontFamily: 'Exo2_700Bold' }           // buttons

// NUMBERS — all numeric data
{ fontFamily: 'JetBrainsMono_700Bold' }  // primary numbers
{ fontFamily: 'JetBrainsMono_400Regular' } // secondary numbers
```

## Icon System

### MaterialCommunityIcons (fitness-specific)
```
Tab bar: "run-fast" (Today), "calendar-month-outline" (Plan), "message-text-outline" (Coach), "chart-timeline-variant" (Runs), "heart-pulse" (Recovery)
Workout: "run" (easy), "run-fast" (threshold), "routes" (long run), "sleep" (rest), "walk" (recovery)
Metrics: "heart-pulse" (HR), "speedometer" (pace), "map-marker-distance" (distance), "timer-outline" (duration), "fire" (calories)
Status: "trophy" (PR/best effort), "medal" (race), "terrain" (hills)
Cross-training: "dumbbell" (general), "weight-lifter" (leg day), "arm-flex" (upper body), "bicycle" (cycling), "swim" (swimming), "meditation" (yoga)
```

### Lucide Icons (general UI)
```
Settings, ChevronRight, Send, X, Check, AlertTriangle, Plus, ArrowLeft, Search
```

## Theme System — Cyan + Orange Gradient Identity

Defined in `src/theme/colors.ts` (single source of truth), applied via `tamagui.config.ts` tokens.
The app icon (cyan/orange runner) defines the visual identity. **Never use hardcoded hex values in components — always import from `src/theme/colors.ts`.**

### Primary Colors
```
Cyan:          #00D4FF           (calm, speed, recovery, easy effort, "on target")
Orange:        #FF6B35           (intensity, fire, effort, warning, "needs attention")
Gradient:      cyan → orange     (hero elements, energy spectrum, premium feel)
```

### Color Meaning Rules (NEVER break these)
- **Cyan** = calm, cool, speed, recovery, easy effort, AI/tech, positive state
- **Orange** = intensity, fire, effort, heart rate, warning, high impact
- **Gradient (cyan→orange)** = energy spectrum, hero elements, primary buttons
- **HR is ALWAYS orange** — heart rate numbers, heart icons, HR zones
- **LOW→HIGH scale** = always cyan→orange (easy→hard, recovered→fatigued, Zone 1→Zone 5)

### Backgrounds (blue-tinted, NOT pure gray)
```
Background:    #0A0A0F           (deep blue-black — main bg)
Surface:       #141420           (card/elevated bg)
Surface Hover: #1A1A2E           (pressed/hover state)
Border:        #1E2A3A           (blue-tinted border)
```

### Text (blue-gray, NOT pure gray)
```
Primary:       #FFFFFF
Secondary:     #8899AA           (descriptions, subtitles)
Tertiary:      #556677           (timestamps, hints)
```

### Semantic
```
Success:       #00E676           (completed, connected)
Error:         #FF5252           (destructive, skipped)
Warning:       #FF6B35           (orange = warning)
Strava:        #FC4C02           (Strava brand — keep their color)
```

### Gradient Components (from `src/theme/`)
- `GradientText` — masked gradient text for hero numbers (VDOT, recovery score)
- `GradientBorder` — gradient-bordered cards (left side or all sides)
- `GradientButton` — gradient background buttons (primary actions)
- Direction: ALWAYS cyan→orange, left→right or top→bottom. Never reversed.

### Where Colors Apply
- **Workout types**: Easy=cyan, Quality(threshold/intervals/tempo)=orange, Long Run=gradient, Rest=cyanDim
- **Recovery levels**: Ready=cyan, Moderate=orangeDim, Fatigued=orange, Rest=error
- **Execution quality**: On target=cyan, Missed pace=orange, Exceeded pace=orange
- **Cross-training impact**: High=orange, Moderate=orangeDim, Low=textSecondary, Positive=cyan
- **Pace zones**: E=cyan → I/R=orange (intensity spectrum)
- **HR zones**: Zone 1=cyan → Zone 5=orange
- **Tab bar**: Active=cyan, Inactive=blue-gray (#4A5568)

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  USER INTERFACE                   │
│  Today | Plan | Coach | Runs | Recovery | Settings │
└──────────────────────┬──────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────┐
│     AI ENGINE (Gemini 3.1 Pro + 3 Flash)          │
│  Plan generation, adaptation, briefings,          │
│  post-run analysis, weekly review, coaching chat  │
└──────────────────────┬──────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────┐
│           SAFETY VALIDATOR (thin math layer)      │
│  15% max volume increase, 35% long run cap,      │
│  20% quality cap, 2mi min, taper enforcement      │
└──────────────────────┬──────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────┐
│              DATA LAYER                           │
│  SQLite (local)  │  Strava API  │  Supabase      │
│  Primary store   │  Run data    │  Backup + Garmin│
└─────────────────────────────────────────────────┘

Garmin Health Data Flow:
  Garmin Watch → Garmin Connect → Supabase Edge Function (every 15 min)
    → garmin_health table → App reads via Supabase client
  Token refresh: OAuth1 exchange in Edge Function (auto, ~1 year lifespan)
  Monitoring: garmin_sync_log table (success/failure, field count, duration)
```

### Core Principle
Gemini IS the coach. It generates plans, adapts them, and gives advice. The math layer is just a safety net that silently caps dangerous numbers. The app is a UI for the AI coach + a data pipeline from Strava.

## File Structure
```
app/
├── _layout.tsx               # Root: TamaguiProvider, PortalProvider, fonts, auth guard
├── setup.tsx                 # 8-step onboarding wizard
├── profile.tsx               # View/edit profile (modal)
├── (tabs)/
│   ├── _layout.tsx           # Tab navigator with MaterialCommunityIcons
│   ├── index.tsx             # Today — workout + briefing + analysis
│   ├── calendar.tsx          # Plan — expandable weeks by phase
│   ├── coach.tsx             # AI Coach — chat with plan changes
│   ├── zones.tsx             # Recovery — recovery score, signals, zones, fitness profile
│   ├── activities.tsx        # Runs — activity list with maps + filters
│   └── settings.tsx          # Settings (hidden tab, gear icon access)
├── workout/[id].tsx          # Workout detail (modal)
└── activity/[id].tsx         # Activity detail with full Strava data (modal)

src/
├── ai/
│   ├── gemini.ts             # Dual-model client (heavy=Pro, fast=Flash), retry, fallback
│   ├── planGenerator.ts      # AI plan generation + validation (heavy model)
│   ├── safetyValidator.ts    # Safety constraint clamping (~50 lines of logic)
│   ├── adaptation.ts         # Plan adaptation (heavy model)
│   ├── weeklyReview.ts       # AI weekly review + adaptation triggers (heavy model)
│   ├── coach.ts              # Coaching chat with full context (fast model)
│   ├── briefing.ts           # Pre-workout, post-run, race strategy (fast model)
│   └── crossTrainingAdvisor.ts # Cross-training impact evaluation (pure logic, no AI)
├── db/
│   ├── schema.ts             # All CREATE TABLE statements
│   ├── database.ts           # DB init, CRUD, migrations
│   └── client.ts             # Re-export for backward compat
├── engine/
│   ├── vdot.ts               # VDOT calculator + race predictions
│   └── paceZones.ts          # Daniels pace zones + HR zones
├── strava/
│   ├── auth.ts               # OAuth2 + token management
│   ├── api.ts                # REST client (activities, detail, streams, athlete, gear)
│   ├── sync.ts               # Activity sync pipeline + auto-matching + execution quality
│   ├── shoes.ts              # Shoe sync from athlete profile
│   ├── profileImport.ts      # Import profile data for setup pre-fill
│   ├── profileUpdater.ts     # Auto-update profile from Strava (weekly miles, VDOT, max HR)
│   ├── convert.ts            # Unit conversions (meters→miles, m/s→sec/mi)
│   ├── bestEfforts.ts        # Best effort analysis
│   └── historicalSync.ts     # First-time 8-week backfill
├── health/
│   ├── garminHealthSync.ts   # Fetches all health data from Supabase garmin_health table
│   ├── healthSync.ts         # Utilities: saveSnapshotToCache(), hasSignificantChanges()
│   ├── recoveryScore.ts      # Pure function — 0-100 score from Garmin signals (RHR, HRV, sleep)
│   └── injuryRisk.ts         # Injury risk assessment from training load + recovery
├── garmin/
│   └── garminData.ts         # Query garmin_health + garmin_activity_data from Supabase
├── backup/
│   ├── supabase.ts           # Supabase client
│   ├── auth.ts               # Sign in/up/out, session management
│   └── backup.ts             # Serialize/upload/download/restore (schema v3)
├── theme/
│   ├── colors.ts             # Single source of truth for ALL colors
│   ├── gradients.ts          # Gradient configs for expo-linear-gradient
│   ├── GradientText.tsx       # Masked gradient text component
│   ├── GradientBorder.tsx     # Gradient-bordered card component
│   └── GradientButton.tsx     # Gradient background button component
├── components/
│   ├── common/
│   │   └── PlanGenerationLoader.tsx  # AI loading screen with streaming steps
│   ├── WeightCheckin.tsx      # Weekly weight check-in modal
│   ├── RouteMap.tsx           # MapView with decoded polyline
│   └── PolylineThumbnail.tsx  # SVG polyline for list cards
├── store.ts                  # Zustand store (single, ~900 lines)
├── types/index.ts            # All TypeScript types
├── stores/
│   └── settingsStore.ts      # Unit preferences (imperial/metric)
└── utils/
    ├── constants.ts           # COLORS, PHASE_COLORS, WORKOUT_TYPE_LABELS
    ├── dateUtils.ts           # Date formatting and math
    ├── workoutIcons.ts        # Workout type → icon mapping
    └── units.ts               # Display unit conversions
```

## Styling Conventions

### Card Pattern
```typescript
{
  backgroundColor: '#1E1E1E',    // COLORS.surface
  borderRadius: 14,
  padding: 16,
  borderWidth: 0.5,
  borderColor: '#333333',        // COLORS.border
}
```

### Button Pattern
```typescript
// Primary action — use GradientButton from src/theme/
// Or: { backgroundColor: colors.cyan, borderRadius: 12, paddingVertical: 14 }

// Secondary action
{ backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border }

// Destructive action
{ borderWidth: 1, borderColor: colors.orange }
```

### Section Header Pattern
```typescript
{ fontFamily: 'BebasNeue_400Regular', fontSize: 14, color: '#A0A0A0', textTransform: 'uppercase', letterSpacing: 1.5 }
```

### Stat Display Pattern
```typescript
// Value
{ fontFamily: 'JetBrainsMono_700Bold', fontSize: 18, color: '#FFFFFF' }
// Label below
{ fontFamily: 'BebasNeue_400Regular', fontSize: 11, color: '#666666', textTransform: 'uppercase', letterSpacing: 1 }
```

### Status Colors (import from `src/theme/colors.ts`)
- Completed: `success` (#00E676)
- Upcoming: `textSecondary` (#8899AA)
- Skipped: `error` (#FF5252)
- Modified: `orange` (#FF6B35)
- Partial: `orangeDim` (#FF6B3580)

## Data Architecture

### SQLite (Primary — local)
All data lives in SQLite. The app works fully offline.

Key tables: `user_profile` (single row), `training_plan` (plan_json JSONB), `workout` (individual workouts + execution_quality), `training_week` (actual_volume from real data), `performance_metric` (run data), `coach_message`, `strava_activity_detail` (rich Strava data), `shoes`, `ai_cache`, `strava_tokens`, `health_snapshot` (Garmin data cache for fast app launch), `cross_training`, `app_settings`

### Supabase (Backup + Garmin health — cloud)
- `backups` — full SQLite snapshot as JSONB (one row per user)
- `garmin_health` — daily health metrics (48 fields: HRV, sleep, body battery, readiness, VO2max, race predictions, etc.)
- `garmin_activity_data` — per-activity metrics (training effect, stamina, running dynamics, power)
- `garmin_auth` — OAuth1 + OAuth2 tokens for Garmin Connect API (read/refreshed by Edge Function)
- `garmin_sync_log` — sync monitoring (success/failure, field count, duration)
- Edge Function `garmin-sync` runs every 15 minutes via pg_cron, fetches from Garmin Connect API

### Strava API (Run data source)
Fetches: activities, detail (splits, laps, best efforts, segments), streams (HR, pace, elevation, cadence, time, distance), athlete profile, gear detail. All stored in `performance_metric` + `strava_activity_detail`.

## AI Architecture

### Gemini Client (`src/ai/gemini.ts`)
- **Heavy model**: `gemini-3.1-pro-preview` — plan generation, adaptation, weekly review (~3s response)
- **Fast model**: `gemini-3-flash-preview` — coach chat, briefings, post-run analysis (~1s response)
- Both are thinking models (responses include thinking tokens)
- SDK: `@google/generative-ai` v0.24.1
- API key: `.env` → `app.config.ts` extra → `expo-constants`
- Retry with exponential backoff (max 3, 1.5s base)
- Heavy model falls back to fast on failure
- `sendStructuredMessage()` for single-turn (plan generation, briefings) — accepts optional `timeoutMs`
- `sendChatMessage()` for multi-turn (coaching chat) — accepts optional `timeoutMs`
- `extractJSON()` handles markdown fences, code blocks, raw JSON
- **IMPORTANT**: `buildCoachSystemPrompt()` is async — queries Supabase for Garmin activity data. All Supabase queries inside AI prompt builders MUST have timeouts (Promise.race with 5s) to prevent hangs.

### Plan Generation (`src/ai/planGenerator.ts`)
- AI generates full `AIGeneratedPlan` JSON (weeks + workouts)
- Safety validator clamps violations silently
- Stored as JSON blob in `training_plan.plan_json`
- Workouts extracted to individual `workout` rows for querying

### Safety Validator (`src/ai/safetyValidator.ts`)
7 rules, all silent clamping:
1. Max 15% week-over-week volume increase
2. Peak volume ≤ 1.6× starting volume
3. Long run ≤ 35% of weekly volume
4. Quality volume ≤ 20% of weekly volume
5. Minimum 2mi per run
6. At least 1 rest day per week
7. Taper in final 3 weeks (75%/50%/30%)

### AI Content (all cached in `ai_cache` table)
- Pre-workout briefing: 2-3 sentences, specific to today's workout
- Post-run analysis: 3-4 sentences analyzing actual vs planned
- Race week strategy: pacing plan with mile-by-mile guidance
- Weekly review: structured assessment with adaptation recommendation

## Setup Flow
```
1. Sign In / Create Account (Supabase auth)
   → If backup exists → restore → skip to tabs
2. Connect Strava → import profile data + 8 weeks of activities
3. Profile (pre-filled from Strava, all editable, "from Strava" tags)
4. Race Details (date picker, course profile, goal type)
5. Training Preferences (available days, long run day)
6. Coaching Context (injuries, weaknesses, schedule notes — optional)
7. AI Plan Generation (loading screen with streaming steps)
8. Plan Review (summary, principles, warnings → Start Training)
```

## Key Constraints

1. **AI generates, math validates** — Gemini creates plans, safety validator clamps numbers
2. **Local-first** — SQLite is primary, Supabase is backup only, app works offline
3. **Garmin = health data** — All recovery/health data from Garmin via Supabase Edge Function (every 15 min). No HealthKit.
4. **Fail gracefully everywhere** — if Gemini is down, show fallback. If Strava/Garmin unavailable, works without.
5. **Cache AI content aggressively** — same inputs = don't call Gemini again
6. **expo-crypto for UUIDs** — NEVER `uuid` package
7. **Auto-backup after significant events** — profile save, plan generation, adaptation, VDOT update, weekly review
8. **Auto-restore on fresh install** — if logged in with cloud backup
9. **Every number uses JetBrains Mono** — no exceptions
10. **Every heading uses Bebas Neue** — uppercase with letter-spacing
11. **Every body text uses Exo 2** — weights 400-700
12. **All colors from `src/theme/colors.ts`** — NEVER hardcode hex values in components
13. **Cyan = calm, Orange = intensity** — this color meaning is NEVER broken
14. **Gradients always cyan→orange** — left→right or top→bottom, never reversed
15. **Health data from Supabase** — `garminHealthSync.ts` queries `garmin_health` table with 5s timeout. No native modules needed.
16. **Workout swaps are 1-2 row changes** — never full plan regeneration for a single workout swap
17. **Past workouts auto-skipped** — `sweepPastWorkouts()` runs on every app open
18. **Volume from real data** — `recalculateWeeklyVolumes()` uses actual performance_metric, not target distances

## Skill Triggers

Use these skills proactively — don't wait to be asked. Invoke whenever the task matches the trigger.

### `/gati-architecture`
**Trigger**: Any work on the Gati codebase — features, bugfixes, audits, architectural questions. Loads the full architecture reference: stack, directories, theme, data flow, unit conversion, AI models, recovery scoring, coding conventions.
Examples: "add a new screen", "how does sync work", "where are pace zones defined", "fix the recovery score"

### `/frontend-design`
**Trigger**: Any task involving creating new screens, redesigning existing UI, building components, changing layouts, or improving visual design. Use BEFORE writing any UI code — it produces higher quality, more distinctive designs than default output.
Examples: "add a new stats screen", "redesign the workout card", "make the coach chat look better"

### `/debug-playbook`
**Trigger**: Any bug, crash, blank screen, unexpected behavior, or "it doesn't work" report. Use BEFORE proposing fixes — diagnoses root cause systematically instead of guessing.
Examples: "the app crashes on launch", "NaN showing in pace", "Strava sync fails", "screen is blank"

### `/expo-react-native`
**Trigger**: Expo/RN-specific tasks — setting up new native modules, configuring app.config.ts, EAS Build issues, expo-router navigation, native module gotchas.
Examples: "add push notifications", "configure EAS Build", "fix expo-sqlite issue"

### `/gemini-integration`
**Trigger**: Anything involving the Gemini API — building prompts, parsing responses, handling rate limits, adding new AI features, modifying the coaching system, changing AI behavior.
Examples: "add a new AI feature", "improve the coaching prompt", "fix Gemini response parsing"

### `/training-science`
**Trigger**: Changes to training logic, safety constraints, volume calculations, pace zone math, periodization, taper algorithms, or any code that affects the training plan structure.
Examples: "adjust the safety validator", "add a new workout type", "change taper percentages"

### `/project-audit`
**Trigger**: When asked to review, audit, verify, or check the implementation. Also use after completing a major feature to verify correctness.
Examples: "audit the code", "check everything works", "review the Strava sync"

### `/brainstorm`
**Trigger**: Before any creative or architectural work — new features, redesigns, major refactors. Explores requirements and design before jumping to code.
Examples: "add social features", "redesign the app architecture", "what should we build next"

### `/code-review`
**Trigger**: After completing implementation work, before committing. Reviews for bugs, security issues, and adherence to project conventions.

## Common Gotchas

1. **expo-sqlite `prepareSync` crash**: Use shared DB instance from `database.ts`. Never open a second connection via `require('expo-sqlite').openDatabaseSync()`.
2. **v1→v2 migration**: Check `PRAGMA user_version` and column existence. Drop incompatible tables, bump version.
3. **Strava sync**: Always check `strava_activity_id` is populated. Old v1 metrics may have null values.
4. **Font loading**: All fonts must load via `useFonts()` before rendering. Show loading screen until `fontsLoaded === true`.
5. **Tamagui babel plugin**: Must be in `babel.config.js`. Clear Metro cache after config changes (`--clear`).
6. **Foreign keys in restore**: Disable `PRAGMA foreign_keys` during cloud restore — v1 backup data has different FK relationships.
7. **Hot reload limitations**: Changes to `database.ts`, `store.ts`, and module-level code require full Metro restart.
8. **Garmin token refresh**: OAuth2 tokens expire hourly. Edge Function auto-refreshes via OAuth1 exchange. If 429 rate-limited, next 15-min cron retry succeeds. If tokens expire (~1 year), run `garmin_auth_v2.py` + `upload_garmin_tokens.py`.
9. **Garmin sync monitoring**: Check `garmin_sync_log` table for failures. Edge Function logs errors gracefully — individual endpoint failures don't stop the sync.
10. **Health data works on simulator**: All health data comes from Supabase (no native modules). Recovery screen, scores, and AI prompts work identically on simulator and device.
11. **Suggestions lost on restart**: `vdotNotification` and `proactiveSuggestion` are persisted to `app_settings` — clear them when dismissed.
12. **Backup schema v3**: Always use `??` fallbacks in `restoreDatabase()` for backward compat with old backups.
13. **Gemini model fallback**: Heavy model (Pro) falls back to fast (Flash) on failure — never crash the app on AI errors.
14. **Hardcoded colors**: NEVER use hex values in component files. Import from `src/theme/colors.ts`. Run grep to audit.
