# CRITICAL AUDIT: What's MISSING from the Documentation

**Status:** ⚠️ **Documentation is ~85% complete** — an AI agent would STRUGGLE to reproduce the *exact* working mechanism without these missing pieces.

---

## ❌ MISSING: Netlify Geocode Proxy Function (CRITICAL)

**File:** `D:\Projects\DocumentAutomation\netlify\functions\geocode.js` (86 lines)

The documentation mentions `nominatimProxyUrl: '/.netlify/functions/geocode'` but **does not include the actual server-side code**. This is ESSENTIAL because:

1. **Browser cannot call Nominatim directly** — CORS + User-Agent requirements
2. **The proxy does address normalization** — tries 4 variations:
   - Original address
   - `straße` → `str.`
   - `straße` → `str`
   - Remove commas
3. **Rate limits to 1 req/sec** with `await new Promise(resolve => setTimeout(resolve, 1100))`
4. **Returns clean JSON**: `{ lat, lon, displayName, address }`

**Without this proxy, geocoding WILL FAIL in browser.** The fallback (Open-Meteo geocoding) only does city-level, not street-level.

---

## ❌ MISSING: The Enrichment Dialog UI (How users actually CONFIGURE bindings)

**File:** `D:\Projects\DocumentAutomation\views\filler\enrichment-dialog.js` (524 lines)

The documentation shows a *static* binding example, but the **real system has a full UI** where users:
1. **Add multiple source fields** with delimiters + part extraction
2. **Map target fields to roles** via dropdown (lat/lon/address/displayName/temp/humidity/fullGps)
3. **Select date/time fields** from template fields
4. **AI-validate address first** (Groq LLM with custom prompt for German addresses)
5. **Save config to localStorage** per template
6. **Preview results before applying** (shows GPS in DMS + decimal, rounded temp)

**Key insight:** The `GeoWeatherEnricher.enrichField()` is called with `addressOverride` when AI validation happened — this is a special path not in the docs.

---

## ❌ MISSING: How Enrichment is TRIGGERED in the Filler

**File:** `D:\Projects\DocumentAutomation\views\filler\filler-view.js` → `onEnrich()` (line 815)

```javascript
async function onEnrich() {
  if (!state.selectedTemplateId) { showToast('No template selected', 'error'); return; }
  try {
    const template = await storage.loadTemplate(state.selectedTemplateId);
    if (!template) { showToast('Template not found', 'error'); return; }
    const { openEnrichmentDialog } = await import('./enrichment-dialog.js');
    await openEnrichmentDialog(template, state, { applyFormValues });
  } catch (err) { console.error('Enrichment dialog error:', err); showToast('Грешка: ' + err.message, 'error'); }
}
```

**Trigger:** Button click (`btnEnrich`) → loads full template → opens dialog → dialog does the enrichment → applies to `state.fieldValues` → calls `applyFormValues()` to update UI.

---

## ❌ MISSING: The `fullGps` Role Special Handling

In `enrichment-dialog.js` lines 317-323 and 337-344:

```javascript
// When role === 'fullGps', write COMBINED GPS string to ONE field:
const gpsCombined = `${loc.lat}, ${loc.lon}  /  ${toDMS(loc.lat, true)}, ${toDMS(loc.lon, false)}`;
// Then SKIP the lon field to avoid duplication:
if (role === 'lon' && gpsFieldId && gpsFieldId !== fieldId) { skipped.push(fieldId); continue; }
```

This is **not documented** and is critical for the UX where GPS goes into a single field.

---

## ❌ MISSING: Temperature ROUNDING at Apply Time

**Doc says:** Weather returns `{ temp: 24.3, humidity: 45 }`  
**Reality:** In `enrichment-dialog.js` line 292-294 and 335-336:

```javascript
// At display time:
if (role === 'temp') { displayVal = Math.round(val); }

// At apply time:
if (role === 'temp') finalValue = Math.round(value);
```

**Temperature is always stored/displayed as integer.** The raw float is only used internally.

---

## ❌ MISSING: "Only Empty Fields Get Filled" Rule

In `enrichment-dialog.js` lines 328-333:

```javascript
for (const [fieldId, value] of Object.entries(enrichmentResult.values)) {
  const current = fillerState.fieldValues?.[fieldId];
  if (current !== undefined && current !== null && current !== '' && current !== '--') {
    skipped.push(fieldId);
    continue; // Skip non-empty (manual override)
  }
  // ... apply
}
```

**Provenance 'enrichment' NEVER overwrites manual/excel/api/ai values.** This is enforced at apply-time, not in the enricher.

---

## ❌ MISSING: The Exact Template Structure Expected

Tests show the **required template shape**:

```javascript
{
  id: 'template-id',
  pages: [{
    pageNumber: 1,
    fields: [
      { id: 'address', label: 'Address', type: 'text' },
      { id: 'lat', label: 'Latitude', type: 'number' },
      { id: 'lon', label: 'Longitude', type: 'number' },
      { id: 'temp', label: 'Temperature', type: 'number' },
      { id: 'humidity', label: 'Humidity', type: 'number' },
      { id: 'displayName', label: 'Display Name', type: 'text' },
      { id: 'dateField', label: 'Date', type: 'date' },
    ]
  }],
  enrichmentBindings: [{  // Optional - alternative to per-field config
    sourceField: 'address',
    targetFields: ['lat', 'lon', 'temp', 'humidity, 'displayName'],
    enricherType: 'geo-weather',
    dateField: 'dateField'
  }]
}
```

**Critical:** Fields MUST have `type` for normalization to work. Date field MUST be `type: 'date'` (for `validateTier1` to convert to YYYY-MM-DD).

---

## ❌ MISSING: Open-Meteo API Response Shapes (for testing/mocking)

The enricher expects **exact JSON structures**:

**Geocoding (`geocoding-api.open-meteo.com`):**
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
    "admin1": "Sofia City"
  }]
}
```

**Weather Forecast/Archive (`api.open-meteo.com` / `archive-api.open-meteo.com`):**
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
    "temperature_2h": [18.5, 24.3, 22.1],
    "relative_humidity_2m": [65, 45, 55]
  }
}
```

**Nominatim (via proxy):**
```json
[{
  "place_id": 12345,
  "lat": "42.6977",
  "lon": "23.3219",
  "display_name": "Vitosha Boulevard 10, Sofia, Bulgaria",
  "address": {
    "road": "Vitosha Boulevard",
    "house_number": "10",
    "city": "Sofia",
    "state": "Sofia City Province",
    "postcode": "1000",
    "country": "Bulgaria"
  }
}]
```

---

## ❌ MISSING: The `formatAddress` Function (Nominatim → readable)

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

This creates the `address` field value stored in the form.

---

## ❌ MISSING: Throttle Implementation Details

The `createThrottle` is **testable** with injected clock/delay:

```javascript
// Used in GeoWeatherEnricher constructor:
this._throttle = createThrottle(this.minIntervalMs, this.now, options.delay);

// Implementation (geo-weather-enricher.js lines 138-149):
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

**Default:** 1000ms between requests. Critical for not hitting rate limits.

---

## ❌ MISSING: Coordinate Parsing Edge Cases

`parseCoordinate()` handles:
- `"42.6977, 23.3219"` → `{lat: 42.6977, lon: 23.3219}`
- `"42.6977,23.3219"` (no space)
- `"-33.8688, 151.2093"` (negative)
- `"42°41'52"N 23°19'19"E"` (DMS with various quotes)
- `"42°41'52"N, 23°19'19"E"` (DMS with comma)
- **Rejects:** out of range (>90, >180), invalid strings, null/undefined

---

## ❌ MISSING: `runEnrichmentPass` Expects Bindings in Template

The `collectBindings()` function (geo-weather-enricher.js line 570-588) reads:

```javascript
export function collectBindings(template) {
  if (template.enrichmentBindings && Array.isArray(template.enrichmentBindings)) {
    return template.enrichmentBindings;
  }
  // Fallback: per-field enrichment config
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

**Two ways to configure:** Template-level `enrichmentBindings[]` OR per-field `field.enrichment` object.

---

## ❌ MISSING: Storage Adapter Interface

`runIngestionPipeline` requires a `storage` object with:

```javascript
const noopStorage = {
  saveIngestEvent: async () => {},
  savePendingIngest: async () => {},
  getImportMapping: async () => null,
  saveImportMapping: async () => {}
};
```

In production: `fs-storage.js` implements this with IndexedDB.

---

## ✅ WHAT'S ALREADY GOOD IN THE DOCUMENTATION

- ✅ Complete `GeoWeatherEnricher` class with all methods
- ✅ Full validation pipeline (Tier 1/2/3)
- ✅ Provenance & conflict resolution
- ✅ Calculated fields with dependency graph
- ✅ Linked fields & affix extraction
- ✅ AI extraction pipeline
- ✅ API/Excel import with JsonPath
- ✅ Color palette constant
- ✅ Image Coordinate weather + watermark

---

## 🎯 ACTION REQUIRED: Update Documentation

To make it **truly copy-paste ready** for WatermarkCreation, I need to add:

1. **Full Netlify geocode.js function** (86 lines)
2. **Enrichment Dialog flow** (how config is built from UI)
3. **Special roles:** `fullGps`, temperature rounding
4. **"Only empty fields" rule** at apply time
5. **Exact template structure** with field types
6. **API response shapes** for testing
7. **`formatAddress` function**
8. **Throttle implementation**
9. **Coordinate parsing rules**
10. **Storage adapter requirements**

---

**Verdict:** Current doc = **strong architectural reference**, but **insufficient for drop-in reproduction**. An AI would produce a "looks right but fails on street addresses, rate limits, and UX details" implementation.

**Recommendation:** I'll now update the `.md` with all these missing pieces.