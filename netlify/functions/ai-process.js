// netlify/functions/ai-process.js — Netlify Function proxy for AI processing
// Handles address validation, image analysis, metadata extraction via Groq/OpenAI-compatible APIs
// API Key is stored in Netlify environment variables (GROQ_API_KEY or OPENAI_API_KEY), never exposed to browser

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

  // Parse request body
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Invalid JSON body' })
    };
  }

  const { action, categoryId, input, prompt, model } = body;

  // Validate action
  const validActions = ['validate-address', 'analyze-image', 'extract-metadata', 'verify-content'];
  if (!action || !validActions.includes(action)) {
    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Invalid action. Valid: validate-address, analyze-image, extract-metadata, verify-content' })
    };
  }

  // Validate input
  if (!input || typeof input !== 'string' || input.trim() === '') {
    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Input required' })
    };
  }

  // Get API configuration from environment
  const apiKey = process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY;
  const defaultEndpoint = process.env.AI_ENDPOINT || 'https://api.groq.com/openai/v1/chat/completions';
  const defaultModel = process.env.AI_MODEL || 'llama-3.1-70b-versatile';

  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'AI service not configured. Missing API key.' })
    };
  }

  // Determine model and endpoint
  const useEndpoint = process.env.AI_ENDPOINT || defaultEndpoint;
  const useModel = model || process.env.AI_MODEL || defaultModel;

  try {
    // Build system prompt based on action and category
    let systemPrompt;
    
    if (action === 'validate-address') {
      systemPrompt = buildAddressPrompt(categoryId);
    } else if (action === 'analyze-image') {
      systemPrompt = buildImageAnalysisPrompt(categoryId);
    } else if (action === 'extract-metadata') {
      systemPrompt = buildMetadataExtractionPrompt(categoryId);
    } else if (action === 'verify-content') {
      systemPrompt = buildContentVerificationPrompt(categoryId);
    }

    // If custom prompt provided, use it (overrides default)
    if (prompt && typeof prompt === 'string' && prompt.trim().length > 0) {
      systemPrompt = prompt.trim();
    }

    // Build request payload
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: input }
    ];

    const payload = {
      model: useModel,
      messages,
      temperature: 0,
      max_tokens: 500
    };

    // Call AI API
    const response = await fetch(defaultEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('AI API error:', response.status, errorData);
      return {
        statusCode: response.status,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ 
          error: `AI API error: ${response.status}`,
          details: errorData.error?.message || response.statusText
        })
      };
    }

    const data = await response.json();
    const result = data.choices?.[0]?.message?.content?.trim() || '';

    return {
      statusCode: 200,
      headers: { 
        'Content-Type': 'application/json', 
        'Access-Control-Allow-Origin': '*' 
      },
      body: JSON.stringify({
        success: true,
        result,
        model: useModel,
        action,
        categoryId: categoryId || null,
        usage: data.usage
      })
    };

  } catch (err) {
    console.error('AI processing error:', err);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message || 'Internal server error' })
    };
  }
};

// ============================================================================
// PROMPT BUILDERS (per action, with category-specific defaults)
// ============================================================================

function buildAddressPrompt(categoryId) {
  // Category-specific address prompts could be loaded from DB in future
  // For now, use a comprehensive default
  return `You are an address validator and corrector for Bulgarian and German addresses.
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
}

function buildImageAnalysisPrompt(categoryId) {
  return `You are an AI image analyzer for watermarked photos.
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
}

function buildMetadataExtractionPrompt(categoryId) {
  return `You are a metadata extractor for photos.
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
}

function buildContentVerificationPrompt(categoryId) {
  return `You are a content verifier for categorized photos.
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
}