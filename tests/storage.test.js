import { describe, it, expect, beforeEach } from 'vitest';
import * as storage from '../src/modules/storage.js';

/** Start every test from a clean category/AI-settings slate. */
async function resetData() {
  const categories = await storage.getCategories();
  for (const cat of categories) {
    await storage.deleteCategory(cat.id); // cascade: also removes its AI settings
  }
  // Remove anything that has no matching category (orphans).
  await storage.cleanupOrphanCategoryAISettings();
}

beforeEach(resetData);

describe('deleteCategory - cascade', () => {
  it('removes the category AI settings together with the category', async () => {
    await storage.saveCategory({ id: 'cat-cascade', name: 'Каскад', steps: [] });
    await storage.saveCategoryAISettings('cat-cascade', { apiKey: 'gsk_CASCADE', prompt: 'p' });

    expect((await storage.loadCategoryAISettings('cat-cascade')).apiKey).toBe('gsk_CASCADE');

    await storage.deleteCategory('cat-cascade');

    expect(await storage.getCategory('cat-cascade')).toBeNull();
    const ai = await storage.loadCategoryAISettings('cat-cascade');
    expect(ai.apiKey).toBe('');
    expect(ai.hasSettings).toBe(false);
  });

  it('keeps the AI settings of other categories untouched', async () => {
    await storage.saveCategory({ id: 'cat-a', name: 'A', steps: [] });
    await storage.saveCategory({ id: 'cat-b', name: 'B', steps: [] });
    await storage.saveCategoryAISettings('cat-a', { apiKey: 'gsk_A', prompt: 'pa' });
    await storage.saveCategoryAISettings('cat-b', { apiKey: 'gsk_B', prompt: 'pb' });

    await storage.deleteCategory('cat-a');

    expect((await storage.loadCategoryAISettings('cat-b')).apiKey).toBe('gsk_B');
  });

  it('is idempotent when the category has no saved key', async () => {
    await storage.saveCategory({ id: 'cat-nokey', name: 'Без ключ', steps: [] });
    await expect(storage.deleteCategory('cat-nokey')).resolves.toBeUndefined();
    expect(await storage.getCategory('cat-nokey')).toBeNull();
  });
});

describe('cleanupOrphanCategoryAISettings', () => {
  it('removes only records whose category no longer exists', async () => {
    await storage.saveCategory({ id: 'cat-keep', name: 'Keep', steps: [] });
    await storage.saveCategoryAISettings('cat-keep', { apiKey: 'gsk_KEEP', prompt: 'p' });

    // Baseline: nothing should be orphaned before we seed one.
    expect(await storage.cleanupOrphanCategoryAISettings()).toBe(0);

    // A record without a category (e.g. left behind by an archive import with new IDs)
    await storage.saveCategoryAISettings('cat-ghost', { apiKey: 'gsk_GHOST', prompt: 'p' });

    expect(await storage.cleanupOrphanCategoryAISettings()).toBe(1);

    expect((await storage.loadCategoryAISettings('cat-ghost')).hasSettings).toBe(false);
    expect((await storage.loadCategoryAISettings('cat-keep')).apiKey).toBe('gsk_KEEP');
  });
});

describe('per-category isolation', () => {
  it('does not leak a saved key to a newly created (duplicate-like) category', async () => {
    await storage.saveCategory({ id: 'cat-original', name: 'Оригинал', steps: [] });
    await storage.saveCategoryAISettings('cat-original', { apiKey: 'gsk_ORIGINAL', prompt: 'p' });

    // Duplicating creates a NEW id -> must start empty.
    const duplicateId = storage.generateId();
    await storage.saveCategory({ id: duplicateId, name: 'Дубликат', steps: [] });

    const dup = await storage.loadCategoryAISettings(duplicateId);
    expect(dup.apiKey).toBe('');
    expect(dup.hasSettings).toBe(false);

    // Original keeps its key.
    expect((await storage.loadCategoryAISettings('cat-original')).apiKey).toBe('gsk_ORIGINAL');
  });
});
