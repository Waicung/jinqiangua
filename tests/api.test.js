import { describe, expect, test } from 'bun:test';
import worker from '../src/worker.js';

const call = (path, init = {}, env = {}) =>
  worker.fetch(new Request(`https://example.com${path}`, init), env);

const getJson = async (response) => {
  expect(response.headers.get('content-type')).toContain('application/json');
  return response.json();
};

const postJson = (path, body) =>
  call(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('HTTP API /api/v1', () => {
  test('GET /api/v1 自述三层与排除边界', async () => {
    const response = await call('/api/v1');
    expect(response.status).toBe(200);
    const payload = await getJson(response);
    expect(payload.ok).toBe(true);
    expect(payload.data.layers.skeleton).toContain('本卦');
    expect(payload.data.layers.text).toContain('彖传');
    expect(payload.data.layers.imagery).toContain('爻位');
    expect(payload.data.excluded.session).toContain('有效期');
    expect(payload.data.excluded.interpretation).toContain('吉凶');
  });

  test('GET /api/v1/health', async () => {
    const payload = await getJson(await call('/api/v1/health'));
    expect(payload).toEqual({
      ok: true,
      data: { status: 'ok', schema: 'zhouyi.reading/v1' },
    });
  });

  test('GET /api/v1/hexagrams 返回 64 卦索引', async () => {
    const payload = await getJson(await call('/api/v1/hexagrams'));
    expect(payload.ok).toBe(true);
    expect(payload.data.hexagrams).toHaveLength(64);
    expect(payload.data.editions).toEqual(['通行本']);
  });

  test('GET /api/v1/hexagrams/:id 返回原典与象意', async () => {
    const payload = await getJson(await call('/api/v1/hexagrams/1'));
    expect(payload.data.hexagram.name).toBe('乾');
    expect(payload.data.text.image.great).toContain('天行健');
    expect(payload.data.imagery.lines).toHaveLength(6);
  });

  test('未知卦号返回 404 JSON', async () => {
    const response = await call('/api/v1/hexagrams/999');
    expect(response.status).toBe(404);
    const payload = await getJson(response);
    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe('hexagram_not_found');
  });

  test('POST /api/v1/readings 校验六爻并返回三层', async () => {
    const payload = await getJson(
      await postJson('/api/v1/readings', { numbers: [6, 7, 8, 9, 7, 8] })
    );
    expect(payload.ok).toBe(true);
    expect(payload.data.skeleton.primary.name).toBe('困');
    expect(payload.data.skeleton.nuclear.name).toBe('家人');
    expect(payload.data.text.primary.tuan.length).toBeGreaterThan(0);
    expect(payload.data.imagery.primary.keywords).toContain('险陷');
  });

  test('非法六爻返回 400 且不泄露内部错误', async () => {
    for (const numbers of [[], [7, 7, 7, 7, 7], [7, 7, 7, 7, 7, 10], '777777']) {
      const response = await postJson('/api/v1/readings', { numbers });
      expect(response.status).toBe(400);
      const payload = await getJson(response);
      expect(payload.ok).toBe(false);
      expect(payload.error.code).toBe('invalid_numbers');
    }
  });

  test('非法 JSON 返回 400', async () => {
    const response = await call('/api/v1/readings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });
    expect(response.status).toBe(400);
    const payload = await getJson(response);
    expect(payload.error.code).toBe('invalid_json');
  });

  test('未知底本返回 400 与可用底本', async () => {
    const response = await postJson('/api/v1/readings', {
      numbers: [7, 8, 7, 8, 7, 8],
      edition: '帛书',
    });
    expect(response.status).toBe(400);
    const payload = await getJson(response);
    expect(payload.error.code).toBe('unknown_edition');
    expect(payload.error.available).toEqual(['通行本']);
  });

  test('POST /api/v1/cast 返回六爻值与三层数据', async () => {
    const payload = await getJson(await postJson('/api/v1/cast', {}));
    expect(payload.data.numbers).toHaveLength(6);
    expect(payload.data.numbers.every((n) => n >= 6 && n <= 9)).toBe(true);
    expect(payload.data.reading.skeleton.numbers).toEqual(payload.data.numbers);
  });

  test('CORS 预检', async () => {
    const response = await call('/api/v1/readings', { method: 'OPTIONS' });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-allow-methods')).toContain('POST');
  });

  test('未知接口返回 JSON 404', async () => {
    const response = await call('/api/v1/nope');
    expect(response.status).toBe(404);
    expect((await getJson(response)).error.code).toBe('not_found');
  });

  test('非 API 请求交给静态资产绑定', async () => {
    const response = await call('/', {}, {
      ASSETS: {
        fetch: async () => new Response('asset', { status: 200 }),
      },
    });
    expect(await response.text()).toBe('asset');
  });
});
