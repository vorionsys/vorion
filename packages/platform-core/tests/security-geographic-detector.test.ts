import { describe, it, expect } from 'vitest';
import {
  calculateHaversineDistance,
  calculateTravelSpeed,
} from '../src/security/anomaly/detectors/geographic.js';
import type { GeoLocation } from '../src/security/anomaly/types.js';

describe('calculateHaversineDistance', () => {
  it('calculates zero distance for same point', () => {
    const dist = calculateHaversineDistance(40.7128, -74.006, 40.7128, -74.006);
    expect(dist).toBeCloseTo(0, 5);
  });

  it('calculates correct distance between New York and Los Angeles', () => {
    // NYC: 40.7128N, 74.0060W -> LA: 34.0522N, 118.2437W
    const dist = calculateHaversineDistance(40.7128, -74.006, 34.0522, -118.2437);
    // Expected: ~3940 km
    expect(dist).toBeGreaterThan(3900);
    expect(dist).toBeLessThan(4000);
  });

  it('calculates correct distance between London and Tokyo', () => {
    // London: 51.5074N, 0.1278W -> Tokyo: 35.6762N, 139.6503E
    const dist = calculateHaversineDistance(51.5074, -0.1278, 35.6762, 139.6503);
    // Expected: ~9558 km
    expect(dist).toBeGreaterThan(9500);
    expect(dist).toBeLessThan(9600);
  });

  it('handles antipodal points (max distance)', () => {
    const dist = calculateHaversineDistance(0, 0, 0, 180);
    // Half of Earth's circumference ~20015 km
    expect(dist).toBeGreaterThan(20000);
    expect(dist).toBeLessThan(20100);
  });

  it('handles negative coordinates', () => {
    // Sydney: -33.8688S, 151.2093E -> Sao Paulo: -23.5505S, 46.6333W
    const dist = calculateHaversineDistance(-33.8688, 151.2093, -23.5505, -46.6333);
    expect(dist).toBeGreaterThan(13000);
    expect(dist).toBeLessThan(14000);
  });
});

describe('calculateTravelSpeed', () => {
  it('returns speed in km/h for normal travel', () => {
    const loc1: GeoLocation = { latitude: 40.7128, longitude: -74.006 }; // NYC
    const loc2: GeoLocation = { latitude: 34.0522, longitude: -118.2437 }; // LA

    const time1 = new Date('2024-01-01T08:00:00Z');
    const time2 = new Date('2024-01-01T14:00:00Z'); // 6 hours later

    const speed = calculateTravelSpeed(loc1, time1, loc2, time2);
    expect(speed).not.toBeNull();
    // ~3940 km in 6 hours = ~657 km/h (plausible for plane)
    expect(speed!).toBeGreaterThan(600);
    expect(speed!).toBeLessThan(700);
  });

  it('returns null for zero time difference', () => {
    const loc1: GeoLocation = { latitude: 40.7128, longitude: -74.006 };
    const loc2: GeoLocation = { latitude: 34.0522, longitude: -118.2437 };
    const sameTime = new Date('2024-01-01T08:00:00Z');

    const speed = calculateTravelSpeed(loc1, sameTime, loc2, sameTime);
    expect(speed).toBeNull();
  });

  it('detects impossible travel (extreme speed)', () => {
    const loc1: GeoLocation = { latitude: 40.7128, longitude: -74.006 }; // NYC
    const loc2: GeoLocation = { latitude: 35.6762, longitude: 139.6503 }; // Tokyo

    const time1 = new Date('2024-01-01T08:00:00Z');
    const time2 = new Date('2024-01-01T08:30:00Z'); // 30 minutes later

    const speed = calculateTravelSpeed(loc1, time1, loc2, time2);
    expect(speed).not.toBeNull();
    // ~10800 km in 0.5 hours = ~21600 km/h - impossible
    expect(speed!).toBeGreaterThan(1200); // Above max travel speed
  });

  it('handles reversed time order', () => {
    const loc1: GeoLocation = { latitude: 0, longitude: 0 };
    const loc2: GeoLocation = { latitude: 10, longitude: 10 };

    const time1 = new Date('2024-01-01T12:00:00Z');
    const time2 = new Date('2024-01-01T10:00:00Z');

    const speed = calculateTravelSpeed(loc1, time1, loc2, time2);
    expect(speed).not.toBeNull();
    expect(speed!).toBeGreaterThan(0);
  });

  it('calculates zero speed for same location', () => {
    const loc: GeoLocation = { latitude: 51.5074, longitude: -0.1278 };
    const time1 = new Date('2024-01-01T08:00:00Z');
    const time2 = new Date('2024-01-01T10:00:00Z');

    const speed = calculateTravelSpeed(loc, time1, loc, time2);
    expect(speed).not.toBeNull();
    expect(speed!).toBeCloseTo(0, 5);
  });
});
