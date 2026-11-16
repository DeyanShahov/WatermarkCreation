/**
 * Archive module - handles JSON export/import of categories using
 * File System Access API (with download/upload fallback).
 * 
 * File structure: categories-archive.json
 * {
 *   version: 1,
 *   exportedAt: ISO timestamp,
 *   categories: [...]
 * }
 */

const ARCHIVE_FILENAME = 'categories-archive.json';
const ARCHIVE_VERSION = 1;

// File System Access API handle (persisted across exports)
let fileHandle = null;

/**
 * Check if File System Access API is supported.
 */
export function isFileSystemAccessSupported() {
  return 'showSaveFilePicker' in window && 'showOpenFilePicker' in window;
}

/**
 * Get a file handle for the archive, prompting user if needed.
 * @param {{ create?: boolean }} options
 * @returns {Promise<FileSystemFileHandle|null>}
 */
async function getArchiveFileHandle(options = {}) {
  if (!isFileSystemAccessSupported()) return null;

  try {
    if (fileHandle && !options.create) {
      await fileHandle.getFile();
      return fileHandle;
    }

    const handles = await window.showSaveFilePicker({
      suggestedName: ARCHIVE_FILENAME,
      types: [{
        description: 'JSON Archive',
        accept: { 'application/json': ['.json'] },
      }],
    });
    fileHandle = handles;
    return fileHandle;
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.warn('[archive] File handle picker failed:', error.message);
    }
    return null;
  }
}

/**
 * Get a file handle for opening an existing archive.
 * @returns {Promise<FileSystemFileHandle|null>}
 */
async function getOpenFileHandle() {
  if (!isFileSystemAccessSupported()) return null;

  try {
    const [handle] = await window.showOpenFilePicker({
      types: [{
        description: 'JSON Archive',
        accept: { 'application/json': ['.json'] },
      }],
      multiple: false,
    });
    fileHandle = handle;
    return handle;
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.warn('[archive] Open file picker failed:', error.message);
    }
    return null;
  }
}

/**
 * Write content to a file handle.
 * @param {FileSystemFileHandle} handle
 * @param {string} content
 */
async function writeToFileHandle(handle, content) {
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
}

/**
 * Read content from a file handle.
 * @param {FileSystemFileHandle} handle
 * @returns {Promise<string>}
 */
async function readFromFileHandle(handle) {
  const file = await handle.getFile();
  return file.text();
}

/**
 * Fallback: trigger a download of JSON content.
 * @param {string} jsonContent
 * @param {string} filename
 */
function downloadJson(jsonContent, filename = ARCHIVE_FILENAME) {
  const blob = new Blob([jsonContent], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
/**
 * Fallback: open file picker for JSON import (using hidden input).
 * @returns {Promise<File|null>}
 */
function pickJsonFile() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.display = 'none';
    input.onchange = () => {
      const file = input.files?.[0] || null;
      document.body.removeChild(input);
      resolve(file);
    };
    input.oncancel = () => {
      document.body.removeChild(input);
      resolve(null);
    };
    document.body.appendChild(input);
    input.click();
  });
}

/**
 * Build the archive JSON structure.
 * @param {object[]} categories
 * @returns {string}
 */
function buildArchiveJson(categories) {
  const archive = {
    version: ARCHIVE_VERSION,
    exportedAt: new Date().toISOString(),
    categories: categories.map(cat => ({
      id: cat.id,
      name: cat.name,
      description: cat.description || '',
      order: cat.order ?? 0,
      steps: (cat.steps || []).map(step => ({
        id: step.id,
        name: step.name,
        description: step.description || '',
        photosRequired: step.photosRequired ?? 1,
        order: step.order ?? 0,
      })),
    })),
  };
  return JSON.stringify(archive, null, 2);
}

/**
 * Parse and validate archive JSON.
 * @param {string} jsonContent
 * @returns {object[]|null} Array of categories or null if invalid
 */
function parseArchiveJson(jsonContent) {
  try {
    const archive = JSON.parse(jsonContent);
    if (!archive || typeof archive !== 'object') return null;
    if (!Array.isArray(archive.categories)) return null;
    if (archive.version !== ARCHIVE_VERSION) {
      console.warn('[archive] Version mismatch:', archive.version, 'expected', ARCHIVE_VERSION);
    }
    return archive.categories;
  } catch (error) {
    console.error('[archive] Failed to parse JSON:', error);
    return null;
  }
}

/**
 * Export categories to JSON file.
 * Uses File System Access API if available, otherwise downloads.
 * @param {object[]} categories
 * @returns {Promise<{ success: boolean, method: 'filesystem'|'download'|'error', error?: string }>}
 */
export async function exportCategories(categories) {
  const jsonContent = buildArchiveJson(categories);

  if (isFileSystemAccessSupported()) {
    const handle = await getArchiveFileHandle({ create: true });
    if (handle) {
      try {
        await writeToFileHandle(handle, jsonContent);
        return { success: true, method: 'filesystem' };
      } catch (error) {
        console.warn('[archive] FileSystem write failed, falling back to download:', error.message);
      }
    }
  }

  try {
    downloadJson(jsonContent);
    return { success: true, method: 'download' };
  } catch (error) {
    return { success: false, method: 'error', error: error.message };
  }
}

/**
 * Import categories from JSON file.
 * Uses File System Access API if available, otherwise file input.
 * @returns {Promise<{ success: boolean, categories?: object[], method: 'filesystem'|'upload'|'error', error?: string }>}
 */
export async function importCategories() {
  if (isFileSystemAccessSupported()) {
    const handle = await getOpenFileHandle();
    if (handle) {
      try {
        const content = await readFromFileHandle(handle);
        const categories = parseArchiveJson(content);
        if (categories) {
          return { success: true, categories, method: 'filesystem' };
        }
        return { success: false, method: 'error', error: 'Невалиден формат на архива.' };
      } catch (error) {
        console.warn('[archive] FileSystem read failed, falling back to upload:', error.message);
      }
    }
  }

  try {
    const file = await pickJsonFile();
    if (!file) return { success: false, method: 'error', error: 'Файл не е избран.' };

    const content = await file.text();
    const categories = parseArchiveJson(content);
    if (categories) {
      return { success: true, categories, method: 'upload' };
    }
    return { success: false, method: 'error', error: 'Невалиден формат на архива.' };
  } catch (error) {
    return { success: false, method: 'error', error: error.message };
  }
}

/**
 * Try to load categories from a local JSON file on startup.
 * Silent attempt - no UI prompts.
 * @returns {Promise<object[]|null>} Categories or null if not found/failed
 */
export async function tryLoadLocalArchive() {
  if (!isFileSystemAccessSupported()) return null;

  try {
    if (fileHandle) {
      const content = await readFromFileHandle(fileHandle);
      return parseArchiveJson(content);
    }
  } catch (error) {
    console.debug('[archive] No local archive found or access denied:', error.message);
  }
  return null;
}

/**
 * Save categories to the already-picked file handle (silent save).
 * Used for auto-sync if enabled in future.
 * @param {object[]} categories
 * @returns {Promise<boolean>}
 */
export async function saveToExistingHandle(categories) {
  if (!fileHandle || !isFileSystemAccessSupported()) return false;
  try {
    const jsonContent = buildArchiveJson(categories);
    await writeToFileHandle(fileHandle, jsonContent);
    return true;
  } catch (error) {
    console.warn('[archive] Silent save failed:', error.message);
    return false;
  }
}

/**
 * Clear the cached file handle (e.g., when user wants to pick new location).
 */
export function clearFileHandle() {
  fileHandle = null;
}