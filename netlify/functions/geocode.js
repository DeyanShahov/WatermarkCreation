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

  const userAgent = process.env.NOMINATIM_USER_AGENT || 'Mozilla/5.0 (compatible; WatermarkCreation/1.0; +https://watermark-creation.netlify.app/)';

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
      url.searchParams.set('countrycodes', 'bg,de'); // Bulgaria + Germany

      const response = await fetch(url.toString(), {
        headers: {
          'User-Agent': userAgent,
          'Accept': 'application/json',
          'Referer': 'https://watermark-creation.netlify.app/'
        }
      });

      if (!response.ok) continue;

      const data = await response.json();
      if (!Array.isArray(data) || data.length === 0) continue;

      const r = data[0];
      const addr = r.address ?? {};
      const place =
        addr.city ?? addr.town ?? addr.village ?? addr.municipality ?? addr.hamlet ?? addr.suburb ?? null;

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({
          lat: parseFloat(r.lat),
          lon: parseFloat(r.lon),
          // "Име на мястото" -> only the city/place name
          displayName: place,
          // Full address; the browser formats it from the raw parts below.
          address: r.display_name ?? address.trim(),
          addressParts: addr
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