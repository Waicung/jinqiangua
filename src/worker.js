// @ts-check
/* ======================================================
   Cloudflare Worker — 周易象数 HTTP API
   ------------------------------------------------------
   Routes (all under /api/v1):
     GET  /api/v1                     service description
     GET  /api/v1/health
     GET  /api/v1/hexagrams          64 卦索引
     GET  /api/v1/hexagrams/:id      单卦：原典 + 象意
     POST /api/v1/readings           六爻值 → 三层读卦
     POST /api/v1/cast               随机起卦 → 三层读卦

   The API exposes the three core layers only. Session expiry,
   re-cast state and personalized interpretation are not part of it.
   ====================================================== */

import rawTable from '../data/iching.json';
import rawCanonicalData from '../data/canonical.json';
import { UnknownEditionError, listEditions } from '../canonical.js';
import {
  buildHexagram,
  buildReading,
  castReading,
  describeService,
  listHexagrams,
} from '../service.js';

/** @typedef {{ ASSETS?: { fetch: (request: Request) => Promise<Response> } }} Env */

/** @type {import('../hexagram.js').HexagramTable} */
const table = /** @type {any} */ (rawTable);
/** @type {import('../canonical.js').CanonicalData} */
const canonicalData = /** @type {any} */ (rawCanonicalData);

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
};

/**
 * @param {unknown} data
 * @param {number} [status]
 * @param {Record<string, string>} [headers]
 */
function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...CORS,
      ...headers,
    },
  });
}

/**
 * @param {string} code
 * @param {string} message
 * @param {number} [status]
 * @param {Record<string, unknown>} [extra]
 */
function fail(code, message, status = 400, extra = {}) {
  return json({ ok: false, error: { code, message, ...extra } }, status);
}

/**
 * @param {Request} request
 * @returns {Promise<Record<string, unknown>>}
 */
async function readBody(request) {
  const text = await request.text();
  if (!text.trim()) return {};
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw Object.assign(new Error('请求体必须是合法 JSON'), {
      code: 'invalid_json',
    });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw Object.assign(new Error('请求体必须是 JSON 对象'), {
      code: 'invalid_body',
    });
  }
  return /** @type {Record<string, unknown>} */ (parsed);
}

/**
 * @param {unknown} edition
 * @returns {string | undefined}
 */
function editionOf(edition) {
  if (edition === undefined || edition === null || edition === '') return undefined;
  if (typeof edition !== 'string') {
    throw Object.assign(new Error('edition 必须是字符串'), {
      code: 'invalid_edition',
    });
  }
  return edition;
}

/**
 * @param {unknown} value
 * @returns {number[]}
 */
function numbersOf(value) {
  const valid =
    Array.isArray(value) &&
    value.length === 6 &&
    value.every(
      (number) => typeof number === 'number' && Number.isInteger(number) && number >= 6 && number <= 9
    );
  if (!valid) {
    throw Object.assign(new Error('numbers 必须是六个 6–9 的整数'), {
      code: 'invalid_numbers',
    });
  }
  return value;
}

/**
 * @param {unknown} error
 */
function errorResponse(error) {
  if (error instanceof UnknownEditionError) {
    return fail(error.code, error.message, 400, {
      available: error.available,
    });
  }
  const e = /** @type {{ code?: string, message?: string }} */ (error);
  if (e && (e.code === 'invalid_json' || e.code === 'invalid_body')) {
    return fail(e.code, e.message || '请求体无效', 400);
  }
  if (e && e.code === 'invalid_edition') {
    return fail('invalid_edition', e.message || '底本无效', 400, {
      available: listEditions(canonicalData),
    });
  }
  if (e && typeof e.code === 'string') {
    return fail(e.code, e.message || '请求无效', 400);
  }
  if (error instanceof RangeError || error instanceof TypeError) {
    return fail(e?.code || 'invalid_input', e?.message || '输入不符合六爻契约', 400);
  }
  console.error(error);
  return fail('internal_error', '服务内部错误', 500);
}

/**
 * @param {Request} request
 * @param {Env} env
 * @param {URL} url
 */
async function handleApi(request, env, url) {
  const method = request.method.toUpperCase();
  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  const parts = url.pathname
    .replace(/^\/api\/?/, '')
    .split('/')
    .filter(Boolean);

  if (parts[0] !== 'v1') {
    return fail('not_found', '未知 API 版本，请使用 /api/v1', 404);
  }

  // GET /api/v1
  if (parts.length === 1) {
    if (method !== 'GET') return fail('method_not_allowed', '只支持 GET', 405);
    return json({ ok: true, data: describeService(canonicalData) });
  }

  // GET /api/v1/health
  if (parts[1] === 'health') {
    if (method !== 'GET') return fail('method_not_allowed', '只支持 GET', 405);
    return json({
      ok: true,
      data: { status: 'ok', schema: 'zhouyi.reading/v1' },
    });
  }

  // GET /api/v1/hexagrams
  if (parts[1] === 'hexagrams' && parts.length === 2) {
    if (method !== 'GET') return fail('method_not_allowed', '只支持 GET', 405);
    return json({
      ok: true,
      data: {
        editions: listEditions(canonicalData),
        hexagrams: listHexagrams(table),
      },
    });
  }

  // GET /api/v1/hexagrams/:id
  if (parts[1] === 'hexagrams' && parts.length === 3) {
    if (method !== 'GET') return fail('method_not_allowed', '只支持 GET', 405);
    const id = Number(parts[2]);
    if (!Number.isInteger(id)) {
      return fail('invalid_hexagram_id', '卦序号必须是整数', 400);
    }
    const edition = editionOf(url.searchParams.get('edition') || undefined);
    const data = buildHexagram(id, { table, canonicalData, edition });
    if (!data) return fail('hexagram_not_found', `没有第 ${id} 卦`, 404);
    return json({ ok: true, data });
  }

  // POST /api/v1/readings
  if (parts[1] === 'readings' && parts.length === 2) {
    if (method !== 'POST') return fail('method_not_allowed', '只支持 POST', 405);
    const body = await readBody(request);
    const numbers = numbersOf(body.numbers);
    const edition = editionOf(body.edition);
    return json({
      ok: true,
      data: buildReading(numbers, { table, canonicalData, edition }),
    });
  }

  // POST /api/v1/cast
  if (parts[1] === 'cast' && parts.length === 2) {
    if (method !== 'POST') return fail('method_not_allowed', '只支持 POST', 405);
    const body = await readBody(request);
    const edition = editionOf(body.edition);
    return json({
      ok: true,
      data: castReading({ table, canonicalData, edition }),
    });
  }

  return fail('not_found', '未知接口', 404);
}

export default {
  /**
   * @param {Request} request
   * @param {Env} env
   */
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env, url);
      } catch (error) {
        return errorResponse(error);
      }
    }

    if (env?.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Not Found', { status: 404 });
  },
};
