/**
 * Storage module using IndexedDB for photos, categories, and steps.
 * All data persists locally in the browser.
 */

const DB_NAME = 'WatermarkCreationDB';
const DB_VERSION = 2; // Bumped for AI settings stores

const STORES = {
  PHOTOS: 'photos',
  CATEGORIES: 'categories',
  SETTINGS: 'settings',
  USER_AI_SETTINGS: 'user-ai-settings',
  CATEGORY_PROMPTS: 'category-prompts',
};

let dbPromise = null;

/**
 * Open the IndexedDB database.
 * Exported for use by other modules (e.g., ai.js).
 */
export function openDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;

      // Photos store
      if (!db.objectStoreNames.contains(STORES.PHOTOS)) {
        const photoStore = db.createObjectStore(STORES.PHOTOS, { keyPath: 'id' });
        photoStore.createIndex('categoryId', 'categoryId', { unique: false });
        photoStore.createIndex('stepId', 'stepId', { unique: false });
        photoStore.createIndex('createdAt', 'createdAt', { unique: false });
      }

      // Categories store
      if (!db.objectStoreNames.contains(STORES.CATEGORIES)) {
        const catStore = db.createObjectStore(STORES.CATEGORIES, { keyPath: 'id' });
        catStore.createIndex('order', 'order', { unique: false });
      }

      // Settings store
      if (!db.objectStoreNames.contains(STORES.SETTINGS)) {
        db.createObjectStore(STORES.SETTINGS, { keyPath: 'key' });
      }

      // User AI Settings store (single record with key 'global')
      if (!db.objectStoreNames.contains(STORES.USER_AI_SETTINGS)) {
        db.createObjectStore(STORES.USER_AI_SETTINGS, { keyPath: 'id' });
      }

      // Category Prompts store (key: categoryId)
      if (!db.objectStoreNames.contains(STORES.CATEGORY_PROMPTS)) {
        db.createObjectStore(STORES.CATEGORY_PROMPTS, { keyPath: 'categoryId' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

/**
 * Generic helper to run a transaction.
 * Exported for use by other modules (e.g., ai.js).
 */
export async function withStore(storeName, mode, callback) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const result = callback(store);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
  });
}

/* ------------------------------ Photos ------------------------------ */

/**
 * Save a photo record.
 * @param {object} photo - Photo record
 * @returns {Promise<string>} The photo ID
 */
export async function savePhoto(photo) {
  return withStore(STORES.PHOTOS, 'readwrite', (store) => {
    store.put(photo);
    return photo.id;
  });
}

/**
 * Get a photo by ID.
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function getPhoto(id) {
  return withStore(STORES.PHOTOS, 'readonly', (store) => {
    return new Promise((resolve, reject) => {
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  });
}

/**
 * Get all photos, optionally filtered by category and/or step.
 * @param {{ categoryId?: string, stepId?: string }} [filter]
 * @returns {Promise<object[]>}
 */
export async function getPhotos(filter = {}) {
  return withStore(STORES.PHOTOS, 'readonly', (store) => {
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => {
        let photos = request.result || [];
        if (filter.categoryId) {
          photos = photos.filter((p) => p.categoryId === filter.categoryId);
        }
        if (filter.stepId) {
          photos = photos.filter((p) => p.stepId === filter.stepId);
        }
        // Sort by creation date, newest first
        photos.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        resolve(photos);
      };
      request.onerror = () => reject(request.error);
    });
  });
}

/**
 * Get photos grouped by category and step for gallery view.
 * @returns {Promise<object[]>}
 */
export async function getPhotosGrouped() {
  const photos = await getPhotos();
  const categories = await getCategories();

  const grouped = categories.map((category) => ({
    ...category,
    steps: category.steps.map((step) => ({
      ...step,
      photos: photos
        .filter((p) => p.categoryId === category.id && p.stepId === step.id)
        .sort((a, b) => (a.position || 0) - (b.position || 0)),
    })),
  }));

  return grouped;
}

/**
 * Update a photo record (partial update).
 * @param {string} id
 * @param {object} updates
 * @returns {Promise<boolean>}
 */
export async function updatePhoto(id, updates) {
  const photo = await getPhoto(id);
  if (!photo) return false;

  const updated = { ...photo, ...updates };
  await savePhoto(updated);
  return true;
}

/**
 * Delete a photo by ID.
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deletePhoto(id) {
  return withStore(STORES.PHOTOS, 'readwrite', (store) => {
    store.delete(id);
  });
}

/**
 * Delete all photos.
 * @returns {Promise<void>}
 */
export async function clearPhotos() {
  return withStore(STORES.PHOTOS, 'readwrite', (store) => {
    store.clear();
  });
}

/**
 * Get the next position number for a step.
 * @param {string} categoryId
 * @param {string} stepId
 * @returns {Promise<number>}
 */
export async function getNextPosition(categoryId, stepId) {
  const photos = await getPhotos({ categoryId, stepId });
  const maxPos = photos.reduce((max, p) => Math.max(max, p.position || 0), 0);
  return maxPos + 1;
}

/* ------------------------------ Categories ------------------------------ */

/**
 * Save a category with its steps.
 * @param {object} category
 * @returns {Promise<string>}
 */
export async function saveCategory(category) {
  return withStore(STORES.CATEGORIES, 'readwrite', (store) => {
    store.put(category);
    return category.id;
  });
}

/**
 * Get a category by ID.
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function getCategory(id) {
  return withStore(STORES.CATEGORIES, 'readonly', (store) => {
    return new Promise((resolve, reject) => {
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  });
}

/**
 * Get all categories sorted by order.
 * @returns {Promise<object[]>}
 */
export async function getCategories() {
  return withStore(STORES.CATEGORIES, 'readonly', (store) => {
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => {
        const categories = (request.result || []).sort((a, b) => (a.order || 0) - (b.order || 0));
        resolve(categories);
      };
      request.onerror = () => reject(request.error);
    });
  });
}

/**
 * Delete a category and all its steps.
 * Also removes the category's AI settings (API key / prompt), so no orphan
 * records are left behind in the `category-prompts` store.
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteCategory(id) {
  // Remove AI settings first, then the category itself.
  await withStore(STORES.CATEGORY_PROMPTS, 'readwrite', (store) => {
    store.delete(id);
  });
  return withStore(STORES.CATEGORIES, 'readwrite', (store) => {
    store.delete(id);
  });
}

/**
 * Reorder categories.
 * @param {string[]} categoryIds - Array of category IDs in new order
 * @returns {Promise<void>}
 */
export async function reorderCategories(categoryIds) {
  const categories = await getCategories();
  const updates = categoryIds.map((id, index) => {
    const cat = categories.find((c) => c.id === id);
    if (cat) return { ...cat, order: index };
    return null;
  }).filter(Boolean);

  return withStore(STORES.CATEGORIES, 'readwrite', (store) => {
    for (const cat of updates) {
      store.put(cat);
    }
  });
}

/* ------------------------------ Settings ------------------------------ */

/**
 * Get a setting value.
 * @param {string} key
 * @returns {Promise<any>}
 */
export async function getSetting(key) {
  return withStore(STORES.SETTINGS, 'readonly', (store) => {
    return new Promise((resolve, reject) => {
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result?.value);
      request.onerror = () => reject(request.error);
    });
  });
}

/**
 * Set a setting value.
 * @param {string} key
 * @param {any} value
 * @returns {Promise<void>}
 */
export async function setSetting(key, value) {
  return withStore(STORES.SETTINGS, 'readwrite', (store) => {
    store.put({ key, value });
  });
}

/**
 * Get all settings.
 * @returns {Promise<object>}
 */
export async function getAllSettings() {
  return withStore(STORES.SETTINGS, 'readonly', (store) => {
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => {
        const settings = {};
        for (const item of request.result || []) {
          settings[item.key] = item.value;
        }
        resolve(settings);
      };
      request.onerror = () => reject(request.error);
    });
  });
}

/* ------------------------------ AI Settings ------------------------------ */

const USER_DEFAULTS_KEY = 'global';

/**
 * Load user global AI settings (endpoint, model).
 * API Key is now stored per-category.
 */
export async function loadUserSettings() {
  return withStore(STORES.USER_AI_SETTINGS, 'readonly', (store) => {
    return new Promise((resolve, reject) => {
      const request = store.get(USER_DEFAULTS_KEY);
      request.onsuccess = () => {
        const data = request.result;
        if (data) {
          resolve({
            endpoint: data.endpoint || BUILTIN_DEFAULTS.endpoint,
            model: data.model || BUILTIN_DEFAULTS.model
          });
        } else {
          resolve({ 
            endpoint: BUILTIN_DEFAULTS.endpoint,
            model: BUILTIN_DEFAULTS.model
          });
        }
      };
      request.onerror = () => reject(request.error);
    });
  });
}

/**
 * Save user global AI settings (endpoint, model only - apiKey is per-category).
 */
export async function saveUserSettings({ endpoint, model }) {
  return withStore(STORES.USER_AI_SETTINGS, 'readwrite', (store) => {
    store.put({
      id: USER_DEFAULTS_KEY,
      endpoint: endpoint || BUILTIN_DEFAULTS.endpoint,
      model: model || BUILTIN_DEFAULTS.model,
      updatedAt: Date.now()
    });
  });
}

/**
 * Load category-specific AI settings (apiKey, prompt).
 * Returns { apiKey, prompt, hasSettings: boolean }
 */
export async function loadCategoryAISettings(categoryId) {
  if (!categoryId) return { apiKey: '', prompt: BUILTIN_DEFAULTS.prompt, hasSettings: false };
  
  return withStore(STORES.CATEGORY_PROMPTS, 'readonly', (store) => {
    return new Promise((resolve, reject) => {
      const request = store.get(categoryId);
      request.onsuccess = () => {
        const data = request.result;
        if (data) {
          resolve({ 
            apiKey: data.apiKey || '', 
            prompt: data.prompt || BUILTIN_DEFAULTS.prompt,
            hasSettings: true
          });
        } else {
          resolve({ 
            apiKey: '', 
            prompt: BUILTIN_DEFAULTS.prompt,
            hasSettings: false
          });
        }
      };
      request.onerror = () => reject(request.error);
    });
  });
}

/**
 * Save category-specific AI settings (apiKey, prompt).
 */
export async function saveCategoryAISettings(categoryId, { apiKey, prompt }) {
  if (!categoryId) return;
  
  return withStore(STORES.CATEGORY_PROMPTS, 'readwrite', (store) => {
    store.put({
      categoryId,
      apiKey: apiKey || '',
      prompt: prompt || BUILTIN_DEFAULTS.prompt,
      updatedAt: Date.now()
    });
  });
}

/**
 * Delete category AI settings.
 */
export async function deleteCategoryAISettings(categoryId) {
  if (!categoryId) return;
  return withStore(STORES.CATEGORY_PROMPTS, 'readwrite', (store) => {
    store.delete(categoryId);
  });
}

/**
 * Remove AI settings records whose category no longer exists.
 * Categories can disappear via archive import (new IDs are generated) or by
 * editing IndexedDB directly, which would otherwise leave orphaned keys.
 * @returns {Promise<number>} How many orphan records were removed.
 */
export async function cleanupOrphanCategoryAISettings() {
  const categories = await getCategories();
  const validIds = new Set(categories.map((c) => c.id));

  return withStore(STORES.CATEGORY_PROMPTS, 'readwrite', (store) => {
    return new Promise((resolve) => {
      const request = store.getAllKeys();
      request.onsuccess = () => {
        const keys = request.result || [];
        let removed = 0;
        for (const key of keys) {
          if (!validIds.has(key)) {
            store.delete(key);
            removed++;
          }
        }
        resolve(removed);
      };
      request.onerror = () => resolve(0);
    });
  });
}

/**
 * Load category-specific prompt (backward compatibility).
 */
export async function loadCategoryPrompt(categoryId) {
  const settings = await loadCategoryAISettings(categoryId);
  return settings.prompt;
}

/**
 * Save category-specific prompt (backward compatibility).
 */
export async function saveCategoryPrompt(categoryId, prompt) {
  return saveCategoryAISettings(categoryId, { prompt });
}

/**
 * Delete category prompt (backward compatibility).
 */
export async function deleteCategoryPrompt(categoryId) {
  return deleteCategoryAISettings(categoryId);
}

/**
 * Get built-in defaults (for placeholders).
 */
export function getGlobalDefaults() {
  return { ...BUILTIN_DEFAULTS };
}

// Built-in defaults (shared with ai.js)
const BUILTIN_DEFAULTS = {
  endpoint: 'https://api.groq.com/openai/v1/chat/completions',
  model: 'qwen/qwen3.8-27b',
  apiKey: '', // Optional: user can provide their own key for direct browser→Groq calls
  prompt: `You are an address validator and corrector for Bulgarian and German addresses.
Your task: Correct ANY spelling mistakes in the address, especially street names.

Common errors to fix:
- Missing or wrong letters in street names (e.g., "Schreckenbacherstr." should be "Schreckenbachstraße" or "Schreckenbachstr.")
- "str." or "str" should be "straße" or "str."
- Wrong umlauts or special characters (ä, ö, ü, ß)
- Incorrect postal code format
- Wrong city names or spelling

Return ONLY the corrected full address in this EXACT format:
"StreetName StreetNumber, PostalCode CityName"

Rules:
- Do NOT put postal code before city. Always put street first, then postal code and city.
- If the address is already correct, return it unchanged in the same format.
- Use German formatting for German addresses, Bulgarian for Bulgarian.

Examples:
- "91541 Rothenburg, Schreckenbacherstr. 4" → "Schreckenbachstraße 4, 91541 Rothenburg ob der Tauber"
- "91322 Graefenberg, Jahn 6" → "Jahnstraße 6, 91322 Gräfenberg"
- "ул. Витоша 10, 1000 София" → "ул. Витоша 10, 1000 София"`
};

/* ------------------------------ Utility ------------------------------ */

/**
 * Generate a unique ID.
 * @returns {string}
 */
export function generateId() {
  return globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Create a new photo record from a file and metadata.
 * @param {File} file
 * @param {object} metadata
 * @returns {Promise<object>}
 */
export async function createPhotoRecord(file, metadata) {
  const id = generateId();
  const now = Date.now();

  // Create blob from file
  const blob = file.slice(0, file.size, file.type);

  // Create thumbnail
  const { createThumbnail } = await import('../utils/image.js');
  const thumb = await createThumbnail(blob).catch(() => null);

  return {
    id,
    file: blob,
    filename: file.name,
    mimeType: file.type,
    size: file.size,
    thumbnail: thumb,
    createdAt: now,
    updatedAt: now,
    ...metadata,
  };
}