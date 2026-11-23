/**
 * GeoWeatherEnricher — Core enrichment engine for WatermarkCreation
 * 
 * Takes: address + date + time → Returns: lat, lon, displayName, address, temperature, humidity
 * 
 * Architecture from DocumentAutomation + Image Coordinate projects
 * - Netlify Nominatim proxy for street-level geocoding (REQUIRED)
 * - Open-Meteo geocoding fallback (city-level)
 * - Open-Meteo forecast/archive for weather (hourly interpolation)
 * - Throttle (1 req/sec) to respect API limits
 */

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/** Create throttle function (testable with injected clock/delay) */
export function createThrottle(minIntervalMs, now, delay) {
  const doDelay = delay ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  let lastRequestAt = 0;
  return async (fn) => {
    const elapsed = now() - lastRequestAt;
    if (elapsed < minIntervalMs) {
      await doDelay(minIntervalMs - elapsed);
    }
    lastRequestAt = now();
    return fn();
  };
}

/** Parse coordinate string to {lat, lon} — handles decimal, DMS, negative */
export function parseCoordinate(str) {
  if (!str || typeof str !== 'string') return null;
  const s = str.trim();
  if (!s) return null;

  // Decimal: "42.6977, 23.3219" or "42.6977,23.3219" or "-33.8688, 151.2093"
  const decMatch = s.match(/^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/);
  if (decMatch) {
    const lat = parseFloat(decMatch[1]);
    const lon = parseFloat(decMatch[2]);
    if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
      return { lat, lon };
    }
  }

  // DMS: "42°41'52"N 23°19'19"E" or "42°41'52"N, 23°19'19"E"
  const dmsMatch = s.match(
    /^(\d+)°\s*(\d+)'\s*([\d.]+)"\s*([NS])\s*[, ]\s*(\d+)°\s*(\d+)'\s*([\d.]+)"\s*([EW])$/i
  );
  if (dmsMatch) {
    const latDeg = parseInt(dmsMatch[1], 10);
    const latMin = parseInt(dmsMatch[2], 10);
    const latSec = parseFloat(dmsMatch[3]);
    const latDir = dmsMatch[4].toUpperCase();
    const lonDeg = parseInt(dmsMatch[5], 10);
    const lonMin = parseInt(dmsMatch[6], 10);
    const lonSec = parseFloat(dmsMatch[7]);
    const lonDir = dmsMatch[8].toUpperCase();

    let lat = latDeg + latMin / 60 + latSec / 3600;
    let lon = lonDeg + lonMin / 60 + lonSec / 3600;
    if (latDir === 'S') lat = -lat;
    if (lonDir === 'W') lon = -lon;

    if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
      return { lat, lon };
    }
  }

  return null;
}

/** Format Nominatim result to readable address string */
export function formatAddress(nominatimResult) {
  if (!nominatimResult || !nominatimResult.address) return nominatimResult?.display_name ?? '';
  const addr = nominatimResult.address;
  const parts = [];
  if (addr.road) parts.push(addr.road);
  if (addr.house_number) parts[parts.length - 1] += ` ${addr.house_number}`;
  if (addr.suburb) parts.push(addr.suburb);
  if (addr.city || addr.town || addr.village) parts.push(addr.city ?? addr.town ?? addr.village);
  if (addr.state) parts.push(addr.state);
  if (addr.postcode) parts.push(addr.postcode);
  if (addr.country) parts.push(addr.country);
  return parts.join(', ') || nominatimResult.display_name || '';
}

/** Infer role from fieldId (auto-map) */
export function inferRole(fieldId) {
  const id = fieldId.toLowerCase();
  if (id.includes('lat') || id.includes('latitude')) return 'lat';
  if (id.includes('lon') || id.includes('longitude') || id.includes('lng')) return 'lon';
  if (id.includes('temp') || id.includes('temperature')) return 'temp';
  if (id.includes('humid')) return 'humidity';
  if (id.includes('address') || id.includes('addr')) return 'address';
  if (id.includes('display') || id.includes('name') || id.includes('place')) return 'displayName';
  return null;
}

/** Convert decimal degrees to DMS string */
export function toDMS(value, isLat) {
  const dir = isLat ? (value >= 0 ? 'N' : 'S') : (value >= 0 ? 'E' : 'W');
  const abs = Math.abs(value);
  let deg = Math.floor(abs);
  let min = Math.floor((abs - deg) * 60);
  let sec = +(((abs - deg) * 60 - min) * 60).toFixed(1);
  if (sec >= 60) { sec = 0; min += 1; }
  if (min >= 60) { min = 0; deg += 1; }
  const secStr = sec.toFixed(1).replace('.', '’');
  return `${deg}° ${min}’ ${sec}” ${dir}`;
}

// ============================================================================
// AI functions are now provided by the unified ai.js module.
// The following are re-exports for backward compatibility.
// ============================================================================

import { 
  validateAddressWithAI as aiValidateAddress, 
  testAIConnection as aiTestConnection,
  getEffectiveSettings as aiGetEffectiveSettings
} from './ai.js';

/** Get effective AI settings for a category (delegates to ai.js). */
export async function getEffectiveAISettings(categoryId = null) {
  return aiGetEffectiveSettings(categoryId);
}

/** Validate address with AI using effective settings for category (delegates to ai.js). */
export async function validateAddressWithAI(address, categoryId = null) {
  return aiValidateAddress(address, categoryId);
}

/** Test AI connection with a sample address (delegates to ai.js). */
export async function testAIConnection(categoryId = null) {
  return aiTestConnection(categoryId);
}

/** Get global defaults (for UI placeholders/hints). */
export function getGlobalDefaults() {
  return { ...GLOBAL_DEFAULTS };
}

/** Check if a category has custom AI settings. */
export async function hasCategoryOverrides(categoryId) {
  if (!categoryId) return false;
  try {
    const db = await initAISettingsDB();
    return new Promise((resolve) => {
      const tx = db.transaction(AI_SETTINGS_STORE, 'readonly');
      const store = tx.objectStore(AI_SETTINGS_STORE);
      const request = store.get(categoryId);
      request.onsuccess = () => resolve(!!request.result);
      request.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}

export class GeoWeatherEnricher {
  constructor(options = {}) {
    this.fetch = options.fetch ?? globalThis.fetch;
    this.userAgent = options.userAgent ?? 'WatermarkCreation/1.0';
    this.minIntervalMs = options.minIntervalMs ?? 1000;
    this.nominatimProxyUrl = options.nominatimProxyUrl ?? '/.netlify/functions/geocode';
    this.now = options.now ?? (() => Date.now());
    this.delay = options.delay;
    this._throttle = createThrottle(this.minIntervalMs, this.now, this.delay);
  }

  // -------------------------------------------------------------------------
  // 1. RESOLVE LOCATION (Address → lat/lon)
  // -------------------------------------------------------------------------

  async resolveLocation(query) {
    // query = "ул. Витоша 10, София"  OR  "42.6977, 23.3219"  OR  {lat, lon}

    // A) Already coordinates object?
    if (typeof query === 'object' && query.lat && query.lon) {
      return { ...query, confidence: 1 };
    }

    // B) Parse coordinate string (decimal or DMS)
    const parsed = parseCoordinate(query);
    if (parsed) return { ...parsed, confidence: 1 };

    // C) Netlify Nominatim proxy (street-level, avoids CORS)
    if (this.nominatimProxyUrl) {
      const result = await this._resolveViaNominatimProxy(query);
      if (result) return result;
    }

    // D) Fallback: Open-Meteo geocoding (city-level, BG/DE biased)
    return this._resolveViaOpenMeteo(query);
  }

  async _resolveViaNominatimProxy(address) {
    if (!this.nominatimProxyUrl) return null;
    try {
      const response = await this._throttle(async () => {
        return this.fetch(this.nominatimProxyUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ address })
        });
      });
      if (!response.ok) return null;
      const data = await response.json();
      if (data.error || !isFinite(data.lat) || !isFinite(data.lon)) return null;
      return {
        lat: data.lat,
        lon: data.lon,
        displayName: data.displayName ?? null,
        address: data.address ?? null,
        confidence: 1.0
      };
    } catch {
      return null;
    }
  }

  async _resolveViaOpenMeteo(query) {
    // Try multiple query variations for better matching
    // Open-Meteo geocoding works best with English names and language
    let queries = [query];
    
    // Add postal+city, city-only, pre-comma variants
    const pcMatch = query.match(/^(\d{4,5})\s+([A-Za-zа-яА-ЯёЁ\-]+)/);
    if (pcMatch) {
      queries.push(`${pcMatch[1]} ${pcMatch[2]}`);  // "1000 София" / "10115 Berlin"
      queries.push(pcMatch[2]);                     // "София" / "Berlin"
    }
    queries.push(query.split(',')[0].trim());       // before comma
    
    // Extract city name from common address patterns
    // e.g., "Brandenburger Tor, Berlin" -> "Berlin"
    // "Hauptstraße 10, 10115 Berlin" -> "Berlin"
    // "Hauptstr. 5, 80331 München" -> "München"
    const cityMatch = query.match(/(?:,|\s)\s*([A-Za-zäöüßÄÖÜß]+)(?:\s+\d{5})?$/);
    if (cityMatch) {
      queries.push(cityMatch[1].trim());
    }
    
    // Also try to extract city from "street, city" pattern
    const cityMatch2 = query.match(/,\s*([A-Za-zäöüßÄÖÜß]+)(?:\s|$)/);
    if (cityMatch2) {
      queries.push(cityMatch2[1].trim());
    }
    
    // Comprehensive city name mappings for Germany and Bulgaria
    const cityNameMap = {
      // Bulgaria
      'софия': 'Sofia',
      'пловдив': 'Plovdiv',
      'варна': 'Varna',
      'бургас': 'Burgas',
      'русе': 'Ruse',
      'старозагора': 'Stara Zagora',
      'плевен': 'Pleven',
      'сливен': 'Sliven',
      'добрич': 'Dobrich',
      'шумен': 'Shumen',
      'перник': 'Pernik',
      'ямбол': 'Yambol',
      'хaskово': 'Haskovo',
      'пазарджик': 'Pazardzhik',
      'благоевград': 'Blagoevgrad',
      'велико търново': 'Veliko Tarnovo',
      'видин': 'Vidin',
      'монтана': 'Montana',
      'гърбово': 'Gorna Oryahovitsa',
      'каузанляк': 'Kazanlak',
      'димитровград': 'Dimitrovgrad',
      'кърджали': 'Kardzhali',
      'любимец': 'Lyubimets',
      'свищов': 'Svishtov',
      'тракия': 'Trakia',
      'черноморец': 'Chernomorets',
      'созопол': 'Sozopol',
      'несъбър': 'Nesebar',
      'балчик': 'Balchik',
      'каварна': 'Kavarna',
      'шумна': 'Shumen',
      'търговище': 'Targovishte',
      'разград': 'Razgrad',
      'силистра': 'Silistra',
      'добрич': 'Dobrich',
      'карлово': 'Karlovo',
      'козлодуй': 'Kozloduy',
      'оряхово': 'Oryahovo',
      'първомай': 'Parvomay',
      'смалян': 'Smolyan',
      'чепелъре': 'Chepelare',
      'пангюрище': 'Pangyurishte',
      'хисаря': 'Hisarya',
      'крумовград': 'Krumovgrad',
      'момчилград': 'Momchilgrad',
      'златоград': 'Zlatograd',
      'мадан': 'Madan',
      'рудозем': 'Rudozem',
      'банас': 'Banite',
      'девелин': 'Devin',
      'пещера': 'Peshtera',
      'раковски': 'Rakovski',
      'сапарева баня': 'Sapareva Banya',
      'септември': 'Septemvri',
      'стамболийски': 'Stamboliyski',
      'хисаря': 'Hisarya',
      // Germany
      'берлин': 'Berlin',
      'мюнхен': 'Munich',
      'хембург': 'Hamburg',
      'кёльн': 'Cologne',
      'франкфурт': 'Frankfurt',
      'штутгарт': 'Stuttgart',
      'дюселдворф': 'Dusseldorf',
      'дортмунд': 'Dortmund',
      'есън': 'Essen',
      'лайпциг': 'Leipzig',
      'бремен': 'Bremen',
      'дрёсден': 'Dresden',
      'хановер': 'Hanover',
      'нюрнберг': 'Nuremberg',
      'дуйсбург': 'Duisburg',
      'бокум': 'Bochum',
      'вуппертал': 'Wuppertal',
      'билефелд': 'Bielefeld',
      'манхайм': 'Mannheim',
      'бонн': 'Bonn',
      'гёльзенкърхен': 'Gelsenkirchen',
      'мюнстер': 'Munster',
      'монхенгладбах': 'Monchengladbach',
      'брауншвайг': 'Braunschweig',
      'хемберн': 'Chemnitz',
      'кил': 'Kiel',
      'аугсбург': 'Augsburg',
      'виспаден': 'Wiesbaden',
      'касель': 'Kassel',
      'кимерсхаусен': 'Krefeld',
      'хале': 'Halle',
      'магдебург': 'Magdeburg',
      'фрайбург': 'Freiburg',
      'обирнхаузен': 'Oberhausen',
      'любек': 'Lubeck',
      'еранген': 'Erlangen',
      'рудолфштадт': 'Rudolfstadt',
      'росток': 'Rostock',
      'потсдам': 'Potsdam',
      'заарбрюкен': 'Saarbrucken',
      'офенбах': 'Offenbach',
      'улм': 'Ulm',
      'хайде': 'Heide',
      'гётерсло': 'Gutersloh',
      'регенсбург': 'Regensburg',
      'фюрт': 'Furth',
      'вилабсхаузен': 'Wurzburg',
      'инголдштадт': 'Ingolstadt',
      'хайденхайм': 'Heidenheim',
      'фьърт': 'Fuerth',
      'калцар': 'Kiel',
      'зигенау': 'Siegen',
      'соест': 'Soest',
      'шверин': 'Schwerin',
      'неурупин': 'Neuruppin',
      'бранденбург': 'Brandenburg',
      'котбус': 'Cottbus',
      'франкфурт ан дер одера': 'Frankfurt (Oder)',
    };
    
    // Try to transliterate common city names to Latin
    const lowerQuery = query.toLowerCase();
    for (const [local, latin] of Object.entries(cityNameMap)) {
      if (lowerQuery.includes(local)) {
        queries.push(query.replace(new RegExp(local, 'gi'), latin));
      }
    }
    
    // Extract city names from transliterated queries and add them as separate queries
    // This helps with street addresses like "ул. Витоша 10, София" -> "ул. Витоша 10, Sofia" -> "Sofia"
    const cityExtractionRegex = /(?:,|\s)\s*([A-Za-zäöüßÄÖÜß]+)(?:\s+\d{5})?$/;
    const cityExtractionRegex2 = /,\s*([A-Za-zäöüßÄÖÜß]+)(?:\s|$)/;
    const currentQueries = [...queries]; // Copy current queries
    for (const q of currentQueries) {
      const match1 = q.match(cityExtractionRegex);
      if (match1) {
        queries.push(match1[1].trim());
      }
      const match2 = q.match(cityExtractionRegex2);
      if (match2) {
        queries.push(match2[1].trim());
      }
    }
    
    // Remove duplicates
    queries = [...new Set(queries)];
    
    console.log('[OpenMeteo Geocoding] Trying queries:', queries);
    
    // Detect country from query to use appropriate country code
    const germanCities = ['berlin', 'munich', 'münchen', 'hamburg', 'cologne', 'köln', 'frankfurt', 'stuttgart', 'düsseldorf', 'dortmund', 'essen', 'leipzig', 'bremen', 'dresden', 'hanover', 'hannover', 'nuremberg', 'nürnberg', 'duisburg', 'bochum', 'wuppertal', 'bielefeld', 'mannheim', 'bonn', 'gelsenkirchen', 'münster', 'monchengladbach', 'braunschweig', 'chemnitz', 'kiel', 'augsburg', 'wiesbaden', 'kassel', 'krefeld', 'halle', 'magdeburg', 'freiburg', 'oberhausen', 'lübeck', 'erfurt', 'rostock', 'potsdam', 'saarbrücken', 'mainz', 'ludwigshafen', 'oldenburg', 'leverkusen', 'osnabrück', 'solingen', 'heidelberg', 'darmstadt', 'paderborn', 'regensburg', 'ingolstadt', 'wolfsburg', 'heilbronn', 'ulm', 'wurzburg', 'reutlingen', 'koblenz', 'bremerhaven', 'bamberg', 'landshut', 'passau', 'hof', 'neubrandenburg', 'schwerin', 'greifswald', 'stralsund', 'neumunster', 'neumünster'];
    const bulgarianCities = ['софия', 'пловдив', 'варна', 'бургас', 'русе', 'старазагора', 'плевен', 'сливен', 'добрич', 'шумен', 'перник', 'ямбол', 'хасково', 'пазарджик', 'благоевград', 'великотърново', 'видин', 'монтана', 'гърбово', 'казанлък', 'димитровград', 'кърджали', 'любимец', 'свищов', 'травя', 'черноморец', 'созопол', 'несебър', 'балчик', 'каварна', 'шумна', 'търговище', 'разград', 'силистра', 'карлово', 'козлодуй', 'свиленград', 'първомай', 'септември', 'стамболийски', 'хисаря', 'раковски', 'сапарева баня'];
    
    let isGerman = false;
    let isBulgarian = false;
    
    for (const city of germanCities) {
      if (lowerQuery.includes(city)) {
        isGerman = true;
        break;
      }
    }
    for (const city of bulgarianCities) {
      if (lowerQuery.includes(city)) {
        isBulgarian = true;
        break;
      }
    }
    
    // Determine country codes to try
    let countryCodes = [];
    if (isGerman && !isBulgarian) {
      countryCodes = ['DE'];
    } else if (isBulgarian && !isGerman) {
      countryCodes = ['BG'];
    } else {
      // Try both separately
      countryCodes = ['DE', 'BG'];
    }
    
    for (const q of queries) {
      for (const countryCode of countryCodes) {
        const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
        url.searchParams.set('name', q);
        url.searchParams.set('count', '5');
        url.searchParams.set('language', 'en');  // Use English for better results
        url.searchParams.set('countryCode', countryCode);
        // Add cache-busting timestamp to avoid service worker caching
        url.searchParams.set('_t', Date.now().toString());
        
        try {
          console.log('[OpenMeteo Geocoding] Fetching:', url.toString());
          const response = await this._throttle(() => globalThis.fetch(url));
          console.log('[OpenMeteo Geocoding] Response status:', response.status);
          const data = await response.json();
          
          if (!data.results || !data.results.length) {
            console.log('[OpenMeteo Geocoding] No results for query:', q, 'with countryCode:', countryCode);
            continue;
          }
          
          // Prefer result matching postal code from query
          const pcMatch2 = q.match(/^(\d{4,5})/);
          const postalCode = pcMatch2 ? pcMatch2[1] : null;
          let best = data.results[0];
          if (postalCode) {
            const pcResult = data.results.find(r => r.postcodes && r.postcodes.includes(postalCode));
            if (pcResult) best = pcResult;
          }
          const r = best;
          return {
            lat: parseFloat(r.latitude),
            lon: parseFloat(r.longitude),
            displayName: r.name || null,
            address: r.name || q,
            confidence: 0.8 // lower confidence for city-level
          };
        } catch (error) {
          console.error('[OpenMeteo Geocoding] Error for query:', q, error);
          continue;
        }
      }
    }
    
    // German fallback - try "Berlin", "Berlin, Germany", "Germany" as last resort
    if (lowerQuery.includes('берлин') || lowerQuery.includes('berlin') || lowerQuery.includes('гermany') || lowerQuery.includes('germany') || lowerQuery.includes('деutchland')) {
      console.log('[OpenMeteo Geocoding] Trying German fallback queries');
      const germanFallbackQueries = ['Berlin', 'Berlin, Germany', 'Germany', 'Deutschland'];
      for (const fallbackQuery of germanFallbackQueries) {
        try {
          const fallbackUrl = new URL('https://geocoding-api.open-meteo.com/v1/search');
          fallbackUrl.searchParams.set('name', fallbackQuery);
          fallbackUrl.searchParams.set('count', '5');
          fallbackUrl.searchParams.set('language', 'en');
          fallbackUrl.searchParams.set('countryCode', 'DE');
          // Add cache-busting timestamp
          fallbackUrl.searchParams.set('_t', Date.now().toString());
          
          const fallbackResponse = await this._throttle(() => globalThis.fetch(fallbackUrl));
          const fallbackData = await fallbackResponse.json();
          
          if (fallbackData.results && fallbackData.results.length) {
            const r = fallbackData.results[0];
            return {
              lat: parseFloat(r.latitude),
              lon: parseFloat(r.longitude),
              displayName: r.name || null,
              address: r.name || fallbackQuery,
              confidence: 0.7
            };
          }
        } catch (fallbackError) {
          console.error('[OpenMeteo Geocoding] German fallback error:', fallbackError);
        }
      }
    }
    
    console.log('[OpenMeteo Geocoding] All queries failed for:', query);
    return null;
  }

  // -------------------------------------------------------------------------
  // 2. GET WEATHER (lat/lon + date + optional time → temperature/humidity)
  // -------------------------------------------------------------------------

  async getWeather(lat, lon, date, time = null) {
    // date = "YYYY-MM-DD"
    // time = "HH:MM" (optional, defaults to 12:00)

    if (!isFinite(lat) || !isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

    const isPast = new Date(date) < new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const base = isPast 
      ? 'https://archive-api.open-meteo.com/v1/archive'
      : 'https://api.open-meteo.com/v1/forecast';
  
    const url = new URL(base);
    url.searchParams.set('latitude', String(lat));
    url.searchParams.set('longitude', String(lon));
    url.searchParams.set('start_date', date);
    url.searchParams.set('end_date', date);
    url.searchParams.set('hourly', 'temperature_2m,relative_humidity_2m');
    url.searchParams.set('timezone', 'auto');
  
    try {
      const response = await this._throttle(() => globalThis.fetch(url));
      const data = await response.json();
      if (!data.hourly || !data.hourly.time || !data.hourly.temperature_2m) return null;
  
      // Find hour closest to requested time (default 12:00)
      const targetHour = time ? parseInt(time.match(/(\d{1,2}):/)?.[1] ?? '12') : 12;
      let bestIdx = 0, bestDiff = Infinity;
      for (let i = 0; i < data.hourly.time.length; i++) {
        const hour = new Date(data.hourly.time[i]).getHours();
        const diff = Math.abs(hour - targetHour);
        if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
      }
  
      const temp = data.hourly.temperature_2m[bestIdx];
      const hum = data.hourly.relative_humidity_2m?.[bestIdx] ?? null;
      if (!isFinite(temp)) return null;
      
      // Temperature rounded to integer (per spec)
      return { 
        temp: Math.round(temp), 
        humidity: hum !== null && isFinite(hum) ? Math.round(hum) : null 
      };
    } catch {
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // 3. ENRICH FIELD (binding → target fields)
  // -------------------------------------------------------------------------

  async enrichField(binding, context) {
    // binding = { 
    //   sourceField: "addressFieldId",           // single source (legacy)
    //   sourceFields: [                          // OR multiple sources with extraction
    //     { fieldId: "streetFieldId" },
    //     { fieldId: "cityFieldId", delimiters: [" "], part: 0 },
    //     { fieldId: "postalFieldId" }
    //   ],
    //   separator: " ",                          // join with space
    //   targetFields: ["tempFieldId", "humidityFieldId", "latFieldId", "lonFieldId"],
    //   enricherType: "geo-weather",
    //   roleMap: { "tempFieldId": "temp", "humidityFieldId": "humidity", ... },
    //   dateField: "dateFieldId",
    //   timeField: "timeFieldId" 
    // }
    // context = {
    //   template,
    //   state: { fieldValues, provenance },
    //   fieldsById: { fieldId: fieldDef },
    //   getFieldValue: (fid) => state.fieldValues[fid],
    //   addressOverride: "optional pre-validated address string"
    // }

    const warnings = [];

    // Build source value
    let sourceValue;
    if (context.addressOverride) {
      sourceValue = context.addressOverride;
    } else if (binding.sourceFields && Array.isArray(binding.sourceFields)) {
      const parts = [];
      for (const src of binding.sourceFields) {
        const raw = context.getFieldValue(src.fieldId);
        if (!raw || raw === '' || raw === '--') continue;
        if (src.delimiters && src.delimiters.length > 0) {
          let extracted = null;
          for (const delim of src.delimiters) {
            const actualDelim = delim === '' || delim === 'whitespace' ? ' ' : String(delim);
            const rawParts = String(raw).split(actualDelim).map(p => p.trim()).filter(p => p !== '');
            if (rawParts.length > (src.part ?? 0)) {
              extracted = rawParts[src.part ?? 0];
              break;
            }
          }
          if (extracted) parts.push(extracted);
        } else {
          parts.push(String(raw).trim());
        }
      }
      sourceValue = parts.join(binding.separator || ' ');
    } else {
      sourceValue = context.getFieldValue(binding.sourceField);
    }

    if (!sourceValue || sourceValue === '' || sourceValue === '--') {
      return { values: {}, provenance: 'enrichment', confidence: 0, warnings: ['NO_SOURCE_VALUE'] };
    }

    // Resolve location
    const location = await this.resolveLocation(sourceValue);
    if (!location) {
      return { values: {}, provenance: 'enrichment', confidence: 0, warnings: ['GEOCODE_FAILED'] };
    }

    const values = {};
    const roleMap = binding.roleMap ?? {};

    // Write geo fields per roleMap/inferRole
    for (const fieldId of binding.targetFields) {
      const role = roleMap[fieldId] ?? inferRole(fieldId);
      let value = null;
      switch (role) {
        case 'lat':
        case 'fullGps':
          value = location.lat;
          break;
        case 'lon':
          value = location.lon;
          break;
        case 'address':
          value = location.address;
          break;
        case 'displayName':
          value = location.displayName;
          break;
      }
      if (value !== null) values[fieldId] = value;
    }

    // Weather lookup if any target needs temp/humidity
    const needsWeather = binding.targetFields.some(fid => {
      const role = roleMap[fid] ?? inferRole(fid);
      return role === 'temp' || role === 'humidity';
    });

    if (needsWeather) {
      let dateValue = null;
      if (binding.dateField) {
        dateValue = context.getFieldValue(binding.dateField);
      } else if (context.fieldsById) {
        // Auto-detect first date-type field
        for (const [, field] of Object.entries(context.fieldsById)) {
          if (field.type === 'date') {
            dateValue = context.getFieldValue(field.id);
            if (dateValue) break;
          }
        }
      }

      let timeValue = null;
      if (binding.timeField) {
        timeValue = context.getFieldValue(binding.timeField);
      }

      if (dateValue && /^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
        const weather = await this.getWeather(location.lat, location.lon, dateValue, timeValue);
        if (weather) {
          for (const fieldId of binding.targetFields) {
            const role = roleMap[fieldId] ?? inferRole(fieldId);
            if (role === 'temp' && weather.temp !== undefined) values[fieldId] = weather.temp;
            else if (role === 'humidity' && weather.humidity !== null) values[fieldId] = weather.humidity;
          }
        }
      }
    }

    return {
      values,
      provenance: 'enrichment',
      confidence: location.confidence,
      warnings,
      location: { lat: location.lat, lon: location.lon }
    };
  }

  // -------------------------------------------------------------------------
  // 4. RUN ENRICHMENT PASS (all bindings)
  // -------------------------------------------------------------------------

  async runEnrichmentPass({ template, state, bindings, options = {} }) {
    const context = {
      template,
      state,
      fieldsById: Object.fromEntries(template.pages.flatMap(p => p.fields).map(f => [f.id, f])),
      getFieldValue: (fieldId) => state.fieldValues?.[fieldId]
    };

    const enrichedValues = {};
    const enrichedProvenance = {};
    const allWarnings = [];

    for (const binding of bindings) {
      const result = await this.enrichField(binding, context);
      allWarnings.push(...result.warnings);
      for (const [fieldId, value] of Object.entries(result.values)) {
        enrichedValues[fieldId] = value;
        enrichedProvenance[fieldId] = result.provenance;
      }
    }

    return {
      values: enrichedValues,
      provenance: enrichedProvenance,
      warnings: allWarnings,
      ok: allWarnings.filter(w => w === 'GEOCODE_FAILED').length === 0
    };
  }
}

// -------------------------------------------------------------------------
// 5. COLLECT BINDINGS FROM TEMPLATE
// -------------------------------------------------------------------------

/** Extract bindings from template (template-level OR per-field) */
export function collectBindings(template) {
  // Style 1: Template-level enrichmentBindings array
  if (template.enrichmentBindings && Array.isArray(template.enrichmentBindings)) {
    return template.enrichmentBindings;
  }
  // Style 2: Per-field enrichment config
  const bindings = [];
  for (const page of template.pages) {
    for (const field of page.fields) {
      if (field.enrichment && field.enrichment.enricherType === 'geo-weather') {
        bindings.push({
          sourceField: field.enrichment.sourceField,
          sourceFields: field.enrichment.sourceFields,
          separator: field.enrichment.separator,
          targetFields: field.enrichment.targetFields,
          enricherType: field.enrichment.enricherType,
          roleMap: field.enrichment.roleMap,
          dateField: field.enrichment.dateField,
          timeField: field.enrichment.timeField
        });
      }
    }
  }
  return bindings;
}

// -------------------------------------------------------------------------
// 6. EXPORT ALL
// -------------------------------------------------------------------------

export default GeoWeatherEnricher;