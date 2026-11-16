/**
 * Geocoding module for reverse geocoding coordinates to addresses.
 * Uses OpenStreetMap Nominatim (free, no key required, rate-limited).
 */

const CACHE_NAME = 'geocode-cache-v1';
const MEMORY_CACHE = new Map();
const MEMORY_CACHE_MAX = 200;

/**
 * Reverse geocode coordinates to a human-readable address.
 * @param {number} latitude
 * @param {number} longitude
 * @param {AbortSignal} [signal]
 * @returns {Promise<{label: string, displayName: string}|null>}
 */
export async function reverseGeocode(latitude, longitude, signal) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const key = `${latitude.toFixed(4)},${longitude.toFixed(4)}`;

  // Check memory cache first
  if (MEMORY_CACHE.has(key)) {
    return MEMORY_CACHE.get(key);
  }

  // Check IndexedDB cache
  const cached = await getFromCache(key);
  if (cached) {
    MEMORY_CACHE.set(key, cached);
    return cached;
  }

  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}&accept-language=bg&addressdetails=1`;

  try {
    const response = await fetch(url, { signal });
    if (!response.ok) return null;

    const data = await response.json();
    if (!data.display_name) return null;

    // Build a cleaner label from address details
    const address = data.address || {};
    const parts = [];
    if (address.road) parts.push(address.road);
    if (address.house_number) parts[parts.length - 1] += ` ${address.house_number}`;
    if (address.suburb || address.neighbourhood) parts.push(address.suburb || address.neighbourhood);
    if (address.city || address.town || address.village) parts.push(address.city || address.town || address.village);

    const label = parts.length > 0 ? parts.join(', ') : data.display_name;

    const result = { label, displayName: data.display_name };

    // Store in memory cache
    if (MEMORY_CACHE.size >= MEMORY_CACHE_MAX) {
      const firstKey = MEMORY_CACHE.keys().next().value;
      MEMORY_CACHE.delete(firstKey);
    }
    MEMORY_CACHE.set(key, result);

    // Store in IndexedDB cache
    await saveToCache(key, result);

    return result;
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.warn('[geocode] reverseGeocode failed:', error.message);
    }
    return null;
  }
}

/**
 * Get cached geocode result from IndexedDB.
 */
async function getFromCache(key) {
  try {
    const db = await openCacheDB();
    return new Promise((resolve) => {
      const tx = db.transaction(CACHE_NAME, 'readonly');
      const store = tx.objectStore(CACHE_NAME);
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result?.value ?? null);
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/**
 * Save geocode result to IndexedDB cache.
 */
async function saveToCache(key, value) {
  try {
    const db = await openCacheDB();
    return new Promise((resolve) => {
      const tx = db.transaction(CACHE_NAME, 'readwrite');
      const store = tx.objectStore(CACHE_NAME);
      store.put({ key, value, timestamp: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Ignore cache errors
  }
}

/**
 * Open the IndexedDB cache database.
 */
function openCacheDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('WatermarkGeocodeCache', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CACHE_NAME)) {
        db.createObjectStore(CACHE_NAME, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Clear the memory cache (e.g., when language changes).
 */
export function clearMemoryCache() {
  MEMORY_CACHE.clear();
}

/**
 * Clear the persistent IndexedDB cache.
 */
export async function clearPersistentCache() {
  try {
    const db = await openCacheDB();
    return new Promise((resolve) => {
      const tx = db.transaction(CACHE_NAME, 'readwrite');
      const store = tx.objectStore(CACHE_NAME);
      store.clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Ignore
  }
}