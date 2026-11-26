/**
 * AI Core Module — Browser-side AI settings management and Netlify Function proxy calls.
 * 
 * Architecture:
 * - User global settings (endpoint, model, apiKey) stored in IndexedDB: 'user-ai-settings' (key: 'global')
 * - Category-specific prompts stored in IndexedDB: 'category-prompts' (key: categoryId)
 * - API Key CAN be stored in browser (user-provided) for direct Groq calls
 * - If no API key in browser, calls go through Netlify Function: /.netlify/functions/ai-process (uses env var)
 * - Uses shared storage.js for IndexedDB access
 * - Default model: qwen/qwen3.8-27b for both text and image processing
 */

import { 
  loadUserSettings, 
  saveUserSettings, 
  loadCategoryAISettings,
  saveCategoryAISettings,
  deleteCategoryAISettings,
  loadCategoryPrompt, 
  saveCategoryPrompt, 
  deleteCategoryPrompt, 
  getGlobalDefaults 
} from '../modules/storage.js';

/* ------------------------------ Built-in Defaults ------------------------------ */

/** Single source of truth for the AI model used everywhere (browser + proxy). */
export const DEFAULT_AI_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
export const DEFAULT_AI_MODEL = 'qwen/qwen3.8-27b';

const BUILTIN_DEFAULTS = {
  endpoint: DEFAULT_AI_ENDPOINT,
  model: DEFAULT_AI_MODEL,
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

/* ------------------------------ Effective Settings Resolution ------------------------------ */

/**
 * Get effective settings for a category (merges user global + category settings + builtin defaults).
 * - endpoint, model: global (from user-ai-settings)
 * - apiKey, prompt: per-category (from category-prompts)
 * @param {string|null} categoryId - Category ID for prompt/apiKey selection
 * @returns {Promise<Object>} { endpoint, model, apiKey, prompt, hasCategorySettings }
 */
export async function getEffectiveSettings(categoryId = null) {
  const [userSettings, categorySettings] = await Promise.all([
    loadUserSettings(),
    categoryId ? loadCategoryAISettings(categoryId) : Promise.resolve({ apiKey: '', prompt: BUILTIN_DEFAULTS.prompt, hasSettings: false })
  ]);
  
  // Merge user settings with built-in defaults (user settings take priority)
  const endpoint = userSettings.endpoint || BUILTIN_DEFAULTS.endpoint;
  const model = userSettings.model || BUILTIN_DEFAULTS.model;
  const apiKey = categorySettings.apiKey || BUILTIN_DEFAULTS.apiKey;
  const prompt = categorySettings.prompt || BUILTIN_DEFAULTS.prompt;
  
  return { 
    endpoint, 
    model, 
    apiKey,
    prompt,
    hasCategorySettings: categorySettings.hasSettings || false,
    // 'browser' = user-provided key found for this category (direct Groq call),
    // 'none'    = no key in the browser -> caller falls back to the Netlify proxy.
    keySource: (categorySettings.apiKey && String(categorySettings.apiKey).trim() !== '') ? 'browser' : 'none'
  };
}

/* ------------------------------ Direct Groq API Call (when user provides API key) ------------------------------ */

/**
 * Call Groq API directly from browser (when user has provided their API key).
 * @param {Object} params
 * @param {string} params.endpoint
 * @param {string} params.model
 * @param {string} params.apiKey
 * @param {string} params.systemPrompt
 * @param {string} params.userInput
 * @param {boolean} [params.isImage] - Whether input is base64 image
 * @returns {Promise<Object>} { success, result, model, usage }
 */
async function callGroqDirect({ endpoint, model, apiKey, systemPrompt, userInput, isImage = false }) {
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: isImage ? [
      { type: 'text', text: userInput },
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${userInput}` } }
    ] : userInput }
  ];

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: 2048,
      temperature: 0.1
    })
  });

  const data = await response.json();

  if (!response.ok) {
    const providerMessage = data.error?.message || response.statusText || 'unknown error';
    throw new Error(`Groq: ${providerMessage} (HTTP ${response.status})`);
  }

  return {
    success: true,
    result: data.choices?.[0]?.message?.content || '',
    model: data.model || model,
    usage: data.usage
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

/* ------------------------------ Unified AI Call (Smart Routing) ------------------------------ */

/**
 * Main AI call function - routes to direct Groq if user has API key, otherwise Netlify Function.
 */
export async function callAI({ action, categoryId, input, prompt, isImage = false }) {
  const settings = await getEffectiveSettings(categoryId);
  
  let systemPrompt;
  if (prompt && typeof prompt === 'string' && prompt.trim().length > 0) {
    systemPrompt = prompt.trim();
  } else {
    switch (action) {
      case 'validate-address':
        systemPrompt = `You are an address validator and corrector for Bulgarian and German addresses.
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
- "ул. Витоша 10, 1000 София" → "ул. Витоша 10, 1000 София"`;
        break;
      case 'analyze-image':
        systemPrompt = `You are an AI image analyzer for watermarked photos.
Analyze the provided image and return a JSON object with:
{
  "hasWatermark": boolean,
  "watermarkPosition": "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center" | "unknown",
  "detectedText": "any visible text in watermark",
  "detectedElements": ["gps", "date", "qr-code", "weather", "number", "category", "step", "description"],
  "imageQuality": "good" | "fair" | "poor",
  "notes": "any observations"
}
Focus on detecting watermark elements and their positions.`;
        break;
      case 'extract-metadata':
        systemPrompt = `You are a metadata extractor for photos.
Extract and return ALL detectable metadata from the image as JSON:
{
  "exif": { "make": "", "model": "", "dateTime": "", "gps": { "lat": 0, "lon": 0, "alt": 0 }, ... },
  "dimensions": { "width": 0, "height": 0 },
  "fileSize": 0,
  "format": "jpeg|png|heic|...",
  "hasWatermark": boolean,
  "watermarkInfo": { "position": "...", "elements": [...] }
}
Extract as much detail as possible from the image data.`;
        break;
      case 'verify-content':
        systemPrompt = `You are a content verifier for categorized photos.
Given the category context and image, verify if the image content matches expectations.

Return JSON:
{
  "matchesCategory": boolean,
  "confidence": 0-100,
  "detectedObjects": ["object1", "object2", ...],
  "sceneDescription": "brief description of what's in the photo",
  "issues": ["any problems detected"],
  "recommendations": ["suggestions for better categorization"]
}
Be specific about what you see and whether it matches the expected category.`;
        break;
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }
  
  if (settings.apiKey && settings.apiKey.trim() !== '') {
    return callGroqDirect({
      endpoint: settings.endpoint,
      model: settings.model,
      apiKey: settings.apiKey,
      systemPrompt,
      userInput: input,
      isImage
    });
  } else {
    return callNetlifyAI({ action, categoryId, input, prompt: systemPrompt });
  }
}

/* ------------------------------ High-level AI Actions ------------------------------ */

/** Validate address using AI (for enrichment modal). Throws the provider error. */
export async function validateAddressWithAI(address, categoryId = null) {
  const result = await callAI({
    action: 'validate-address',
    categoryId,
    input: address
  });
  return result.result;
}

/** Analyze image using AI. Throws the provider error. */
export async function analyzeImageWithAI(base64Image, categoryId = null) {
  const result = await callAI({
    action: 'analyze-image',
    categoryId,
    input: base64Image,
    isImage: true
  });
  return result.result;
}

/** Extract metadata from image using AI. Throws the provider error. */
export async function extractMetadataWithAI(base64Image, categoryId = null) {
  const result = await callAI({
    action: 'extract-metadata',
    categoryId,
    input: base64Image,
    isImage: true
  });
  return result.result;
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
      endpoint: settings.endpoint,
      hasApiKey: !!(settings.apiKey && String(settings.apiKey).trim()),
      keySource: settings.keySource,
      // 'direct' = browser key -> straight to Groq; 'proxy' = Netlify function
      route: settings.keySource === 'browser' ? 'direct' : 'proxy'
    }
  };
}

/** Save AI settings from UI (global endpoint/model + per-category apiKey/prompt). */
export async function saveAISettings(categoryId, { endpoint, model, apiKey, prompt }) {
  try {
    // Save global settings (endpoint, model only)
    if (endpoint || model) {
      await saveUserSettings({ endpoint, model });
    }
    
    // Save category-specific settings (apiKey, prompt)
    if (categoryId && (apiKey !== undefined || prompt !== undefined)) {
      await saveCategoryAISettings(categoryId, { apiKey, prompt });
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
  // Returns { userSettings: {endpoint, model}, categorySettings: {apiKey, prompt, hasSettings} }
  const userSettings = await loadUserSettings();
  const categorySettings = categoryId ? await loadCategoryAISettings(categoryId) : { apiKey: '', prompt: BUILTIN_DEFAULTS.prompt, hasSettings: false };
  
  return {
    userSettings,
    categorySettings
  };
}

// Re-export storage functions for convenience
export { 
  loadUserSettings, 
  saveUserSettings, 
  loadCategoryAISettings,
  saveCategoryAISettings,
  deleteCategoryAISettings,
  loadCategoryPrompt, 
  saveCategoryPrompt, 
  deleteCategoryPrompt, 
  getGlobalDefaults 
};