import { describe, it, expect } from 'vitest';
import {
  GeoWeatherEnricher,
  formatAddress,
  formatPlaceName,
} from '../src/core/geo-weather-enricher.js';
import { shouldApplyGeocodeAddress } from '../src/modules/ui.js';

const ADDRESS = 'Bäckenäckerstraße 5, 91077 Neunkirchen am Brand';

const NOMINATIM_PARTS = {
  road: 'Bäckenäckerstraße',
  house_number: '5',
  postcode: '91077',
  city: 'Neunkirchen am Brand',
  state: 'Bayern',
  country: 'Deutschland',
};

/** Fake fetch: either a working proxy (+ optional Open-Meteo answers) or none. */
function makeFetch({ proxyOk, openMeteoResults = {} } = {}) {
  return async (url) => {
    const u = String(url);
    if (u.includes('/.netlify/functions/geocode')) {
      if (!proxyOk) return { ok: false, status: 404, json: async () => ({}) };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          lat: 49.95972,
          lon: 11.91072,
          displayName: 'Neunkirchen am Brand',
          address: `${ADDRESS}, Deutschland`,
          addressParts: NOMINATIM_PARTS,
        }),
      };
    }
    const name = new URL(u).searchParams.get('name');
    const results = openMeteoResults[name] ?? [];
    return { ok: true, status: 200, json: async () => ({ results }) };
  };
}

describe('formatAddress / formatPlaceName', () => {
  it('formats street + PLZ city + country', () => {
    expect(formatAddress({ address: NOMINATIM_PARTS })).toBe(
      'Bäckenäckerstraße 5, 91077 Neunkirchen am Brand, Deutschland'
    );
  });

  it('extracts only the place name', () => {
    expect(formatPlaceName({ address: NOMINATIM_PARTS })).toBe('Neunkirchen am Brand');
  });
});

describe('resolveLocation - street level via proxy', () => {
  it('keeps the full address and reports the city as the place name', async () => {
    const enricher = new GeoWeatherEnricher({
      fetch: makeFetch({ proxyOk: true }),
      minIntervalMs: 0,
    });
    const loc = await enricher.resolveLocation(ADDRESS);

    expect(loc.precision).toBe('street');
    expect(loc.confidence).toBe(1);
    expect(loc.address).toContain('Bäckenäckerstraße 5');
    expect(loc.address).toContain('91077 Neunkirchen am Brand');
    expect(loc.displayName).toBe('Neunkirchen am Brand');
  });
});

describe('resolveLocation - city fallback (proxy unavailable)', () => {
  it('keeps the street in the address and shows only the city as place name', async () => {
    const enricher = new GeoWeatherEnricher({
      fetch: makeFetch({
        proxyOk: false,
        openMeteoResults: {
          Brand: [{ name: 'Brand', latitude: 49.95972, longitude: 11.91072 }],
        },
      }),
      minIntervalMs: 0,
    });
    const loc = await enricher.resolveLocation(ADDRESS);

    expect(loc.lat).toBeCloseTo(49.95972, 5);
    expect(loc.lon).toBeCloseTo(11.91072, 5);
    expect(loc.precision).toBe('city');
    // The full requested address survives, not just "Brand"
    expect(loc.address).toBe(ADDRESS);
    expect(loc.displayName).toBe('Brand');
  });
});

describe('shouldApplyGeocodeAddress', () => {
  const cityResult = { address: 'Brand', precision: 'city' };
  const streetResult = { address: 'Bäckenäckerstraße 5, 91077 Neunkirchen am Brand', precision: 'street' };

  it('does not let a city-level result erase an existing validated address', () => {
    expect(shouldApplyGeocodeAddress(ADDRESS, cityResult)).toBe(false);
  });

  it('fills the field when it is empty', () => {
    expect(shouldApplyGeocodeAddress('', cityResult)).toBe(true);
  });

  it('allows a street-level result to update the field', () => {
    expect(shouldApplyGeocodeAddress(ADDRESS, streetResult)).toBe(true);
  });

  it('ignores a result without an address', () => {
    expect(shouldApplyGeocodeAddress('', { precision: 'city' })).toBe(false);
  });
});
