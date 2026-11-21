/**
 * AI Core Module — Browser-side AI settings management and Netlify Function proxy calls.
 * 
 * Architecture:
 * - User global settings (endpoint, model) stored in IndexedDB: 'user-ai-settings' (key: 'global')
 * - Category-specific prompts stored in IndexedDB: 'category-prompts' (key: categoryId)
 * - API Key NEVER in browser — only in Netlify Environment Variables (GROQ_API_KEY / OPENAI_API_KEY)
 * - All AI calls go through Netlify Function: /.netlify/functions/ai-process
 * - Uses shared storage.js for IndexedDB access
 */

import { 
  loadUserSettings, 
  saveUserSettings, 
  loadCategoryPrompt, 
  saveCategoryPrompt, 
  deleteCategoryPrompt, 
  getGlobalDefaults 
} from '../modules/storage.js';

/* ------------------------------ Effective Settings Resolution ------------------------------ */

/**
 * Get effective settings for a category (merges user global + category prompt + builtin defaults).
 * Priority: category prompt > user global > builtin defaults
 */
export async function getEffectiveSettings(categoryId = null) {
  const [userSettings, categoryPrompt] = await Promise.all([
    loadUserSettings(),
    loadCategoryPrompt(categoryId)
  ]);
  
  return {
    endpoint: userSettings.endpoint,
    model: userSettings.model,
    prompt: categoryPrompt
  };
}

/* ------------------------------ Netlify Function Calls ------------------------------ */

/**
 * Call Netlify AI Function.
 * @param {Object} params
 * @param {string} params.action - 'validate-address' | 'analyze-image' | 'extract-metadata' | 'verify-content'
 * @param {string} params.categoryId - Category ID for prompt selection
 * @param {string} params.input - Input text (address) or base64 image
 * @param {string} [params.prompt] - Optional custom prompt override
 * @returns {Promise<Object>} { success, result, model, action, categoryId, usage }
 */
export async function callNetlifyAI({ action, categoryId, input, prompt }) {
  const validActions = ['validate-address', 'analyze-image', 'extract-metadata', 'verify-content'];
  if (!validActions.includes(action)) {
    throw new Error(`Invalid action: ${action}. Valid: ${validActions.join(', ')}`);
  }
  
  if (!input || typeof input !== 'string' || input.trim() === '') {
    throw new Error('Input required');
  }
  
  const response = await fetch('/.netlify/functions/ai-process', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, categoryId, input, prompt })
  });
  
  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(data.error || `AI Function error: ${response.status}`);
  }
  
  return data;
}

/* ------------------------------ High-level AI Actions ------------------------------ */

/** Validate address using AI (for enrichment modal). */
export async function validateAddressWithAI(address, categoryId = null) {
  try {
    const result = await callNetlifyAI({
      action: 'validate-address',
      categoryId,
      input: address
    });
    return result.result;
  } catch (error) {
    console.error('AI address validation failed:', error);
    return null;
  }
}

/** Test AI connection for a category. */
export async function testAIConnection(categoryId = null) {
  const testAddress = '91541 Rothenburg, Schreckenbacherstr. 4';
  const corrected = await validateAddressWithAI(testAddress, categoryId);
  
  const settings = await getEffectiveSettings(categoryId);
  
  return {
    testAddress,
    corrected: corrected || 'AI не върна резултат',
    settingsUsed: {
      model: settings.model,
      endpoint: settings.endpoint
    }
  };
}

/** Save AI settings from UI (user global + category prompt). */
export async function saveAISettings(categoryId, { endpoint, model, prompt }) {
  try {
    // Save global settings (endpoint, model)
    if (endpoint || model) {
      await saveUserSettings({ endpoint, model });
    }
    
    // Save category-specific prompt
    if (prompt !== undefined && categoryId) {
      await saveCategoryPrompt(categoryId, prompt);
    }
    
    return true;
  } catch (error) {
    console.error('Failed to save AI settings:', error);
    return false;
  }
}

/** Collect AI settings from UI form (used by ui.js). */
export async function collectAISettingsFromForm(categoryId = null) {
  // This is called from ui.js collectAISettings()
  // Returns { userSettings: {endpoint, model}, categoryPrompt }
  const userSettings = await loadUserSettings();
  const categoryPrompt = await loadCategoryPrompt(categoryId);
  
  return {
    userSettings,
    categoryPrompt
  };
}

// Re-export storage functions for convenience
export { 
  loadUserSettings, 
  saveUserSettings, 
  loadCategoryPrompt, 
  saveCategoryPrompt, 
  deleteCategoryPrompt, 
  getGlobalDefaults 
};