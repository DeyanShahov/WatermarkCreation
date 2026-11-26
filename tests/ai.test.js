import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as storage from '../src/modules/storage.js';
import {
  DEFAULT_AI_MODEL,
  DEFAULT_AI_ENDPOINT,
  getEffectiveSettings,
  callAI,
  validateAddressWithAI,
} from '../src/core/ai.js';

const GROQ_ERROR_BODY = { error: { message: 'The model is not available on this account' } };

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('defaults', () => {
  it('uses qwen/qwen3.8-27b everywhere', () => {
    expect(DEFAULT_AI_MODEL).toBe('qwen/qwen3.8-27b');
    expect(DEFAULT_AI_ENDPOINT).toBe('https://api.groq.com/openai/v1/chat/completions');
  });
});

describe('key priority (browser key first, proxy fallback)', () => {
  it('reports keySource "none" when the category has no browser key', async () => {
    await storage.saveCategory({ id: 'ai-nokey', name: 'Без ключ', steps: [] });
    const settings = await getEffectiveSettings('ai-nokey');
    expect(settings.keySource).toBe('none');
    expect(settings.model).toBe('qwen/qwen3.8-27b');
  });

  it('reports keySource "browser" and returns the stored key', async () => {
    await storage.saveCategory({ id: 'ai-withkey', name: 'С ключ', steps: [] });
    await storage.saveCategoryAISettings('ai-withkey', { apiKey: 'gsk_BROWSER', prompt: 'p' });

    const settings = await getEffectiveSettings('ai-withkey');
    expect(settings.keySource).toBe('browser');
    expect(settings.apiKey).toBe('gsk_BROWSER');
  });
});

describe('callAI routing', () => {
  it('routes to Groq directly when a browser key exists', async () => {
    await storage.saveCategory({ id: 'route-direct', name: 'Direct', steps: [] });
    await storage.saveCategoryAISettings('route-direct', { apiKey: 'gsk_DIRECT', prompt: 'p' });

    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'DIRECT RESULT' } }] }),
    });

    const result = await callAI({ action: 'validate-address', categoryId: 'route-direct', input: 'addr' });

    expect(result.result).toBe('DIRECT RESULT');
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(DEFAULT_AI_ENDPOINT);
    expect(init.headers.Authorization).toBe('Bearer gsk_DIRECT');
    expect(JSON.parse(init.body).model).toBe('qwen/qwen3.8-27b');
  });

  it('falls back to the Netlify proxy when no browser key exists', async () => {
    await storage.saveCategory({ id: 'route-proxy', name: 'Proxy', steps: [] });

    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, result: 'PROXY RESULT', model: 'qwen/qwen3.8-27b' }),
    });

    const result = await callAI({ action: 'validate-address', categoryId: 'route-proxy', input: 'addr' });

    expect(result.result).toBe('PROXY RESULT');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe('/.netlify/functions/ai-process');
  });

  it('surfaces the provider error instead of swallowing it', async () => {
    await storage.saveCategory({ id: 'route-error', name: 'Error', steps: [] });
    await storage.saveCategoryAISettings('route-error', { apiKey: 'gsk_BAD', prompt: 'p' });

    fetch.mockResolvedValue({ ok: false, status: 400, statusText: 'Bad Request', json: async () => GROQ_ERROR_BODY });

    await expect(
      validateAddressWithAI('address', 'route-error')
    ).rejects.toThrow(/model is not available/);
  });

  it('surfaces the proxy error message', async () => {
    await storage.saveCategory({ id: 'route-proxy-error', name: 'ProxyError', steps: [] });

    fetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'AI service not configured. Missing API key.' }),
    });

    await expect(
      callAI({ action: 'validate-address', categoryId: 'route-proxy-error', input: 'addr' })
    ).rejects.toThrow(/Missing API key/);
  });
});
