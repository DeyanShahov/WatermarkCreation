/**
 * Storage module using IndexedDB for photos, categories, and steps.
 * All data persists locally in the browser.
 */

const DB_NAME = 'WatermarkCreationDB';
const DB_VERSION = 1;

const STORES = {
  PHOTOS: 'photos',
  CATEGORIES: 'categories',
  SETTINGS: 'settings',
};

let dbPromise = null;

/**
 * Open the IndexedDB database.
 */
function openDB() {
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
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

/**
 * Generic helper to run a transaction.
 */
async function withStore(storeName, mode, callback) {
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
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteCategory(id) {
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