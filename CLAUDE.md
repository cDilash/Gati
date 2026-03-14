# Marathon Coach - Project Guidelines

## Overview
A personal-use React Native marathon training app. Single user, local-first, never publishing to App Store. Built for marathon training over a ~5 month cycle. The app generates a periodized training plan using sports science algorithms (no AI), syncs run data from Garmin via HealthKit, and provides AI coaching via Google Gemini.

## Tech Stack
- **Framework**: React Native + Expo SDK 52+ (managed workflow)
- **Language**: TypeScript (strict)
- **Routing**: Expo Router (file-based)
- **Database**: expo-sqlite (local) + Supabase (cloud sync/backend)
- **Health Data**: react-native-health (Apple HealthKit read-only)
- **AI Coach**: Google Gemini 2.5 Flash via `@google/generative-ai` SDK (free tier)
- **State Management**: Zustand (minimal — most state lives in SQLite)
- **Styling**: NativeWind (TailwindCSS for React Native) OR StyleSheet.create() — pick whichever is simpler per component
- **Icons**: Phosphor React Native (`phosphor-react-native`)
- **UUID**: `expo-crypto` randomUUID() — NEVER use the `uuid` npm package (crypto.getRandomValues not supported in Expo)

## Architecture Principles

### Data Flow
```
Garmin Watch --> Garmin Connect App --> Apple HealthKit --> react-native-health --> SQLite
```
- All data stored locally in SQLite via expo-sqlite
- HealthKit is READ-ONLY — we never write to it
- Gemini API is the ONLY network dependency (coaching chat)
- If the phone dies, the plan can be regenerated deterministically from the same inputs

### No Auth, No Cloud
- No user accounts, no onboarding flow, no subscription logic
- No multi-user support — single `user_profile` row
- Gemini API key stored in `app.config.ts` `extra` field, accessed via `expo-constants`
- No other environment variables

## File Structure
```
app/                          # Expo Router screens
├── _layout.tsx               # Root layout with providers
├── (tabs)/
│   ├── _layout.tsx           # Tab navigator config
│   ├── today.tsx             # Today's workout screen
│   ├── plan.tsx              # Training plan calendar/list
│   ├── coach.tsx             # AI coaching chat
│   └── zones.tsx             # Pace & HR zone reference
├── workout/
│   └── [id].tsx              # Workout detail view
└── plan/
    └── setup.tsx             # Initial plan setup (VDOT input, race date, etc.)

src/
├── components/               # Reusable UI components
│   ├── workout/              # Workout-related components
│   ├── plan/                 # Plan view components
│   ├── coach/                # Chat UI components
│   └── common/               # Shared primitives
├── db/
│   ├── schema.ts             # SQLite table definitions
│   ├── client.ts             # Database initialization
│   └── migrations/           # Schema migrations
├── engine/                   # Pure TypeScript training logic (NO AI)
│   ├── vdot.ts               # VDOT calculator + lookup table
│   ├── paceZones.ts          # Daniels pace zone derivation
│   ├── hrZones.ts            # Karvonen HR zone calculator
│   └── planGenerator.ts      # Full macrocycle generation algorithm
├── hooks/                    # React hooks for data access
│   ├── useWorkouts.ts
│   ├── useHealthKit.ts
│   ├── useProfile.ts
│   └── useCoach.ts
├── stores/                   # Zustand stores (minimal)
│   ├── activeWorkoutStore.ts
│   └── settingsStore.ts
├── services/
│   ├── gemini.ts             # Gemini API client + context builder
│   └── healthkit.ts          # HealthKit query service
├── utils/
│   ├── paceFormat.ts         # min:sec ↔ decimal conversions
│   ├── dateUtils.ts          # Date math helpers
│   └── constants.ts          # App-wide constants
└── types/
    └── index.ts              # Shared TypeScript types
```

## Tab Screens

### 1. Today
- Shows today's scheduled workout: distance, pace zone, interval breakdown (if applicable)
- "Mark Complete" / "Mark Skipped" buttons
- Displays HealthKit auto-detected run data if available
- Matches HealthKit workouts to scheduled workouts by date

### 2. Plan
- Calendar/list view of the full macrocycle
- Weeks grouped by phase: Base / Build / Peak / Taper
- Cutback weeks visually marked (distinct styling)
- Tap a workout to see full details

### 3. Coach
- AI chat screen powered by Gemini 2.5 Flash
- Every message includes fresh context (see AI Coach Architecture below)
- Gemini can suggest plan modifications as structured JSON
- User confirms before any plan changes are applied

### 4. Zones
- Reference screen showing 5 Daniels pace zones (E/M/T/I/R) in min:mile
- Heart rate zones via Karvonen formula
- Derived from current VDOT — updates when VDOT changes

## Core Engine (Pure TypeScript, No AI)

### VDOT Calculator (`src/engine/vdot.ts`)
- Input: recent race time (e.g., 10K in 48:30)
- Uses interpolation on Daniels VDOT lookup table
- Outputs: VDOT score, predicted race times (marathon, half, 10K, 5K)
- CONSTRAINT: VDOT must be calculated from ACTUAL recent race time, NEVER from goal time

### Pace Zone Calculator (`src/engine/paceZones.ts`)
- Derives 5 Daniels zones from VDOT using exponential decay model:
  - Threshold pace: `P_t = 0.0697 * VDOT^(-0.8081)` (days/km, convert to min/mile)
  - Other zones are ratios off threshold
- Zone definitions:
  - **E (Easy)**: ~59-74% VO2max
  - **M (Marathon)**: ~75-84% VO2max
  - **T (Threshold)**: ~83-88% VO2max
  - **I (Interval)**: ~95-100% VO2max
  - **R (Repetition)**: faster than I pace

### HR Zone Calculator (`src/engine/hrZones.ts`)
- Karvonen formula: `target_HR = resting_HR + (max_HR - resting_HR) * intensity%`
- Requires: resting HR, max HR (or age-estimated)

### Plan Generator (`src/engine/planGenerator.ts`)
The 5-step macrocycle generation algorithm:

**Step 1 — Initialization**
- Anchor `V_start` to current weekly mileage
- Calculate `V_peak` based on runner level (intermediate: ~50-55 mpw peak)
- Set phase durations proportional to total weeks available

**Step 2 — Volume Interpolation**
- Sigmoid curve from `V_start` to `V_peak`
- CONSTRAINT: Max 12% week-over-week volume increase
- CONSTRAINT: Inject cutback week every 4th week (20% volume reduction)
- CONSTRAINT: 3-week taper before race (75% / 50% / 25% of peak)

**Step 3 — Long Run Distribution**
- Progressive long run distance
- CONSTRAINT: Long run capped at 30% of weekly volume
- CONSTRAINT: Max long run 20-22 miles for intermediate level

**Step 4 — Quality Sessions**
- Threshold intervals: build + peak phases
- VO2max intervals: peak phase only
- Marathon pace segments: base phase
- CONSTRAINT: Interval distance <= 8% of weekly volume
- CONSTRAINT: Threshold distance <= 10% of weekly volume

**Step 5 — Fill Remaining Volume**
- Easy/recovery runs fill remaining weekly mileage
- CONSTRAINT: No run under 3 miles — consolidate if needed
- CONSTRAINT: Day after long run = recovery run

### Safety Constraints Summary
These MUST be enforced — never bypass:
- [ ] Max 12% week-over-week volume increase
- [ ] Cutback week every 4th week (20% reduction)
- [ ] Long run <= 30% of weekly volume
- [ ] Long run max 20-22 miles (intermediate)
- [ ] Interval <= 8% weekly volume
- [ ] Threshold <= 10% weekly volume
- [ ] No run under 3 miles
- [ ] Day after long run = recovery
- [ ] 3-week taper (75/50/25)
- [ ] VDOT from actual race time, not goal time

## AI Coach Architecture (`src/services/gemini.ts`)

### Provider
- Google Gemini 2.5 Flash via `@google/generative-ai` SDK
- API key in `app.config.ts` → `extra.geminiApiKey`, accessed via `Constants.expoConfig.extra.geminiApiKey`
- Free tier: ~15 RPM rate limit

### Context Building
Every chat message includes a system prompt assembled from:
1. User profile: age, weight, VDOT, HR zones, pace zones
2. Timeline: current week number, current phase, days until race
3. This week: scheduled workouts + completion status
4. Recent performance: last 7 days of HealthKit data (distance, pace, HR)
5. Volume trend: last 4 weeks of weekly mileage + adherence rate
6. Today: today's scheduled workout details

### System Prompt Embedding
The system prompt includes sports science rules:
- 80/20 polarized training distribution
- Progressive overload principles
- Banister impulse-response fatigue model concepts
- ACWR (Acute:Chronic Workload Ratio) safety thresholds
- Daniels training philosophy

### Plan Modification Flow
1. User asks Gemini a question (e.g., "I feel tired, should I adjust?")
2. Gemini responds with coaching advice
3. If Gemini suggests plan changes, it returns a structured JSON block:
   ```json
   {
     "action": "modify_workout",
     "workout_id": "abc-123",
     "changes": { "distance_miles": 4, "zone": "E" },
     "reason": "Fatigue detected — reducing today's tempo to easy recovery"
   }
   ```
4. App parses JSON, shows user a confirmation dialog
5. User approves → app updates SQLite workout rows
6. User declines → no changes applied

### Gemini Best Practices
- Cache the system prompt string — only rebuild when underlying data changes
- Add retry with exponential backoff (free tier rate limits)
- Gemini is for coaching chat ONLY — plan generation uses the deterministic engine
- Always send fresh context — no stale state between messages

## SQLite Schema (`src/db/schema.ts`)

### Tables
```
user_profile (single row)
├── id TEXT PRIMARY KEY
├── name TEXT
├── age INTEGER
├── weight_lbs REAL
├── resting_hr INTEGER
├── max_hr INTEGER
├── vdot REAL
├── current_weekly_mileage REAL
├── race_date TEXT (ISO 8601)
├── race_distance TEXT ('marathon' | 'half')
├── recent_race_distance TEXT
├── recent_race_time_seconds INTEGER
├── created_at TEXT
└── updated_at TEXT

training_plan
├── id TEXT PRIMARY KEY
├── start_date TEXT
├── race_date TEXT
├── total_weeks INTEGER
├── peak_weekly_mileage REAL
├── vdot_at_creation REAL
├── created_at TEXT
└── updated_at TEXT

training_week
├── id TEXT PRIMARY KEY
├── plan_id TEXT REFERENCES training_plan(id)
├── week_number INTEGER
├── phase TEXT ('base' | 'build' | 'peak' | 'taper')
├── is_cutback INTEGER (boolean)
├── target_volume_miles REAL
├── actual_volume_miles REAL
├── start_date TEXT
└── end_date TEXT

workout
├── id TEXT PRIMARY KEY
├── week_id TEXT REFERENCES training_week(id)
├── date TEXT
├── day_of_week INTEGER (0=Mon..6=Sun)
├── workout_type TEXT ('easy' | 'long' | 'tempo' | 'interval' | 'recovery' | 'marathon_pace' | 'rest')
├── distance_miles REAL
├── target_pace_zone TEXT ('E' | 'M' | 'T' | 'I' | 'R')
├── intervals_json TEXT (nullable, JSON string for structured intervals)
├── status TEXT ('scheduled' | 'completed' | 'skipped')
├── notes TEXT
├── created_at TEXT
└── updated_at TEXT

performance_metric
├── id TEXT PRIMARY KEY
├── workout_id TEXT REFERENCES workout(id) (nullable)
├── date TEXT
├── source TEXT ('healthkit' | 'manual')
├── distance_miles REAL
├── duration_seconds INTEGER
├── avg_pace_per_mile INTEGER (seconds)
├── avg_hr INTEGER
├── max_hr INTEGER
├── calories INTEGER
├── route_json TEXT (nullable)
└── synced_at TEXT

coach_message
├── id TEXT PRIMARY KEY
├── role TEXT ('user' | 'assistant')
├── content TEXT
├── structured_action_json TEXT (nullable)
├── action_applied INTEGER (boolean, default 0)
├── created_at TEXT
└── conversation_id TEXT
```

### Schema Rules
- Use `expo-crypto` randomUUID() for all IDs
- ISO 8601 strings for all dates
- Boolean fields stored as INTEGER (0/1)
- JSON stored as TEXT in `*_json` columns — parse in application layer
- Foreign key relationships enforced at application level (SQLite FK support is optional)
- Wrap migrations in transactions

## HealthKit Integration (`src/services/healthkit.ts`)

### Permissions Required
- Read: Workout Distance, Workout Duration, Heart Rate, Workout Route
- Declared in `Info.plist` AND requested at runtime
- MUST test on real device — HealthKit not available in Simulator

### Data Flow
```
Garmin Watch → Garmin Connect App → Apple HealthKit → react-native-health → SQLite
```

### Matching Logic
- Query HealthKit for workouts of type `.running` in the last 24-48 hours
- Match to scheduled workouts by date (same calendar day)
- Auto-populate `performance_metric` rows
- Handle case where Garmin data hasn't synced yet (show "waiting for sync" state)

### Gotchas
- HealthKit authorization must be in Info.plist AND requested at runtime via `react-native-health`
- Garmin → HealthKit sync can be delayed by minutes or hours
- Always check authorization status before querying
- HealthKit queries are async — use appropriate loading states

## Debugging Playbook

### General Approach
1. **Diagnostics first**: Use `Alert.alert()` checkpoints before applying fixes
2. **One fix at a time**: Never batch multiple changes — isolate variables
3. **Behavior-only prompts**: Describe bug behavior, don't paste code examples

### expo-sqlite
- Wrap all migrations in transactions
- Check schema version before running migrations
- Use synchronous API for reads where possible, async for writes
- If a query returns unexpected results, log the raw SQL first
- Column type mismatches are silent — always verify types match schema

### HealthKit
- Must declare permissions in `Info.plist` AND request at runtime
- Test on real device only — not available in iOS Simulator
- Authorization can be revoked by user at any time — always check status
- Garmin → HealthKit sync delay: show appropriate loading/retry UI

### Gemini API
- Free tier: ~15 RPM rate limit
- Add retry with exponential backoff on 429 responses
- Cache the assembled system prompt — rebuild only when data changes
- Response parsing: always validate structured JSON before applying
- If Gemini returns malformed JSON, show the text response and skip action parsing

### Expo General
- `expo-crypto` for UUIDs, never `uuid` package
- No EAS Build env vars except Gemini API key in `app.config.ts` extra
- File system: use `expo-file-system` new API (`new File(Paths.cache, name)`) if needed
- Modals: use `presentationStyle="pageSheet"` for iOS-style sheets

### NativeWind
- Ensure babel plugin is configured in `babel.config.js`
- If styles don't apply, check that `nativewind/babel` plugin is loaded
- Use `className` prop on components (not `style` for Tailwind classes)

## Code Conventions

### Components
- Functional components with hooks only
- Props interfaces defined inline or in same file
- Use `Pressable` over `TouchableOpacity`
- Always provide `key` prop for list items
- All hooks called unconditionally before any early returns

### Styling
- NativeWind `className` for layout and common patterns
- `StyleSheet.create()` for complex or dynamic styles
- Pick whichever is simpler per component — don't mix both in the same component
- Color palette:
  - Primary: `#007AFF` (iOS blue)
  - Success: `#34C759` (green)
  - Warning: `#FF9500` (orange)
  - Danger: `#FF3B30` (red)
  - Background: `#F2F2F7` (iOS system gray 6)

### Database Operations
- Wrap complex operations in try/catch
- Use parameterized queries (never string interpolation for SQL values)
- Foreign key relationships handled at application level
- Generate UUIDs with `expo-crypto` randomUUID()

### Naming
- Files: camelCase for utilities, PascalCase for components
- Types/Interfaces: PascalCase
- Variables/functions: camelCase
- Constants: SCREAMING_SNAKE_CASE
- Database columns: snake_case

### Engine Code (`src/engine/`)
- Pure functions only — no side effects, no database calls, no React
- Fully testable in isolation
- Input → Output, deterministic
- All training constraints enforced in this layer

## Key Constraints (Summary)

1. Plan generation MUST enforce ALL safety constraints (volume caps, cutback injection, long run limits)
2. VDOT must be calculated from ACTUAL recent race time, not goal time
3. AI coach receives fresh context every message — no stale state
4. Local-first with Supabase cloud sync — plan is deterministically regenerable from same inputs
5. Gemini API key in `app.config.ts` `extra` field via `expo-constants`
6. UUID generation: `expo-crypto` randomUUID() — NEVER `uuid` package
7. HealthKit is read-only — we never write health data
8. No auth, no onboarding, no subscriptions, no multi-user
9. Gemini is for coaching chat ONLY — plan generation is deterministic TypeScript
10. Supabase for cloud sync/backend — SQLite remains primary local store

## Testing Strategy

### Unit Tests (Engine)
- VDOT calculation accuracy against known Daniels tables
- Pace zone derivation correctness
- Plan generator constraint enforcement (all safety rules)
- Edge cases: very low/high VDOT, short/long training windows

### Integration Tests
- Plan generation → SQLite storage → retrieval
- HealthKit data → performance metric matching
- Gemini response parsing → plan modification flow

### Manual Testing Checklist
- [ ] Plan generates correctly from profile inputs
- [ ] All safety constraints enforced (check volume progression)
- [ ] Today screen shows correct workout
- [ ] Mark Complete/Skipped updates workout status
- [ ] HealthKit data appears when Garmin syncs
- [ ] Coach chat sends/receives messages
- [ ] Coach plan modification flow works (suggest → confirm → apply)
- [ ] Zones screen shows correct paces for VDOT
- [ ] Plan view shows phases and cutback weeks correctly
