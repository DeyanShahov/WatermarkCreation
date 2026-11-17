# Metadata Extraction Mechanism — DocumentAutomation & Image Coordinate

**Source Projects:**
- `D:\Projects\Image Cordinate` — Camera app with GPS, weather, watermark
- `D:\Projects\DocumentAutomation` — PDF form filler with multi-source ingestion, enrichment, validation

**Target Project:** `D:\Projects\WatermarkCreation` — Copy/paste this mechanism

> ⚠️ **Version 2.0 — COMPLETE** — Includes all critical missing pieces from audit (Netlify proxy, Enrichment Dialog, fullGps role, temperature rounding, empty-field-only rule, exact template structure, API response shapes, formatAddress, throttle, coordinate parsing, storage adapter).

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Core Data Model — IngestRecord](#core-data-model---ingestrecord)
3. [Provenance & Conflict Resolution](#provenance--conflict-resolution)
4. [Three-Tier Validation Pipeline](#three-tier-validation-pipeline)
5. [Geo-Weather Enrichment (Date + Time + Address → Temperature/Humidity)](#geo-weather-enrichment-date--time--address--temperaturehumidity)
6. [Netlify Geocode Proxy (REQUIRED for street-level geocoding)](#netlify-geocode-proxy-required-for-street-level-geocoding)
7. [Enrichment Dialog — How Users Configure Bindings](#enrichment-dialog--how-users-configure-bindings)
8. [Special Roles & Apply-Time Rules](#special-roles--apply-time-rules)
9. [AI Extraction (LLM-based document parsing)](#ai-extraction-llm-based-document-parsing)
10. [API/Excel Import (JsonPath + column mapping)](#apixcel-import-jsonpath--column-mapping)
11. [Calculated Fields (Expressions with dependency graph)](#calculated-fields-expressions-with-dependency-graph)
12. [Linked Fields & Affix Round-Trip](#linked-fields--affix-round-trip)
13. [Image Coordinate: Weather Fetch & Watermark Burn](#image-coordinate-weather-fetch--watermark-burn)
14. [Exact Template Structure](#exact-template-structure)
15. [API Response Shapes (for testing/mocking)](#api-response-shapes-for-testingmocking)
16. [Integration Points for WatermarkCreation](#integration-points-for-watermarkcreation)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                      METADATA EXTRACTION PIPELINE                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  SOURCES                          PROCESSING                        │
│  ────────                         ──────────                        │
│  ┌──────────┐                     ┌─────────────────┐               │
│  │ Manual   │                     │  Normalize      │               │
│  │ Input    │────────────────────▶│  (per field type)               │
│  └──────────┘                     └────────┬────────┘               │
│  ┌──────────┐                              │                        │
│  │ Excel/CSV│──────────────────────────────┤                        │
│  └──────────┘                              ▼                        │
│  ┌──────────┐                     ┌─────────────────┐               │
│  │ API      │                     │  Tier 1         │               │
│  │ (JsonPath)────────────────────▶│  Schema & Type  │── Hard Block  │
│  └──────────┘                     └────────┬────────┘               │
│  ┌──────────┐                              │                        │
│  │ AI/LLM   │──────────────────────────────┤                        │
│  └──────────┘                              ▼                        │
│  ┌──────────┐                     ┌─────────────────┐               │
│  │ Geo-     │                     │  Tier 2         │               │
│  │ Weather  │────────────────────▶│  Business Rules │── Soft Block  │
│  │ Enrich   │                     └────────┬────────┘               │
│  └──────────┘                              │                        │
│  ┌──────────┐                              ▼                        │
│  │ Calc     │                     ┌─────────────────┐               │
│  │ Fields   │────────────────────▶│  Tier 3 (UI)    │── User Conf.  │
│  └──────────┘                     │  Confirmation   │               │
│                                   └────────┬────────┘               │
│                                            │                        │
│                                            ▼                        │
│                              ┌─────────────────────┐               │
│                              │  Merge into State   │               │
│                              │  (provenance-aware) │               │
│                              └─────────────────────┘               │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Key Files in DocumentAutomation:**
- `core/ingestion.js` — Pipeline runner, IngestRecord, provenance, merge
- `core/validation/tier1.js` — Schema & type validation (hard block)
- `core/validation/tier2.js` — Business rules, cross-field (soft block)
- `core/validation/normalize.js` — Type coercion per field type
- `core/enrichers/geo-weather-enricher.js` — **Core mechanism: Date+Time+Address → Weather**
- `core/importers/ai-extractor.js` — LLM-based extraction
- `core/importers/api-importer.js` — JsonPath + mapping
- `core/importers/excel-importer.js` — Excel parsing + column mapping
- `core/calc.js` — Expression parsing, evaluation, dependency graph
- `core/extract.js` — Partial field extraction (delimiters)
- `views/filler/enrichment-dialog.js` — **UI for configuring bindings + AI address validation**
- `netlify/functions/geocode.js` — **Nominatim proxy (REQUIRED for street-level geocoding)**

**Key Files in Image Coordinate:**
- `src/utils/weather.js` — `fetchWeather(lat, lon)` → `{temperature, humidity}`
- `src/modules/watermark.js` — `withWatermark(blob, {weather, fix, address, capturedAt})` — burns weather into pixels

---

## Core Data Model — IngestRecord

```javascript
// core/ingestion.js — createIngestRecord()
{
  templateId: "uuid",
  values: { fieldId: value },           // normalized, coerced values
  provenance: { fieldId: "source" },    // "manual" | "excel" | "api" | "ai" | "enrichment" | "ai-suggestion" | "calculated"
  verification: {
    tier1Passed: boolean,
    tier2Passed: boolean,
    tier3Passed: boolean,
    issues: [{ fieldId, severity: "error"|"warning", message }]
  },
  createdAt: "ISO timestamp"
}
```

**Provenance Priority (highest → lowest):**
```javascript
PROVENANCE_PRIORITY = [
  'manual',        // user typed it — never overwritten
  'api',           // external API
  'excel',         // imported spreadsheet
  'ai',            // LLM extraction
  'enrichment',    // geo-weather auto-fill
  'ai-suggestion', // LLM suggestions for empty fields
  'calculated'     // computed from other fields
]
```

---

## Provenance & Conflict Resolution

```javascript
// core/ingestion.js — applyConflictPolicy()
function applyConflictPolicy(fieldId, currentValue, currentProv, incomingValue, incomingProv, policy) {
  // 1. No current value → take incoming
  // 2. No incoming value → keep current
  // 3. Both exist → CONFLICT → resolve by policy:
  
  switch (policy) {
    case 'manual-wins':     // DEFAULT
      // manual provenance NEVER overwritten
      if (currentProv === 'manual') return current;
      if (incomingProv === 'manual') return incoming;
      // neither manual → incoming wins
      return incoming;
      
    case 'incoming-wins':
      return incoming;
      
    case 'priority':
      // Lower index in PROVENANCE_PRIORITY = higher priority
      return (provenanceRank(incomingProv) < provenanceRank(currentProv)) ? incoming : current;
  }
}
```

**Usage:** Called during `mergeRecords()` and inside `runIngestionPipeline()` when merging validated incoming values with existing state.

---

## Three-Tier Validation Pipeline

### Tier 1 — Schema & Type (HARD BLOCK)
```javascript
// core/validation/tier1.js — validateTier1(template, values, options)
Errors = [
  { fieldId, code: 'REQUIRED_MISSING', message },
  { fieldId, code: 'TYPE_MISMATCH', message },
  { fieldId, code: 'INVALID_DATE', message },           // must be YYYY-MM-DD
  { fieldId, code: 'INVALID_COORD', message },          // decimal or DMS
  { fieldId, code: 'OUT_OF_RANGE', message },           // number min/max
  { fieldId, code: 'MAX_LENGTH_EXCEEDED', message },
  { fieldId, code: 'INVALID_COLOR', message },          // must be in COLOR_PALETTE (22 German abbrevs)
  { fieldId, code: 'INVALID_SELECT_OPTION', message }   // must be in validation.options
]
```
**Returns:** `{ ok: boolean, errors: Error[] }` — if `!ok`, pipeline stops.

### Tier 2 — Business Rules (SOFT BLOCK → Tier 3 UI)
```javascript
// core/validation/tier2.js — validateTier2(template, values, options)
Warnings = [
  { fieldId, code: 'LINKED_MISMATCH', message },           // linked fields differ
  { fieldId, code: 'CALC_MISMATCH', message },             // computed ≠ proposed
  { fieldId, code: 'AFFIX_MISMATCH', message },            // prefix/suffix mismatch
  { fieldId, code: 'INVALID_COLOR_ENUM', message },
  { fieldId, code: 'SOURCE_NOT_ALLOWED", message },        // field.allowedSources violated
  { fieldId, code: 'CUSTOM_RULE_VIOLATION', message }      // template.validationRules
]
```
**Returns:** `{ ok: boolean, warnings: Warning[] }` — if `warnings.length > 0`, triggers Tier 3 confirmation dialog.

### Tier 3 — User Confirmation (UI)
```javascript
// core/ingestion.js — buildTier3Payload() → rows for dialog
{ fieldId, label, current, proposed, source, confidence, conflict }
```
User accepts/rejects per field → `confirmTier3Application()` merges accepted into state.

---

## Geo-Weather Enrichment (Date + Time + Address → Temperature/Humidity)

**This is the core mechanism you want to copy.**

### Entry Point
```javascript
// core/enrichers/geo-weather-enricher.js
class GeoWeatherEnricher {
  constructor(options = {}) {
    this.fetch = options.fetch ?? globalThis.fetch;
    this.userAgent = options.userAgent ?? 'DocumentAutomation/1.0';
    this.minIntervalMs = options.minIntervalMs ?? 1000;  // throttle
    this.nominatimProxyUrl = options.nominatimProxyUrl ?? '/.netlify/functions/geocode';
    this._throttle = createThrottle(this.minIntervalMs, this.now, options.delay);
  }
}
```

### 1. Resolve Location (Address → lat/lon)
```javascript
async resolveLocation(query) {
  // query = "91322 Gräfenberg, Jahnstraße 6"  OR  "42.6977, 23.3219"  OR  {lat, lon}
  
  // A) Already coordinates?
  if (typeof query === 'object' && query.lat && query.lon) return { ...query, confidence: 1 };
  
  // B) Parse coordinate string (decimal or DMS)
  const parsed = parseCoordinate(query);
  if (parsed) return { ...parsed, confidence: 1 };
  
  // C) Netlify Nominatim proxy (street-level, avoids CORS)
  if (this.nominatimProxyUrl) {
    const result = await this._resolveViaNominatimProxy(query);
    if (result) return result;
  }
  
  // D) Fallback: Open-Meteo geocoding (city-level, DE-biased)
  const queries = [query];
  // Add postal+city, city-only, pre-comma variants
  const pcMatch = query.match(/^(\d{4,5})\s+([A-Za-zäöüÄÖÜß\-]+)/);
  if (pcMatch) {
    queries.push(`${pcMatch[1]} ${pcMatch[2]}`);  // "91322 Gräfenberg"
    queries.push(pcMatch[2]);                     // "Gräfenberg"
  }
  queries.push(query.split(',')[0].trim());       // before comma
  
  for (const q of queries) {
    const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
    url.searchParams.set('name', q);
    url.searchParams.set('count', '5');
    url.searchParams.set('language', 'de');
    url.searchParams.set('countryCode', 'DE');
    const response = await this._throttle(() => this.fetch(url));
    const data = await response.json();
    if (!data.results || !data.results.length) continue;
    
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
      confidence: 1.0
    };
  }
  return null;
}
```

### 2. `_resolveViaNominatimProxy` (street-level geocoding)
```javascript
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
```

### 3. Get Weather (lat/lon + date + optional time → temperature/humidity)
```javascript
async getWeather(lat, lon, date, time = null) {
  // date = "YYYY-MM-DD"
  // time = "HH:MM" (optional, defaults to 12:00)
  
  // Validate inputs
  if (!isFinite(lat) || !isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const isPast = new Date(date) < new Date(Date.now() - 7*24*60*60*1000);
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
  
  const response = await this._throttle(() => this.fetch(url));
  const data = await response.json();
  if (!data.hourly || !data.hourly.time || !data.hourly.temperature_2m) return null;
  
  // Find hour closest to requested time (default 12:00)
  const targetHour = time ? parseInt(time.match(/(\d{1,2}):/)[1]) : 12;
  let bestIdx = 0, bestDiff = Infinity;
  for (let i = 0; i < data.hourly.time.length; i++) {
    const hour = new Date(data.hourly.time[i]).getHours();
    const diff = Math.abs(hour - targetHour);
    if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
  }
  
  const temp = data.hourly.temperature_2m[bestIdx];
  const hum = data.hourly.relative_humidity_2m?.[bestIdx] ?? null;
  if (!isFinite(temp)) return null;
  return { temp, humidity: hum !== null && isFinite(hum) ? hum : null };
}
```

### 4. Enrich Field (binding → target fields)
```javascript
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
```

### 5. Role Inference (auto-map fieldId → role)
```javascript
function inferRole(fieldId) {
  const id = fieldId.toLowerCase();
  if (id.includes('lat') || id.includes('latitude')) return 'lat';
  if (id.includes('lon') || id.includes('longitude') || id.includes('lng')) return 'lon';
  if (id.includes('temp') || id.includes('temperature')) return 'temp';
  if (id.includes('humid')) return 'humidity';
  if (id.includes('address') || id.includes('addr')) return 'address';
  if (id.includes('display') || id.includes('name') || id.includes('place')) return 'displayName';
  return null;
}
```

### 6. Run Enrichment Pass (all bindings)
```javascript
// core/enrichers/geo-weather-enricher.js — runEnrichmentPass()
export async function runEnrichmentPass({ template, state, bindings, enricher, options }) {
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
    const result = await enricher.enrichField(binding, context);
    allWarnings.push(...result.warnings);
    for (const [fieldId, value] of Object.entries(result.values)) {
      enrichedValues[fieldId] = value;
      enrichedProvenance[fieldId] = result.provenance;
    }
  }
  
  // Feed into ingestion pipeline (Tier 1 → Tier 2 → Tier 3)
  const incoming = { values: enrichedValues, provenance: enrichedProvenance, source: 'enrichment' };
  const _result = runIngestionPipeline({ template, incoming, state, options });
  _result.warnings = allWarnings;
  return _result;
}
```

### 7. Collect Bindings from Template
```javascript
// Two configuration styles supported:
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
          targetFields: field.enrichment.targetFields,
          enricherType: field.enrichment.enricherType,
          roleMap: field.enrichment.roleMap,
          dateField: field.enrichment.dateField
        });
      }
    }
  }
  return bindings;
}
```

### 8. Throttle Implementation (testable)
```javascript
// core/enrichers/geo-weather-enricher.js lines 138-149
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
```
**Usage:** `this._throttle = createThrottle(this.minIntervalMs, this.now, options.delay);` — default 1000ms between API calls.

### 9. Coordinate Parsing (parseCoordinate)
```javascript
// Handles:
'42.6977, 23.3219'          → { lat: 42.6977, lon: 23.3219 }
'42.6977,23.3219'           → { lat: 42.6977, lon: 23.3219 }  (no space)
'-33.8688, 151.2093'        → { lat: -33.8688, lon: 151.2093 } (negative)
"42°41'52\"N 23°19'19\"E"    → { lat: 42.6977, lon: 23.3219 }  (DMS)
"42°41'52\"N, 23°19'19\"E"   → { lat: 42.6977, lon: 23.3219 }  (DMS with comma)

Returns null for: out of range (>90, >180), invalid strings, null/undefined
```

### 10. Format Address (Nominatim → readable string)
```javascript
// core/enrichers/geo-weather-enricher.js lines 60-75
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
```

---

## Netlify Geocode Proxy (REQUIRED for street-level geocoding)

**File:** `D:\Projects\DocumentAutomation\netlify\functions\geocode.js` — **COPY THIS ENTIRELY**

```javascript
// netlify/functions/geocode.js — Netlify Function proxy for Nominatim geocoding
// Solves CORS + User-Agent issues when calling Nominatim from the browser

export const handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Accept'
      },
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return { 
      statusCode: 405, 
      headers: { 'Access-Control-Allow-Origin': '*' }, 
      body: JSON.stringify({ error: 'Method not allowed' }) 
    };
  }

  let address;
  try {
    const body = JSON.parse(event.body || '{}');
    address = body.address;
  } catch {
    return { 
      statusCode: 400, 
      headers: { 'Access-Control-Allow-Origin': '*' }, 
      body: JSON.stringify({ error: 'Invalid JSON body' }) 
    };
  }

  if (!address || typeof address !== 'string' || address.trim() === '') {
    return { 
      statusCode: 400, 
      headers: { 'Access-Control-Allow-Origin': '*' }, 
      body: JSON.stringify({ error: 'Address required' }) 
    };
  }

  const userAgent = process.env.NOMINATIM_USER_AGENT || 'Mozilla/5.0 (compatible; DocumentAutomation/1.0; +https://documentautomation.netlify.app/)';

  try {
    // Try multiple query variations for better Nominatim matching
    const queries = [
      address.trim(),
      address.trim().replace(/straße/gi, 'str.'),
      address.trim().replace(/straße/gi, 'str'),
      address.trim().replace(/, /g, ' ')
    ];

    for (const q of queries) {
      // Small delay to respect Nominatim rate limit (1 req/sec)
      await new Promise(resolve => setTimeout(resolve, 1100));

      const url = new URL('https://nominatim.openstreetmap.org/search');
      url.searchParams.set('q', q);
      url.searchParams.set('format', 'jsonv2');
      url.searchParams.set('limit', '1');
      url.searchParams.set('addressdetails', '1');
      url.searchParams.set('countrycodes', 'de');

      const response = await fetch(url.toString(), {
        headers: {
          'User-Agent': userAgent,
          'Accept': 'application/json',
          'Referer': 'https://documentautomation.netlify.app/'
        }
      });

      if (!response.ok) continue;

      const data = await response.json();
      if (!Array.isArray(data) || data.length === 0) continue;

      const r = data[0];
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({
          lat: parseFloat(r.lat),
          lon: parseFloat(r.lon),
          displayName: r.display_name ?? null,
          address: r.display_name ?? address.trim()
        })
      };
    }

    return { 
      statusCode: 404, 
      headers: { 'Access-Control-Allow-Origin': '*' }, 
      body: JSON.stringify({ error: 'No results' }) 
    };
  } catch (err) {
    return { 
      statusCode: 500, 
      headers: { 'Access-Control-Allow-Origin': '*' }, 
      body: JSON.stringify({ error: err.message }) 
    };
  }
};
```

**Why this is critical:**
- Browser **cannot** call Nominatim directly (CORS + User-Agent policy)
- Tries 4 query variations for German addresses (`straße` → `str.` / `str`, comma removal)
- Rate-limits to 1 req/sec (respects Nominatim policy)
- Returns clean JSON: `{ lat, lon, displayName, address }`
- **Without this, only city-level geocoding works (Open-Meteo fallback)**

---

## Enrichment Dialog — How Users Configure Bindings

**File:** `D:\Projects\DocumentAutomation\views\filler\enrichment-dialog.js` — Full UI for binding configuration

### User Flow:
1. **Click "Enrich" button** → opens modal dialog
2. **Configure AI (optional):** API Key, Model, Endpoint, Prompt (for address correction)
3. **Add Source Fields:** Multiple rows, each with:
   - Field dropdown (all template fields)
   - Delimiters (comma-separated, e.g. `,`, ` `, `whitespace`)
   - Part index (0-based, which split part to use)
4. **Select Date/Time Fields:** Dropdowns for weather lookup
5. **Add Target Fields:** Multiple rows, each with:
   - Field dropdown
   - Role dropdown: `lat`, `lon`, `address`, `displayName`, `temp`, `humidity`, `fullGps`
6. **Click "🤖 Validate address with AI"** (optional) → LLM corrects German street names
7. **Click "▶️ Enrich"** → calls `GeoWeatherEnricher.enrichField()` with binding
8. **Preview Results** → shows GPS (decimal + DMS), temp (rounded), humidity, warnings
9. **Click "✅ Apply to form"** → writes to `state.fieldValues` with `provenance = 'enrichment'`

### Key UI → Binding Mapping:
```javascript
// Source fields collected as:
{ fieldId, delimiters: ["", " "], part: 0 }

// Target fields collected as:
{ fieldId, role: "lat" | "lon" | "address" | "displayName" | "temp" | "humidity" | "fullGps" }

// Binding passed to enrichField():
const binding = {
  sourceFields: collectSourceFields(srcContainer),  // array of {fieldId, delimiters, part}
  targetFields: collectTargetFields(tgtContainer),  // array of fieldId
  enricherType: 'geo-weather',
  roleMap: collectRoleMap(tgtContainer),            // { fieldId: role }
  dateField: dateSelect.value || undefined,
  timeField: timeSelect.value || undefined,
  separator: ' '
};

// Called with addressOverride if AI validation happened:
const result = await enricher.enrichField(binding, {
  template,
  state: fillerState,
  fieldsById,
  getFieldValue: (fid) => fillerState.fieldValues[fid],
  addressOverride: validatedAddress || undefined  // ← AI-corrected address
});
```

### AI Address Validation Prompt (German-optimized):
```javascript
const DEFAULT_PROMPT = `You are an address validator for German addresses within 200km of Nuremberg.
Correct ANY spelling mistakes in the address, especially street names. Common errors:
- Missing or wrong letters in street names (e.g. "Schreckenbacherstr." should be "Schreckenbachstraße" or "Schreckenbachstr.")
- "str." or "str" should be "straße" or "str."
- Wrong umlauts or special characters
Return ONLY the corrected full address in this EXACT format: "StreetName StreetNumber, PostalCode CityName"
Do NOT put postal code before city. Always put street first, then postal code and city.
If the address is already correct, return it unchanged in the same format.
Example: "91541 Rothenburg, Schreckenbacherstr. 4" -> "Schreckenbachstraße 4, 91541 Rothenburg ob der Tauber"
Example: "91322 Graefenberg, Jahn 6" -> "Jahnstraße 6, 91322 Gräfenberg"`;
```

---

## Special Roles & Apply-Time Rules

### 1. `fullGps` Role — Combined GPS in ONE Field
```javascript
// In enrichment-dialog.js apply logic:
const roleMap = collectRoleMap(tgtContainer);
const gpsFieldEntry = Object.entries(roleMap).find(([fid, r]) => r === 'lat' || r === 'lon');
const gpsFieldId = gpsFieldEntry ? gpsFieldEntry[0] : null;
const gpsCombined = (loc.lat !== undefined && loc.lon !== undefined) 
  ? `${loc.lat}, ${loc.lon}  /  ${toDMS(loc.lat, true)}, ${toDMS(loc.lon, false)}`
  : null;

// When role === 'fullGps', write combined string:
if (role === 'fullGps' && gpsCombined) {
  finalValue = gpsCombined;
}

// SKIP the other GPS field to avoid duplication:
if (role === 'lon' && gpsFieldId && gpsFieldId !== fieldId) {
  continue; // skip
}
```

### 2. Temperature ROUNDING (Integer Only)
```javascript
// At display time:
if (role === 'temp') displayVal = Math.round(val);

// At apply time:
if (role === 'temp') finalValue = Math.round(value);

// Raw float from API (e.g. 24.3) → stored/displayed as integer (24)
```

### 3. "Only Empty Fields Get Filled" (Provenance Respect)
```javascript
// In enrichment-dialog.js apply click handler:
for (const [fieldId, value] of Object.entries(enrichmentResult.values)) {
  const current = fillerState.fieldValues?.[fieldId];
  // Skip if already has value (manual/excel/api/ai/enrichment/ai-suggestion/calculated)
  if (current !== undefined && current !== null && current !== '' && current !== '--') {
    skipped.push(fieldId);
    continue; // Never overwrite!
  }
  // ... apply
}
```
**This is enforced at apply-time in the UI, not in the enricher itself.**

### 4. DMS Conversion for Display
```javascript
function toDMS(value, isLat) {
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
```

---

## AI Extraction (LLM-based document parsing)

```javascript
// core/importers/ai-extractor.js — extractFromFile(file, fieldDefs, config)
async function extractFromFile(file, fieldDefs, config) {
  // 1. Convert file to content
  const fileContent = await fileToContent(file);  // Excel→CSV, PDF→text, Image→base64
  
  // 2. Build prompt
  const prompt = buildExtractPrompt(fieldDefs, config.instructions);
  // "Extract fields: • \"Date\" (date) → \"field-1\", • \"Temperature\" (number) → \"field-2\""
  
  // 3. Call LLM API (Groq/OpenRouter/OpenAI-compatible)
  const messages = buildMessages(fileContent, prompt);
  const rawResponse = await callLLMAPI(messages, config);
  
  // 4. Parse & normalize
  const { values, provenance, source, warnings } = parseAIResponse(rawResponse, fieldDefs);
  // values = { "field-1": "2024-01-15", "field-2": 23.5 }
  // provenance = { "field-1": "ai", "field-2": "ai" }
  
  return { ok: true, values, provenance, source: 'ai', warnings };
}
```

**Prompt Builder** (`buildExtractPrompt`):
- Lists all fields with type hints (date→YYYY-MM-DD, colorPicker→RT/GN, etc.)
- Includes user instructions
- Returns strict JSON-only instruction

---

## API/Excel Import (JsonPath + Column Mapping)

### API Import (JsonPath)
```javascript
// core/importers/api-importer.js — mapJsonToRecords(payload, template, options)
const valuesData = extractByJsonPath(payload, '$.values');  // or custom path
// JsonPath subset: $ .key [n] [*] .. (recursive descent)

const { records, warnings } = mapJsonToRecords(payload, template, {
  jsonPath: '$.values',
  provenance: 'api',
  instancePath: '$.instances[*]'  // for batch
});
```

### Excel Import (Column Mapping)
```javascript
// core/importers/excel-importer.js
const workbook = parseWorkbook(arrayBuffer);  // handles merged cells, shared headers
const sheet = readSheet(workbook, sheetName);
const mapping = mapColumns(sheet.headers, templateFields, userMapping);
// Auto-matches by: exact label → exact name → substring label → substring name

const records = toIngestRecords({ rows: sheet.rows, mapping, template, provenance: 'excel' });
// Each row → IngestRecord → run through applyImportedValues()
```

---

## Calculated Fields (Expressions with Dependency Graph)

```javascript
// core/calc.js
field.calc = { enabled: true, expression: "fieldA + fieldB * 2" }

// Supported: + - * / ( )  — references by UUID, 8-char prefix, or field name
// Tokens resolved: exact ID > 8-char prefix > field name

// Tokenize → validate → evaluate (via new Function on sanitized tokens)
const result = evaluateExpression(expression, fields, valueOf);
// Returns { ok, value } where value = finalizeResult(raw)
// finalizeResult: NaN/Infinity → 0, round to 1e-6, Math.abs()

// Dependency graph for reactive recomputation:
const dependents = buildDependents(fields);  // fieldId → [calcFieldIds]
const order = topoCalcIds(fields);           // topological order (deps first)
const calculated = calculateValues(fields, fieldValues);  // Map<fieldId, number>

// Cycle detection:
const cycle = findCycle(fields);  // returns [id1, id2, ..., id1] or null
```

---

## Linked Fields & Affix Round-Trip

### Linked Fields (bidirectional sync)
```javascript
field.links = ["otherFieldId"];  // array of field IDs

// Tier 2 validation: validateTier2()
if (String(values[field.id]) !== String(values[target.id])) {
  warnings.push({ code: 'LINKED_MISMATCH', message: "Свързаните полета имат различни стойности" });
}
```

### Extract Rules (partial field copying)
```javascript
// core/extract.js — extractPart(text, delimiters, partIndex)
field.extract = [
  { source: "sourceFieldId", delimiters: [",", " "], part: 0, applyTo: "value" }
];
// "Sofia, Bulgaria" with delimiter "," part 0 → "Sofia"

// applyExtracts(state, sourceId, template) called on source field change
// Updates target field.value OR target field affix (prefix/suffix swapped)
```

### Affix Round-Trip (prefix/suffix validation)
```javascript
field.affix = { prefix: { text: "ID-" }, suffix: { text: "kg" } };

// Tier 2: validateTier2()
if (!value.startsWith(prefix.text)) → AFFIX_MISMATCH warning
if (!stripped.endsWith(suffix.text)) → AFFIX_MISMATCH warning
```

---

## Image Coordinate: Weather Fetch & Watermark Burn

### Weather Fetch (Open-Meteo Current)
```javascript
// src/utils/weather.js — fetchWeather(lat, lon)
const params = new URLSearchParams({
  latitude: String(lat),
  longitude: String(lon),
  current: 'temperature_2m,relative_humidity_2m',  // modern API (includes humidity)
  timezone: 'auto'
});
const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { signal });
const data = await response.json();
return {
  temperature: data.current?.temperature_2m ?? data.current_weather?.temperature,
  humidity: data.current?.relative_humidity_2m ?? data.current_weather?.relative_humidity,
  source: 'open-meteo'
};
```

### Watermark Burn (coordinates + address + weather → pixels)
```javascript
// src/modules/watermark.js — withWatermark(blob, { fix, address, capturedAt, weather, qrMatrix })
// 1. Decode image → canvas (maxEdge 4096px)
// 2. Build lines array:
//    - Decimal coords (large font)
//    - DMS coords (medium)
//    - Accuracy · Altitude · Timestamp (medium)
//    - Brand (small)
//    - Address (wrapped, 2 lines max, medium)
//    - Weather: "🌡️ 23°C · 💧 65%" (medium)
// 3. Draw gradient panel at bottom
// 4. Draw text with shadow
// 5. Optional QR code (Google Maps link) in bottom-right of panel
// 6. Encode to JPEG (quality 0.92)
```

**Key Integration Point:** In `main.js` `processPhoto()`:
```javascript
const weatherPromise = hasFix ? fetchWeather(fix.latitude, fix.longitude) : Promise.resolve(null);
// ... watermark generation runs in parallel ...
weather = await weatherPromise;  // awaited before EXIF write
const stamped = await watermark.withWatermark(photo, { fix, address, capturedAt, qrMatrix, weather });
```

---

## Exact Template Structure

**Required for enrichment to work:**

```javascript
{
  id: 'template-uuid',
  name: 'Template Name',
  pages: [{
    pageNumber: 1,
    fields: [
      // SOURCE: Address field (type: text)
      { 
        id: 'address', 
        label: 'Адрес', 
        name: 'address', 
        type: 'text', 
        required: false 
      },
      // OPTIONAL: Street/City/Postal as separate fields (for multi-source binding)
      { 
        id: 'street', 
        label: 'Улица', 
        name: 'street', 
        type: 'text', 
        required: false 
      },
      { 
        id: 'city', 
        label: 'Град', 
        name: 'city', 
        type: 'text', 
        required: false 
      },
      { 
        id: 'postal', 
        label: 'Пощенски код', 
        name: 'postal', 
        type: 'text', 
        required: false 
      },
      
      // TARGET: GPS fields (type: number)
      { 
        id: 'lat', 
        label: 'Latitude', 
        name: 'lat', 
        type: 'number', 
        required: false 
      },
      { 
        id: 'lon', 
        label: 'Longitude', 
        name: 'lon', 
        type: 'number', 
        required: false 
      },
      // OR single combined GPS field:
      { 
        id: 'gps', 
        label: 'GPS Coordinates', 
        name: 'gps', 
        type: 'text', 
        required: false 
      },
      
      // TARGET: Weather fields (type: number)
      { 
        id: 'temperature', 
        label: 'Temperature (°C)', 
        name: 'temperature', 
        type: 'number', 
        required: false 
      },
      { 
        id: 'humidity', 
        label: 'Humidity (%)', 
        name: 'humidity', 
        type: 'number', 
        required: false 
      },
      
      // TARGET: Display name (type: text)
      { 
        id: 'displayName', 
        label: 'Location Name', 
        name: 'displayName', 
        type: 'text', 
        required: false 
      },
      
      // REQUIRED for weather: Date field (type: date → YYYY-MM-DD)
      { 
        id: 'dateField', 
        label: 'Date', 
        name: 'dateField', 
        type: 'date', 
        required: false 
      },
      
      // OPTIONAL for weather: Time field (type: text/time)
      { 
        id: 'timeField', 
        label: 'Time', 
        name: 'timeField', 
        type: 'text', 
        required: false 
      }
    ]
  }],
  
  // EITHER enrichmentBindings (template-level):
  enrichmentBindings: [{
    sourceField: 'address',
    targetFields: ['lat', 'lon', 'temperature', 'humidity', 'displayName'],
    enricherType: 'geo-weather',
    roleMap: {
      'lat': 'lat',
      'lon': 'lon',
      'temperature': 'temp',
      'humidity': 'humidity',
      'displayName': 'displayName'
    },
    dateField: 'dateField',
    timeField: 'timeField'
  }]
  // OR per-field enrichment config on individual fields
}
```

**Critical Requirements:**
- Fields MUST have `type` for normalization (`normalizeValue`)
- Date field MUST be `type: 'date'` (Tier 1 converts to YYYY-MM-DD)
- Target fields for GPS/weather should be `type: 'number'` (for proper coercion)
- `roleMap` is optional but recommended (otherwise `inferRole` uses fieldId matching)

---

## API Response Shapes (for testing/mocking)

### Open-Meteo Geocoding (`geocoding-api.open-meteo.com/v1/search`)
```json
{
  "results": [{
    "id": 727011,
    "name": "Sofia",
    "latitude": 42.6977,
    "longitude": 23.3219,
    "elevation": 550,
    "feature_code": "PPLC",
    "country_code": "BG",
    "timezone": "Europe/Sofia",
    "population": 1236047,
    "country": "Bulgaria",
    "admin1": "Sofia City",
    "postcodes": ["1000", "1111"]
  }]
}
```
**Note:** `postcodes` array used for postal code matching in enricher.

### Open-Meteo Forecast/Archive (`api.open-meteo.com/v1/forecast` / `archive-api.open-meteo.com/v1/archive`)
```json
{
  "latitude": 42.6977,
  "longitude": 23.3219,
  "generationtime_ms": 1.2,
  "utc_offset_seconds": 7200,
  "timezone": "Europe/Sofia",
  "timezone_abbreviation": "EET",
  "elevation": 550.0,
  "hourly_units": {
    "time": "iso8601",
    "temperature_2m": "°C",
    "relative_humidity_2m": "%"
  },
  "hourly": {
    "time": ["2024-06-15T00:00", "2024-06-15T12:00", "2024-06-15T18:00"],
    "temperature_2m": [18.5, 24.3, 22.1],
    "relative_humidity_2m": [65, 45, 55]
  }
}
```

### Nominatim (via Netlify proxy) — returns single object:
```json
{
  "lat": 42.6977,
  "lon": 23.3219,
  "displayName": "Vitosha Boulevard 10, Sofia, Bulgaria",
  "address": "Vitosha Boulevard 10, Sofia, Bulgaria"
}
```

---

## Integration Points for WatermarkCreation

### 1. Core Files to Copy (minimal set)
```
core/
├── ingestion.js           # IngestRecord, pipeline, provenance, merge
├── validation/
│   ├── normalize.js       # Type coercion (date, number, colorPicker, etc.)
│   ├── tier1.js           # Schema validation
│   └── tier2.js           # Business rules
├── enrichers/
│   └── geo-weather-enricher.js  # ★ CORE: Date+Time+Address → Weather
├── calc.js                # Expressions, dependency graph
├── extract.js             # Partial field extraction
├── utils.js               # uuid, COLOR_PALETTE, helpers
└── importers/
    └── ai-extractor.js    # Optional: LLM extraction

netlify/
└── functions/
    └── geocode.js         # ★ REQUIRED for street-level geocoding
```

### 2. GeoWeatherEnricher Configuration
```javascript
const enricher = new GeoWeatherEnricher({
  fetch: globalThis.fetch,
  userAgent: 'WatermarkCreation/1.0',
  minIntervalMs: 1000,           // throttle API calls
  nominatimProxyUrl: '/.netlify/functions/geocode',  // or null to disable
  // For testing:
  // now: () => Date.now(),
  // delay: (ms) => new Promise(r => setTimeout(r, ms))
});
```

### 3. Binding Configuration (in template)
```javascript
// Template enrichmentBindings array OR per-field enrichment config
const enrichmentBindings = [
  {
    sourceField: "addressFieldId",           // single source
    // OR multiple sources with extraction:
    sourceFields: [
      { fieldId: "streetFieldId" },
      { fieldId: "cityFieldId", delimiters: [" "], part: 0 },
      { fieldId: "postalFieldId" }
    ],
    separator: " ",                          // join with space
    targetFields: ["latField", "lonField", "tempField", "humidityField", "displayNameField"],
    enricherType: "geo-weather",
    roleMap: {
      "latField": "lat",
      "lonField": "lon", 
      "tempField": "temp",
      "humidityField": "humidity",
      "displayNameField": "displayName"
    },
    dateField: "dateFieldId",                // required for weather
    timeField: "timeFieldId"                 // optional, defaults to 12:00
  }
];
```

### 4. Running Enrichment
```javascript
// In your filler/app logic:
import { runEnrichmentPass, collectBindings } from './core/enrichers/geo-weather-enricher.js';
import { GeoWeatherEnricher } from './core/enrichers/geo-weather-enricher.js';

const enricher = new GeoWeatherEnricher({ /* options */ });
const bindings = collectBindings(template);  // reads template.enrichmentBindings or per-field

const result = await runEnrichmentPass({
  template,
  state: { fieldValues: currentValues, provenance: currentProvenance },
  bindings,
  enricher,
  options: { storage: yourStorageAdapter, conflictPolicy: 'manual-wins' }
});

// result = { ok, tier1, tier2, record, applied: string[], warnings?, tier3Payload? }
if (result.ok) {
  if (result.tier2.warnings?.length > 0) {
    // Show Tier 3 dialog with result.tier3Payload
  } else {
    // Auto-applied: result.record.values, result.record.provenance
  }
}
```

### 5. Weather Display in Watermark (Image Coordinate style)
```javascript
// After enrichment, you have: values.tempField, values.humidityField
// Use in your watermark renderer:
function renderWeatherLine(ctx, weather, x, y, fontSize) {
  if (!weather || !Number.isFinite(weather.temp) || !Number.isFinite(weather.humidity)) return;
  const text = `🌡️ ${Math.round(weather.temp)}°C · 💧 ${Math.round(weather.humidity)}%`;
  ctx.font = `${fontSize}px system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(240, 246, 255, 0.92)';
  ctx.fillText(text, x, y);
}
```

### 6. Required External Dependencies
- **Open-Meteo APIs** (free, no key): 
  - `https://geocoding-api.open-meteo.com/v1/search` — address → lat/lon
  - `https://api.open-meteo.com/v1/forecast` — current/forecast weather
  - `https://archive-api.open-meteo.com/v1/archive` — historical weather (>7 days ago)
- **Nominatim Proxy** (required for street-level): Netlify function at `/.netlify/functions/geocode` that proxies `https://nominatim.openstreetmap.org/search`

### 7. Color Palette (shared constant)
```javascript
// core/utils.js — COLOR_PALETTE (22 colors, German abbreviations)
export const COLOR_PALETTE = [
  { abbrev: 'RT',  hex: '#FF0000', name: 'Rot' },
  { abbrev: 'GN',  hex: '#00FF00', name: 'Grün' },
  { abbrev: 'BL',  hex: '#0000FF', name: 'Blau' },
  { abbrev: 'GE',  hex: '#FFFF00', name: 'Gelb' },
  { abbrev: 'WS',  hex: '#FFFFFF', name: 'Weiß' },
  { abbrev: 'GR',  hex: '#808080', name: 'Grau' },
  { abbrev: 'BR',  hex: '#800000', name: 'Braun' },
  { abbrev: 'VI',  hex: '#800080', name: 'Violett' },
  { abbrev: 'TK',  hex: '#00FFFF', name: 'Türkis' },
  { abbrev: 'SW',  hex: '#000000', name: 'Schwarz' },
  { abbrev: 'OR',  hex: '#FFA500', name: 'Orange' },
  { abbrev: 'RS',  hex: '#FFC0CB', name: 'Rosa' },
  { abbrev: 'RT-', hex: '#FA8072', name: 'Hellrot' },
  { abbrev: 'GN-', hex: '#90EE90', name: 'Hellgrün' },
  { abbrev: 'BL-', hex: '#ADD8E6', name: 'Hellblau' },
  { abbrev: 'GE-', hex: '#FFFACD', name: 'Blassgelb' },
  { abbrev: 'WS-', hex: '#F5F5F5', name: 'Weiß-Variante' },
  { abbrev: 'GR-', hex: '#A9A9A9', name: 'Mittelgrau' },
  { abbrev: 'BR-', hex: '#DDA0DD', name: 'Flieder' },
  { abbrev: 'VI-', hex: '#E6E6FA', name: 'Hellviolett' },
  { abbrev: 'TK-', hex: '#AFEEEE', name: 'Hell Türkis' },
  { abbrev: 'SW-', hex: '#808080', name: 'Grau (Schwarz-Variante)' }
];
```

### 8. Storage Adapter Interface
```javascript
// Required by runIngestionPipeline options.storage:
const storageAdapter = {
  // Called on every successful ingestion (for audit trail)
  saveIngestEvent: async ({ templateId, source, diff, createdAt }) => { /* IndexedDB/localStorage */ },
  
  // Optional: for pending ingests
  savePendingIngest: async () => {},
  
  // Optional: for import mappings
  getImportMapping: async () => null,
  saveImportMapping: async () => {}
};

// Production implementation: fs-storage.js (IndexedDB)
```

---

## Quick Start Checklist for WatermarkCreation

- [ ] Copy `core/` + `netlify/functions/geocode.js` to project
- [ ] Deploy Netlify geocode function (or run local proxy)
- [ ] Implement `storage` adapter for `runIngestionPipeline`
- [ ] Define template with `enrichmentBindings` pointing to address/date/time fields
- [ ] Wire enrichment trigger (manual button → open dialog OR auto on field blur)
- [ ] Handle Tier 3 confirmation UI if needed
- [ ] Use enriched `temp`/`humidity` values in watermark render (round temp to integer)
- [ ] Test with: address `"91322 Gräfenberg, Jahnstraße 6"` + date `"2024-01-15"` + time `"14:30"` → should populate temperature & humidity

---

## Key Differences: Image Coordinate vs DocumentAutomation

| Aspect | Image Coordinate | DocumentAutomation |
|--------|------------------|-------------------|
| **Weather Trigger** | On photo capture (live GPS) | On field change / enrichment pass (template binding) |
| **Geocoding** | Browser GPS → reverse geocode | Address string → Nominatim proxy → Open-Meteo geocoding |
| **Weather API** | Current weather only (`current=`) | Forecast (future) + Archive (past >7 days) + hourly interpolation |
| **Time Resolution** | Capture moment (`new Date()`) | Template `dateField` + optional `timeField` |
| **Output** | Burned into JPEG pixels (watermark) | Written to form fields (provenance = 'enrichment') |
| **Caching** | None (fire-and-forget) | Throttle (1s), could add IndexedDB cache |

---

## Testing the Enrichment (Node.js)

```javascript
// test-geo-weather.mjs
import { GeoWeatherEnricher } from './core/enrichers/geo-weather-enricher.js';

const enricher = new GeoWeatherEnricher({
  minIntervalMs: 0,  // no throttle for testing
  nominatimProxyUrl: null  // use Open-Meteo geocoding only
});

// Test 1: Resolve location
const loc = await enricher.resolveLocation("91322 Gräfenberg, Jahnstraße 6");
console.log('Location:', loc);  // { lat, lon, displayName, address, confidence }

// Test 2: Get weather
const weather = await enricher.getWeather(loc.lat, loc.lon, "2024-01-15", "14:30");
console.log('Weather:', weather);  // { temp: 2.3, humidity: 87 }

// Test 3: Full enrichment binding
const binding = {
  sourceField: "address",
  targetFields: ["lat", "lon", "temperature", "humidity"],
  enricherType: "geo-weather",
  dateField: "date",
  timeField: "time"
};

const context = {
  getFieldValue: (id) => ({ 
    address: "91322 Gräfenberg, Jahnstraße 6", 
    date: "2024-01-15", 
    time: "14:30" 
  })[id],
  fieldsById: {}
};

const result = await enricher.enrichField(binding, context);
console.log('Enriched:', result.values);  // { lat, lon, temperature, humidity }
```

---

**Document Version:** 2.0 — COMPLETE  
**Generated from:** `D:\Projects\Image Cordinate` + `D:\Projects\DocumentAutomation`  
**For use in:** `D:\Projects\WatermarkCreation`  
**Status:** ✅ **Copy-paste ready** — includes Netlify proxy, Enrichment Dialog flow, fullGps role, temperature rounding, empty-field-only rule, exact template structure, API response shapes, formatAddress, throttle, coordinate parsing, storage adapter.