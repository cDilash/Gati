/**
 * RouteMap — renders a Strava activity route on a MapView.
 *
 * Phase 1: Gradient route coloring (cyan→orange), start/finish markers, animated replay.
 * Phase 2: Speed control, timeline scrubber, live stats overlay, pause/resume.
 * Phase 3: Color mode toggle — Distance / Pace / Heart Rate / Elevation.
 *          Streams are interpolated onto polyline segments for data-driven coloring.
 */

import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  PanResponder,
  LayoutChangeEvent,
} from 'react-native';
import MapView, { Polyline, Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import { Text } from 'tamagui';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';

// ─── Typography Helpers ─────────────────────────────────────

const M = (props: any) => <Text fontFamily="$mono" {...props} />;

// ─── Color Modes ────────────────────────────────────────────

type ColorMode = 'distance' | 'pace' | 'hr' | 'elevation';

const COLOR_MODE_LABELS: Record<ColorMode, string> = {
  distance: 'Distance',
  pace: 'Pace',
  hr: 'HR',
  elevation: 'Elev',
};

const COLOR_MODE_ICONS: Record<ColorMode, string> = {
  distance: 'map-marker-distance',
  pace: 'speedometer',
  hr: 'heart-pulse',
  elevation: 'terrain',
};

// ─── Props ──────────────────────────────────────────────────

interface Props {
  polyline: string;
  height?: number;
  strokeColor?: string;
  strokeWidth?: number;
  showGradient?: boolean;
  showMarkers?: boolean;
  showReplay?: boolean;
  /** Total distance in miles — enables live stats overlay during replay */
  totalDistanceMiles?: number;
  /** Total moving time in seconds — enables pace display during replay */
  totalDurationSec?: number;
  /** HR stream data (array of bpm values, ~60 points) */
  hrStream?: number[] | null;
  /** Pace stream — velocity_smooth from Strava (m/s values, ~60 points) */
  paceStream?: number[] | null;
  /** Elevation stream (meters, ~60 points) */
  elevationStream?: number[] | null;
}

// ─── Polyline Decoder ───────────────────────────────────────

function decodePolyline(encoded: string): { latitude: number; longitude: number }[] {
  const points: { latitude: number; longitude: number }[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }

  return points;
}

// ─── Color Interpolation ────────────────────────────────────

/** Default gradient: cyan (#00D4FF) → orange (#FF6B35) */
function getGradientColor(percent: number): string {
  const r = Math.round(0x00 + (0xFF - 0x00) * percent);
  const g = Math.round(0xD4 + (0x6B - 0xD4) * percent);
  const b = Math.round(0xFF + (0x35 - 0xFF) * percent);
  return `rgb(${r}, ${g}, ${b})`;
}

/** Pace: green (fast) → yellow → red (slow). percent=0 is fastest, 1 is slowest. */
function getPaceColor(percent: number): string {
  if (percent < 0.5) {
    // green → yellow
    const t = percent * 2;
    const r = Math.round(0x00 + (0xFF - 0x00) * t);
    const g = Math.round(0xC8 + (0xC8 - 0xC8) * t); // stays ~200
    const b = Math.round(0x00);
    return `rgb(${r}, ${g}, ${b})`;
  }
  // yellow → red
  const t = (percent - 0.5) * 2;
  const r = Math.round(0xFF);
  const g = Math.round(0xC8 * (1 - t));
  const b = Math.round(0x00);
  return `rgb(${r}, ${g}, ${b})`;
}

/** HR: cyan (low) → orange (high). Same as brand gradient. */
function getHRColor(percent: number): string {
  return getGradientColor(percent);
}

/** Elevation: green (low) → brown/tan (high). */
function getElevationColor(percent: number): string {
  const r = Math.round(0x34 + (0xCC - 0x34) * percent);
  const g = Math.round(0xC7 + (0x88 - 0xC7) * percent);
  const b = Math.round(0x59 + (0x22 - 0x59) * percent);
  return `rgb(${r}, ${g}, ${b})`;
}

// ─── Subsample for performance ──────────────────────────────

function subsample(
  coords: { latitude: number; longitude: number }[],
  maxPoints: number,
): { latitude: number; longitude: number }[] {
  if (coords.length <= maxPoints) return coords;
  const step = (coords.length - 1) / (maxPoints - 1);
  const result: typeof coords = [];
  for (let i = 0; i < maxPoints - 1; i++) {
    result.push(coords[Math.round(i * step)]);
  }
  result.push(coords[coords.length - 1]);
  return result;
}

// ─── Haversine distance ─────────────────────────────────────

function haversineDistance(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 3958.8; // miles
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(x));
}

// ─── Stream interpolation ───────────────────────────────────

/**
 * Map a stream of ~60 values onto N polyline segments.
 * Returns a value for each segment index by linear interpolation.
 */
function interpolateStream(stream: number[], segmentCount: number): number[] {
  if (stream.length === 0) return new Array(segmentCount).fill(0);
  if (stream.length === 1) return new Array(segmentCount).fill(stream[0]);

  const result: number[] = [];
  for (let i = 0; i < segmentCount; i++) {
    const t = (i / (segmentCount - 1)) * (stream.length - 1);
    const lo = Math.floor(t);
    const hi = Math.min(lo + 1, stream.length - 1);
    const frac = t - lo;
    result.push(stream[lo] + (stream[hi] - stream[lo]) * frac);
  }
  return result;
}

/**
 * Normalize values to 0-1 range using min/max.
 * For pace (m/s), we invert: faster = lower percent (green), slower = higher (red).
 */
function normalizeValues(values: number[], invert: boolean = false): number[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  if (range === 0) return values.map(() => 0.5);
  return values.map((v) => {
    const pct = (v - min) / range;
    return invert ? 1 - pct : pct;
  });
}

// ─── Format helpers ─────────────────────────────────────────

function formatPaceMM_SS(secPerMile: number): string {
  const min = Math.floor(secPerMile / 60);
  const sec = Math.round(secPerMile % 60);
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

function formatTimeMM_SS(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.round(totalSec % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ─── Speed options ──────────────────────────────────────────

const SPEED_OPTIONS = [1, 2, 4] as const;
type SpeedMultiplier = (typeof SPEED_OPTIONS)[number];

// ─── Component ──────────────────────────────────────────────

export function RouteMap({
  polyline,
  height = 220,
  strokeColor,
  strokeWidth = 4,
  showGradient = true,
  showMarkers = true,
  showReplay = false,
  totalDistanceMiles,
  totalDurationSec,
  hrStream,
  paceStream,
  elevationStream,
}: Props) {
  const allCoords = useMemo(() => decodePolyline(polyline), [polyline]);
  const coords = useMemo(() => subsample(allCoords, 300), [allCoords]);

  // Cumulative distance at each point (for stats overlay)
  const cumulativeDistances = useMemo(() => {
    const dists = [0];
    for (let i = 1; i < coords.length; i++) {
      dists.push(dists[i - 1] + haversineDistance(coords[i - 1], coords[i]));
    }
    return dists;
  }, [coords]);

  // Determine which color modes are available
  const availableModes = useMemo(() => {
    const modes: ColorMode[] = ['distance'];
    if (paceStream && paceStream.length >= 2) modes.push('pace');
    if (hrStream && hrStream.length >= 2) modes.push('hr');
    if (elevationStream && elevationStream.length >= 2) modes.push('elevation');
    return modes;
  }, [paceStream, hrStream, elevationStream]);

  // State
  const [colorMode, setColorMode] = useState<ColorMode>('distance');
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [animProgress, setAnimProgress] = useState(0);
  const [speed, setSpeed] = useState<SpeedMultiplier>(1);
  const animRef = useRef<any>(null);
  const pausedProgressRef = useRef(0);
  const scrubberWidthRef = useRef(0);
  const mountedRef = useRef(true);
  const lastRenderTimeRef = useRef(0);

  if (coords.length < 2) return null;

  // Calculate bounds
  const lats = coords.map((c) => c.latitude);
  const lngs = coords.map((c) => c.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const midLat = (minLat + maxLat) / 2;
  const midLng = (minLng + maxLng) / 2;
  const deltaLat = (maxLat - minLat) * 1.3 || 0.01;
  const deltaLng = (maxLng - minLng) * 1.3 || 0.01;

  // ─── Build colored segments ────────────────────────────

  const coloredSegments = useMemo(() => {
    if (!showGradient) return null;

    const segStep = Math.max(1, Math.floor(coords.length / 100));
    const segmentCoords: { latitude: number; longitude: number }[][] = [];
    for (let i = 0; i < coords.length - 1; i += segStep) {
      const end = Math.min(i + segStep + 1, coords.length);
      segmentCoords.push(coords.slice(i, end));
    }

    const numSegs = segmentCoords.length;

    // Get color for each segment based on mode
    let segmentColors: string[];

    // Fallback to distance mode if stream data is missing for the selected mode
    const effectiveMode =
      (colorMode === 'pace' && (!paceStream || paceStream.length < 2)) ||
      (colorMode === 'hr' && (!hrStream || hrStream.length < 2)) ||
      (colorMode === 'elevation' && (!elevationStream || elevationStream.length < 2))
        ? 'distance'
        : colorMode;

    switch (effectiveMode) {
      case 'pace': {
        const interp = interpolateStream(paceStream!, numSegs);
        const normalized = normalizeValues(interp, true);
        segmentColors = normalized.map(getPaceColor);
        break;
      }
      case 'hr': {
        const interp = interpolateStream(hrStream!, numSegs);
        const normalized = normalizeValues(interp);
        segmentColors = normalized.map(getHRColor);
        break;
      }
      case 'elevation': {
        const interp = interpolateStream(elevationStream!, numSegs);
        const normalized = normalizeValues(interp);
        segmentColors = normalized.map(getElevationColor);
        break;
      }
      default: {
        segmentColors = segmentCoords.map((_, i) =>
          getGradientColor(i / (numSegs - 1)),
        );
        break;
      }
    }

    return segmentCoords.map((c, i) => ({
      coords: c,
      color: segmentColors[i],
    }));
  }, [coords, showGradient, colorMode, paceStream, hrStream, elevationStream]);

  // ─── Animation engine ──────────────────────────────────

  const baseDuration = 10000;

  const startReplay = useCallback(() => {
    setIsPlaying(true);
    setIsPaused(false);
    setAnimProgress(0);
    pausedProgressRef.current = 0;
    lastRenderTimeRef.current = 0;
    const duration = baseDuration / speed;
    const startTime = Date.now();

    const tick = () => {
      if (!mountedRef.current) return;
      const now = Date.now();
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Throttle state updates to ~30fps to reduce re-renders
      if (now - lastRenderTimeRef.current > 33 || progress >= 1) {
        lastRenderTimeRef.current = now;
        setAnimProgress(progress);
      }
      if (progress < 1) {
        animRef.current = requestAnimationFrame(tick);
      } else {
        setIsPlaying(false);
        setIsPaused(false);
      }
    };
    animRef.current = requestAnimationFrame(tick);
  }, [speed]);

  const resumeReplay = useCallback(() => {
    setIsPaused(false);
    lastRenderTimeRef.current = 0;
    const startTime = Date.now();
    const startProgress = pausedProgressRef.current;

    const tick = () => {
      if (!mountedRef.current) return;
      const now = Date.now();
      const elapsed = now - startTime;
      const progress = Math.min(startProgress + elapsed / (baseDuration / speed), 1);
      if (now - lastRenderTimeRef.current > 33 || progress >= 1) {
        lastRenderTimeRef.current = now;
        setAnimProgress(progress);
      }
      if (progress < 1) {
        animRef.current = requestAnimationFrame(tick);
      } else {
        setIsPlaying(false);
        setIsPaused(false);
      }
    };
    animRef.current = requestAnimationFrame(tick);
  }, [speed]);

  const pauseReplay = useCallback(() => {
    if (animRef.current) cancelAnimationFrame(animRef.current);
    pausedProgressRef.current = animProgress;
    setIsPaused(true);
  }, [animProgress]);

  const togglePlayPause = useCallback(() => {
    if (!isPlaying && !isPaused) {
      startReplay();
    } else if (isPlaying && !isPaused) {
      pauseReplay();
    } else if (isPaused) {
      resumeReplay();
    }
  }, [isPlaying, isPaused, startReplay, pauseReplay, resumeReplay]);

  const cycleSpeed = useCallback(() => {
    const idx = SPEED_OPTIONS.indexOf(speed);
    const next = SPEED_OPTIONS[(idx + 1) % SPEED_OPTIONS.length];
    setSpeed(next);
  }, [speed]);

  const cycleColorMode = useCallback(() => {
    const idx = availableModes.indexOf(colorMode);
    const next = availableModes[(idx + 1) % availableModes.length];
    setColorMode(next);
  }, [colorMode, availableModes]);

  const seekTo = useCallback(
    (p: number) => {
      const clamped = Math.max(0, Math.min(1, p));
      if (animRef.current) cancelAnimationFrame(animRef.current);
      setAnimProgress(clamped);
      pausedProgressRef.current = clamped;
      if (isPlaying && !isPaused) {
        setIsPaused(true);
      }
    },
    [isPlaying, isPaused],
  );

  // Clean up animation on unmount — prevents state updates on unmounted component
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (animRef.current) {
        cancelAnimationFrame(animRef.current);
        animRef.current = null;
      }
    };
  }, []);

  // ─── Scrubber PanResponder ─────────────────────────────

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (evt) => {
          const x = evt.nativeEvent.locationX;
          const w = scrubberWidthRef.current;
          if (w > 0) seekTo(x / w);
        },
        onPanResponderMove: (evt) => {
          const x = evt.nativeEvent.locationX;
          const w = scrubberWidthRef.current;
          if (w > 0) seekTo(x / w);
        },
      }),
    [seekTo],
  );

  const onScrubberLayout = useCallback((e: LayoutChangeEvent) => {
    scrubberWidthRef.current = e.nativeEvent.layout.width;
  }, []);

  // ─── Derived display values ────────────────────────────

  const animIndex = Math.floor(animProgress * (coords.length - 1));
  const animDot = coords[animIndex] ?? coords[coords.length - 1];

  const visibleSegmentCount =
    (isPlaying || isPaused) && coloredSegments
      ? Math.ceil(animProgress * coloredSegments.length)
      : coloredSegments?.length ?? 0;

  const startPoint = coords[0];
  const endPoint = coords[coords.length - 1];

  // Live stats
  const showStats = (isPlaying || isPaused) && (totalDistanceMiles || totalDurationSec);
  const elapsedDist = totalDistanceMiles
    ? totalDistanceMiles * animProgress
    : cumulativeDistances[animIndex] ?? 0;
  const elapsedTime = totalDurationSec ? totalDurationSec * animProgress : 0;
  const currentPace =
    totalDurationSec && totalDistanceMiles && animProgress > 0.01
      ? totalDurationSec / totalDistanceMiles
      : 0;

  // Live stream value at current position (for stats pill)
  const liveStreamValue = useMemo(() => {
    if (!isPlaying && !isPaused) return null;
    const t = animProgress;
    if (colorMode === 'hr' && hrStream && hrStream.length >= 2) {
      const idx = t * (hrStream.length - 1);
      const lo = Math.floor(idx);
      const hi = Math.min(lo + 1, hrStream.length - 1);
      const frac = idx - lo;
      return { label: 'HR', value: Math.round(hrStream[lo] + (hrStream[hi] - hrStream[lo]) * frac), unit: 'bpm', color: colors.orange };
    }
    if (colorMode === 'pace' && paceStream && paceStream.length >= 2) {
      const idx = t * (paceStream.length - 1);
      const lo = Math.floor(idx);
      const hi = Math.min(lo + 1, paceStream.length - 1);
      const frac = idx - lo;
      const mps = paceStream[lo] + (paceStream[hi] - paceStream[lo]) * frac;
      if (mps > 0) {
        const secPerMile = 1609.344 / mps;
        return { label: 'Pace', value: formatPaceMM_SS(secPerMile), unit: '/mi', color: colors.cyan };
      }
    }
    if (colorMode === 'elevation' && elevationStream && elevationStream.length >= 2) {
      const idx = t * (elevationStream.length - 1);
      const lo = Math.floor(idx);
      const hi = Math.min(lo + 1, elevationStream.length - 1);
      const frac = idx - lo;
      const meters = elevationStream[lo] + (elevationStream[hi] - elevationStream[lo]) * frac;
      return { label: 'Elev', value: Math.round(meters * 3.28084), unit: 'ft', color: colors.textSecondary };
    }
    return null;
  }, [animProgress, colorMode, hrStream, paceStream, elevationStream, isPlaying, isPaused]);

  const showControls = showReplay && (isPlaying || isPaused);
  const showColorToggle = availableModes.length > 1;

  return (
    <View style={[styles.container, { height: showControls ? height + 56 : height }]}>
      <MapView
        style={styles.map}
        provider={PROVIDER_DEFAULT}
        initialRegion={{
          latitude: midLat,
          longitude: midLng,
          latitudeDelta: deltaLat,
          longitudeDelta: deltaLng,
        }}
        scrollEnabled={false}
        zoomEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        userInterfaceStyle="dark"
      >
        {/* Colored route segments OR single color */}
        {coloredSegments
          ? coloredSegments.slice(0, visibleSegmentCount).map((seg, i) => (
              <Polyline
                key={`${colorMode}-${i}`}
                coordinates={seg.coords}
                strokeColor={seg.color}
                strokeWidth={strokeWidth}
              />
            ))
          : (
            <Polyline
              coordinates={coords}
              strokeColor={strokeColor ?? colors.cyan}
              strokeWidth={strokeWidth}
            />
          )}

        {/* Dim unvisited segments during animation */}
        {(isPlaying || isPaused) &&
          coloredSegments &&
          visibleSegmentCount < coloredSegments.length &&
          coloredSegments.slice(visibleSegmentCount).map((seg, i) => (
            <Polyline
              key={`dim-${i}`}
              coordinates={seg.coords}
              strokeColor={'#33333388'}
              strokeWidth={strokeWidth - 1}
            />
          ))}

        {/* Start marker */}
        {showMarkers && (
          <Marker coordinate={startPoint} anchor={{ x: 0.5, y: 0.5 }}>
            <View style={[styles.marker, { backgroundColor: colors.cyan }]}>
              <MaterialCommunityIcons name="play" size={8} color="#FFFFFF" />
            </View>
          </Marker>
        )}

        {/* Finish marker */}
        {showMarkers && !isPlaying && !isPaused && (
          <Marker coordinate={endPoint} anchor={{ x: 0.5, y: 0.5 }}>
            <View style={[styles.marker, { backgroundColor: colors.orange }]}>
              <MaterialCommunityIcons name="flag-checkered" size={8} color="#FFFFFF" />
            </View>
          </Marker>
        )}

        {/* Animated dot */}
        {(isPlaying || isPaused) && (
          <Marker coordinate={animDot} anchor={{ x: 0.5, y: 0.5 }}>
            <View style={styles.animDot}>
              <View style={styles.animDotInner} />
            </View>
          </Marker>
        )}
      </MapView>

      {/* ─── Live Stats Overlay ─────────────────────────── */}
      {showStats && (
        <View style={styles.statsOverlay}>
          <View style={styles.statPill}>
            <M fontSize={13} fontWeight="700" color={colors.cyan}>
              {elapsedDist.toFixed(2)}
            </M>
            <M fontSize={10} color={colors.textTertiary} marginLeft={2}>
              mi
            </M>
          </View>
          {elapsedTime > 0 && (
            <View style={styles.statPill}>
              <M fontSize={13} fontWeight="700" color={colors.textPrimary}>
                {formatTimeMM_SS(elapsedTime)}
              </M>
            </View>
          )}
          {currentPace > 0 && (
            <View style={styles.statPill}>
              <M fontSize={13} fontWeight="700" color={colors.orange}>
                {formatPaceMM_SS(currentPace)}
              </M>
              <M fontSize={10} color={colors.textTertiary} marginLeft={2}>
                /mi
              </M>
            </View>
          )}
          {liveStreamValue && (
            <View style={styles.statPill}>
              <M fontSize={13} fontWeight="700" color={liveStreamValue.color}>
                {liveStreamValue.value}
              </M>
              <M fontSize={10} color={colors.textTertiary} marginLeft={2}>
                {liveStreamValue.unit}
              </M>
            </View>
          )}
        </View>
      )}

      {/* ─── Color Mode Toggle (top-right) ─────────────── */}
      {showColorToggle && !isPlaying && !isPaused && (
        <Pressable style={styles.colorToggle} onPress={cycleColorMode}>
          <MaterialCommunityIcons
            name={COLOR_MODE_ICONS[colorMode] as any}
            size={14}
            color={colors.cyan}
          />
          <M fontSize={10} fontWeight="600" color={colors.textPrimary} marginLeft={4}>
            {COLOR_MODE_LABELS[colorMode]}
          </M>
        </Pressable>
      )}

      {/* ─── Play button (before animation starts) ──────── */}
      {showReplay && !isPlaying && !isPaused && (
        <Pressable style={styles.playButton} onPress={startReplay}>
          <MaterialCommunityIcons name="play" size={20} color="#FFFFFF" />
        </Pressable>
      )}

      {/* ─── Bottom Control Bar (during animation) ──────── */}
      {showControls && (
        <View style={styles.controlBar}>
          {/* Play / Pause */}
          <Pressable style={styles.controlButton} onPress={togglePlayPause}>
            <MaterialCommunityIcons
              name={isPaused ? 'play' : 'pause'}
              size={18}
              color={colors.cyan}
            />
          </Pressable>

          {/* Scrubber track */}
          <View
            style={styles.scrubberTrack}
            onLayout={onScrubberLayout}
            {...panResponder.panHandlers}
          >
            <View style={styles.scrubberBg} />
            <View style={[styles.scrubberFill, { width: `${animProgress * 100}%` as any }]} />
            <View
              style={[
                styles.scrubberThumb,
                { left: `${animProgress * 100}%` as any },
              ]}
            />
          </View>

          {/* Color mode toggle (during replay) */}
          {showColorToggle && (
            <Pressable style={styles.colorBadge} onPress={cycleColorMode}>
              <MaterialCommunityIcons
                name={COLOR_MODE_ICONS[colorMode] as any}
                size={12}
                color={colors.cyan}
              />
            </Pressable>
          )}

          {/* Speed badge */}
          <Pressable style={styles.speedBadge} onPress={cycleSpeed}>
            <M fontSize={12} fontWeight="700" color={colors.cyan}>
              {speed}x
            </M>
          </Pressable>
        </View>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  map: {
    flex: 1,
  },
  marker: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  animDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.cyan + '44',
    alignItems: 'center',
    justifyContent: 'center',
  },
  animDotInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.cyan,
  },
  playButton: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.cyan,
  },

  // ─── Color mode toggle ──────────────────
  colorToggle: {
    position: 'absolute',
    top: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.cyanGlow,
  },

  // ─── Stats overlay ─────────────────────
  statsOverlay: {
    position: 'absolute',
    top: 10,
    left: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    maxWidth: '75%',
  },
  statPill: {
    flexDirection: 'row',
    alignItems: 'baseline',
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },

  // ─── Control bar ───────────────────────
  controlBar: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    backgroundColor: colors.surface,
    borderTopWidth: 0.5,
    borderTopColor: colors.border,
  },
  controlButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceHover,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  scrubberTrack: {
    flex: 1,
    height: 36,
    justifyContent: 'center',
  },
  scrubberBg: {
    height: 3,
    borderRadius: 1.5,
    backgroundColor: colors.border,
  },
  scrubberFill: {
    position: 'absolute',
    height: 3,
    borderRadius: 1.5,
    backgroundColor: colors.cyan,
  },
  scrubberThumb: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.cyan,
    marginLeft: -7,
    top: 11,
  },
  colorBadge: {
    marginLeft: 8,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.surfaceHover,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.cyanDim,
  },
  speedBadge: {
    marginLeft: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: colors.surfaceHover,
    borderWidth: 1,
    borderColor: colors.cyanDim,
  },
});
