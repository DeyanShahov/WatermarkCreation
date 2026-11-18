/**
 * AI Module — Handles AI address validation and settings management.
 * Uses OpenAI-compatible APIs (Groq, OpenRouter, OpenAI, etc.)
 * 
 * Settings hierarchy:
 * - Global defaults (built-in, user's provided defaults)
 * - Category-specific overrides (stored per categoryId in IndexedDB)
 * - Per-field fallback: user value > category override > global default
 */

// ============================================================================
// GLOBAL DEFAULT SETTINGS (User's provided defaults as fallbacks)
// ============================================================================

const GLOBAL_DEFAULTS = {
  endpoint: 'https://api.groq.com/openai/v1/chat/completions',
  apiKey: '', // Set via environment variable GROQ_API_KEY or config
  model: 'qwen/qwen3.8-27b',
  prompt: `You are an address validator for German addresses within 200km of Nuremberg.
Correct ANY spelling mistakes in the address, especially street names. Common errors:
- Missing or wrong letters in street names (e.g. "Schreckenbacherstr." should be "Schreckenbachstraße" or "Schreckenbachstr.")
- "str." or "str" should be "straße" or "str."
- Wrong umlauts or special characters
Return ONLY the corrected full address in this EXACT format: "StreetName StreetNumber, PostalCode CityName"
Do NOT put postal code before city. Always put street first, then postal code and city.
If the address is already correct, return it unchanged in the same format.
Example: "91541 Rothenburg, Schreckenbacherstr. 4" -> "Schreckenbachstraße 4, 91541 Rothenburg ob der Tauber"
Example: "91322 Graefenberg, Jahn 6" -> "Jahnstraße 6, 91322 Gräfenberg"`
};

// ============================================================================
// INDEXEDDB STORAGE FOR CATEGORY-SPECIFIC AI SETTINGS
// ============================================================================

const AI_SETTINGS_DB = 'WatermarkAI';
const AI_SETTINGS_STORE = 'category-ai-settings';

/** Initialize AI settings database. */
async function initAISettingsDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(AI_SETTINGS_DB, 2); // version 2 for new store
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (!db.objectStoreNames.contains(AI_SETTINGS_STORE)) {
        const store = db.createObjectStore(AI_SETTINGS_STORE, { keyPath: 'categoryId' });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Load AI settings for a specific category. */
export async function loadAISettings(categoryId = null) {
  try {
    const db = await initAISettingsDB();
    
    if (categoryId) {
      // Load category-specific settings
      return new Promise((resolve) => {
        const tx = db.transaction(AI_SETTINGS_STORE, 'readonly');
        const store = tx.objectStore(AI_SETTINGS_STORE);
        const request = store.get(categoryId);
        request.onsuccess = () => {
          const categorySettings = request.result?.value || {};
          // Merge with global defaults (per-field fallback)
          resolve(mergeWithDefaults(categorySettings));
        };
        request.onerror = () => resolve(GLOBAL_DEFAULTS);
      });
    } else {
      // Return global defaults only
      return GLOBAL_DEFAULTS;
    }
  } catch {
    return GLOBAL_DEFAULTS;
  }
}

/** Save AI settings for a specific category. */
export async function saveAISettings(categoryId, settings) {
  if (!categoryId) {
    console.warn('saveAISettings: categoryId is required');
    return false;
  }
  
  try {
    const db = await initAISettingsDB();
    return new Promise((resolve) => {
      const tx = db.transaction(AI_SETTINGS_STORE, 'readwrite');
      const store = tx.objectStore(AI_SETTINGS_STORE);
      
      // Only store fields that differ from global defaults (to keep storage minimal)
      const categoryOverrides = getOverrides(settings);
      
      store.put({ 
        categoryId, 
        value: categoryOverrides,
        updatedAt: Date.now() 
      });
      
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}

/** Delete AI settings for a category (called when category is deleted). */
export async function deleteAISettings(categoryId) {
  if (!categoryId) return false;
  
  try {
    const db = await initAISettingsDB();
    return new Promise((resolve) => {
      const tx = db.transaction(AI_SETTINGS_STORE, 'readwrite');
      const store = tx.objectStore(AI_SETTINGS_STORE);
      store.delete(categoryId);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}

/** Get all category AI settings (for debugging/management). */
export async function getAllCategoryAISettings() {
  try {
    const db = await initAISettingsDB();
    return new Promise((resolve) => {
      const tx = db.transaction(AI_SETTINGS_STORE, 'readonly');
      const store = tx.objectStore(AI_SETTINGS_STORE);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/** Merge user/category settings with global defaults (per-field fallback). */
function mergeWithDefaults(categorySettings = {}) {
  return {
    endpoint: categorySettings.endpoint ?? GLOBAL_DEFAULTS.endpoint,
    apiKey: categorySettings.apiKey ?? GLOBAL_DEFAULTS.apiKey,
    model: categorySettings.model ?? GLOBAL_DEFAULTS.model,
    prompt: categorySettings.prompt ?? GLOBAL_DEFAULTS.prompt
  };
}

/** Extract only fields that differ from global defaults (for minimal storage). */
function getOverrides(settings) {
  const overrides = {};
  if (settings.endpoint !== undefined && settings.endpoint !== GLOBAL_DEFAULTS.endpoint) {
    overrides.endpoint = settings.endpoint;
  }
  if (settings.apiKey !== undefined && settings.apiKey !== GLOBAL_DEFAULTS.apiKey) {
    overrides.apiKey = settings.apiKey;
  }
  if (settings.model !== undefined && settings.model !== GLOBAL_DEFAULTS.model) {
    overrides.model = settings.model;
  }
  if (settings.prompt !== undefined && settings.prompt !== GLOBAL_DEFAULTS.prompt) {
    overrides.prompt = settings.prompt;
  }
  return overrides;
}

/** Get effective settings for AI validation (with per-field fallback). */
export async function getEffectiveAISettings(categoryId = null) {
  return loadAISettings(categoryId);
}

/** Validate address with AI using effective settings for category. */
export async function validateAddressWithAI(address, categoryId = null) {
  const settings = await loadAISettings(categoryId);

  if (!settings.apiKey || !settings.endpoint) {
    return null; // AI not configured
  }

  try {
    const messages = [
      { role: 'system', content: settings.prompt },
      { role: 'user', content: address }
    ];

    const response = await fetch(settings.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.apiKey}`
      },
      body: JSON.stringify({
        model: settings.model,
        messages,
        temperature: 0,
        max_tokens: 200
      })
    });

    if (!response.ok) {
      console.warn('AI validation failed:', response.status);
      return null;
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch (error) {
    console.warn('AI validation error:', error);
    return null;
  }
}

/** Test AI connection with a sample address. */
export async function testAIConnection(categoryId = null) {
  const settings = await loadAISettings(categoryId);
  
  if (!settings.apiKey || !settings.endpoint) {
    throw new Error('AI not configured');
  }

  const testAddress = '91322 Graefenberg, Jahn 6';
  const messages = [
    { role: 'system', content: settings.prompt },
    { role: 'user', content: testAddress }
  ];

  const response = await fetch(settings.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify({
      model: settings.model,
      messages,
      temperature: 0,
      max_tokens: 200
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(`HTTP ${response.status}: ${errorData.error?.message || response.statusText}`);
  }

  const data = await response.json();
  const corrected = data.choices?.[0]?.message?.content?.trim() || 'Няма отговор';
  
  return {
    success: true,
    testAddress,
    corrected,
    settingsUsed: {
      endpoint: settings.endpoint,
      model: settings.model,
      hasApiKey: !!settings.apiKey
    }
  };
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