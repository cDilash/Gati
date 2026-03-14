/**
 * polyline.ts — Google Encoded Polyline decoder (pure function, no deps).
 *
 * Algorithm: https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 *
 * Each coordinate is encoded as a zigzag-encoded integer split into 5-bit
 * chunks, each chunk offset by 63 for printable ASCII. The continuation
 * bit (0x20) signals whether more chunks follow for the same value.
 * Coordinates are stored as deltas from the previous point.
 */

export interface Coordinate {
  latitude: number;
  longitude: number;
}

/**
 * Decode a Google Encoded Polyline string into an array of lat/lng pairs.
 * Returns an empty array if the input is empty or invalid.
 */
export function decodePolyline(encoded: string): Coordinate[] {
  if (!encoded) return [];

  const coords: Coordinate[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    // Decode one coordinate component (lat or lng)
    let result = 0;
    let shift = 0;
    let byte: number;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    // Zigzag decode: even = positive, odd = negative
    const deltaLat = (result & 1) ? ~(result >> 1) : result >> 1;
    lat += deltaLat;

    result = 0;
    shift = 0;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const deltaLng = (result & 1) ? ~(result >> 1) : result >> 1;
    lng += deltaLng;

    coords.push({
      latitude: lat / 1e5,
      longitude: lng / 1e5,
    });
  }

  return coords;
}
