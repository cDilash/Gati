# Marathon Coach v2 — Project Guidelines

## Overview
A personal-use React Native marathon training app. AI-first architecture — Gemini generates training plans, adapts them based on performance, and provides coaching chat. Strava is the primary data source for run history. Local-first with Supabase cloud backup.

## Tech Stack
- **Framework**: React Native + Expo SDK 52+ (managed workflow)
- **Language**: TypeScript (strict)
- **Routing**: Expo Router (file-based)
- **Database**: expo-sqlite (local, primary) + Supabase (cloud backup only)
- **AI Engine**: Google Gemini 2.5 Flash via `@google/generative-ai` SDK
- **Run Data**: Strava API (OAuth2, activity sync, streams, segments)
- **State Management**: Zustand (single store at `src/store.ts`)
- **UI Framework**: Tamagui (configured in `tamagui.config.ts`)
- **Styling**: `StyleSheet.create()` with Tamagui theme tokens
- **Icons**: MaterialCommunityIcons (`@expo/vector-icons`) for fitness icons + Lucide (`@tamagui/lucide-icons`) for general UI
- **Maps**: react-native-maps (route display)
- **SVG**: react-native-svg (polyline thumbnails)
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
Tab bar: "run-fast" (Today), "calendar-month" (Plan), "robot" (Coach), "gauge" (Zones), "shoe-sneaker" (Runs)
Workout: "run" (easy), "run-fast" (threshold), "routes" (long run), "sleep" (rest), "walk" (recovery)
Metrics: "heart-pulse" (HR), "speedometer" (pace), "map-marker-distance" (distance), "timer-outline" (duration), "fire" (calories)
Status: "trophy" (PR/best effort), "medal" (race), "terrain" (hills)
```

### Lucide Icons (general UI)
```
Settings, ChevronRight, Send, X, Check, AlertTriangle, Plus, ArrowLeft, Search
```

## Color Palette (Dark Theme)

Defined in `tamagui.config.ts` tokens and `src/utils/constants.ts`:
```
Background:    #121212           (app background)
Surface:       #1E1E1E           (cards, inputs)
Surface Light: #2A2A2A           (hover states, nested cards)
Border:        #333333           (subtle borders)

Accent:        #FF6B35           (primary brand color — bold orange)
Accent Light:  #FF8A5C           (hover/pressed accent)
Primary:       #007AFF           (iOS blue — links, long run day)

Success:       #34C759           (completed, connected, healthy)
Warning:       #FF9500           (caution, approaching limit)
Danger:        #FF3B30           (destructive, critical, skipped)

Text:          #FFFFFF           (primary text)
Text Secondary:#A0A0A0           (descriptions, subtitles)
Text Tertiary: #666666           (timestamps, hints, muted)

Phase Base:    #007AFF (blue)
Phase Build:   #FF9500 (orange)
Phase Peak:    #FF3B30 (red)
Phase Taper:   #34C759 (green)

Strava:        #FC4C02           (Strava brand orange)
```

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  USER INTERFACE                   │
│  Today | Plan | Coach | Zones | Runs | Settings  │
└──────────────────────┬──────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────┐
│              AI ENGINE (Gemini 2.5 Flash)         │
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
│  Primary store   │  Run data    │  Backup only    │
└─────────────────────────────────────────────────┘
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
│   ├── zones.tsx             # Zones — pace/HR zones, predictions, shoes
│   ├── activities.tsx        # Runs — activity list with maps + filters
│   └── settings.tsx          # Settings (hidden tab, gear icon access)
├── workout/[id].tsx          # Workout detail (modal)
└── activity/[id].tsx         # Activity detail with full Strava data (modal)

src/
├── ai/
│   ├── gemini.ts             # Gemini client, retry, JSON extraction
│   ├── planGenerator.ts      # AI plan generation + validation
│   ├── safetyValidator.ts    # Safety constraint clamping (~50 lines of logic)
│   ├── adaptation.ts         # Plan adaptation (missed workouts, injury, etc.)
│   ├── weeklyReview.ts       # AI weekly review + adaptation triggers
│   ├── coach.ts              # Coaching chat with context building
│   └── briefing.ts           # Pre-workout, post-run, race strategy
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
│   ├── sync.ts               # Activity sync pipeline + auto-matching
│   ├── shoes.ts              # Shoe sync from athlete profile
│   ├── profileImport.ts      # Import profile data for setup pre-fill
│   ├── convert.ts            # Unit conversions (meters→miles, m/s→sec/mi)
│   ├── bestEfforts.ts        # Best effort analysis
│   └── historicalSync.ts     # First-time 8-week backfill
├── backup/
│   ├── supabase.ts           # Supabase client
│   ├── auth.ts               # Sign in/up/out, session management
│   └── backup.ts             # Serialize/upload/download/restore
├── components/
│   ├── common/
│   │   └── PlanGenerationLoader.tsx  # AI loading screen with streaming steps
│   ├── RouteMap.tsx           # MapView with decoded polyline
│   └── PolylineThumbnail.tsx  # SVG polyline for list cards
├── store.ts                  # Zustand store (single, ~600 lines)
├── types/index.ts            # All TypeScript types
├── stores/
│   └── settingsStore.ts      # Unit preferences (imperial/metric)
└── utils/
    ├── constants.ts           # COLORS, PHASE_COLORS, WORKOUT_TYPE_LABELS
    ├── dateUtils.ts           # Date formatting and math
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
// Primary action
{ backgroundColor: '#FF6B35', borderRadius: 12, paddingVertical: 14, alignItems: 'center' }
// Button text
{ fontFamily: 'Exo2_700Bold', fontSize: 16, color: '#FFFFFF' }

// Secondary action
{ backgroundColor: '#1E1E1E', borderRadius: 12, borderWidth: 1, borderColor: '#333333' }
// Secondary text
{ fontFamily: 'Exo2_600SemiBold', fontSize: 15, color: '#A0A0A0' }
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

### Status Colors
- Completed: `#34C759` (green)
- Upcoming: `#666666` (gray)
- Skipped: `#FF3B30` (red)
- Modified: `#FF9500` (orange)

## Data Architecture

### SQLite (Primary — local)
All data lives in SQLite. The app works fully offline.

Key tables: `user_profile` (single row), `training_plan` (plan_json JSONB), `workout` (individual workouts), `training_week`, `performance_metric` (run data), `coach_message`, `strava_activity_detail` (rich Strava data), `shoes`, `ai_cache`, `strava_tokens`

### Supabase (Backup only — cloud)
One `backups` table with one row per user. Contains full SQLite snapshot as JSONB. Auto-backup fires after profile save and plan generation. Auto-restore on fresh install if user is logged in.

### Strava API (Run data source)
Fetches: activities, detail (splits, laps, best efforts, segments), streams (HR, pace, elevation, cadence, time, distance), athlete profile, gear detail. All stored in `performance_metric` + `strava_activity_detail`.

## AI Architecture

### Gemini Client (`src/ai/gemini.ts`)
- Model: `gemini-2.5-flash`
- Retry with exponential backoff (max 3, 1.5s base)
- `sendStructuredMessage()` for single-turn (plan generation, briefings)
- `sendChatMessage()` for multi-turn (coaching chat)
- `extractJSON()` handles markdown fences, code blocks, raw JSON

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
3. **Strava is the data source** — no HealthKit in v2 (add later)
4. **Fail gracefully everywhere** — if Gemini is down, show fallback. If Strava disconnected, manual entry works.
5. **Cache AI content aggressively** — same inputs = don't call Gemini again
6. **expo-crypto for UUIDs** — NEVER `uuid` package
7. **Auto-backup after key events** — profile save, plan generation
8. **Auto-restore on fresh install** — if logged in with cloud backup
9. **Every number uses JetBrains Mono** — no exceptions
10. **Every heading uses Bebas Neue** — uppercase with letter-spacing
11. **Every body text uses Exo 2** — weights 400-700

## Skill Triggers

Use these skills proactively — don't wait to be asked. Invoke whenever the task matches the trigger.

### `/frontend-design`
**Trigger**: Any task involving creating new screens, redesigning existing UI, building components, changing layouts, or improving visual design. Use BEFORE writing any UI code — it produces higher quality, more distinctive designs than default output.
Examples: "add a new stats screen", "redesign the workout card", "make the coach chat look better"

### `/debug-playbook`
**Trigger**: Any bug, crash, blank screen, unexpected behavior, or "it doesn't work" report. Use BEFORE proposing fixes — diagnoses root cause systematically instead of guessing.
Examples: "the app crashes on launch", "NaN showing in pace", "Strava sync fails", "screen is blank"

### `/expo-react-native`
**Trigger**: Expo/RN-specific tasks — setting up new native modules, configuring app.config.ts, EAS Build issues, expo-router navigation, native module gotchas, HealthKit/permissions setup.
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
