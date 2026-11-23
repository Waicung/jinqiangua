import { describe, expect, test } from 'bun:test';
import {
  apiError,
  generateContentUrl,
  parseGenerateContentReply,
  parseInteractionReply,
  requestGemini,
  stripEnd,
} from '../gemini.js';

const KEY = 'AIza-test';
const MODEL = 'gemini-3.8-flash';

function reply(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** 记录调用的假 fetch：按顺序吐出给定响应 */
function fakeFetch(responses) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: String(url), init });
    const next = responses.shift();
    if (!next) throw new Error('unexpected fetch call');
    return next;
  };
  return { calls, impl };
}

function baseRequest(overrides = {}) {
  return {
    key: KEY,
    model: MODEL,
    text: '这次卦象的核心提示是什么？',
    history: [{ role: 'user', text: '这次卦象的核心提示是什么？' }],
    system: '你是解卦师',
    session: null,
    ...overrides,
  };
}

const INTERACTION_OK = {
  id: 'v1_abc',
  status: 'completed',
  steps: [
    { type: 'model_output', content: [{ type: 'text', text: '本卦为' }, { type: 'text', text: '既济。' }] },
    { type: 'other', content: [{ type: 'text', text: '忽略我' }] },
  ],
};

describe('parseInteractionReply', () => {
  test('拼接 model_output 的 text 块并带回 id', () => {
    const parsed = parseInteractionReply(INTERACTION_OK);
    expect(parsed.text).toBe('本卦为既济。');
    expect(parsed.id).toBe('v1_abc');
    expect(parsed.reason).toBe('');
  });

  test('没有内容时返回空文本与 status 作为 reason', () => {
    const parsed = parseInteractionReply({ id: 'v1_x', status: 'in_progress', steps: [] });
    expect(parsed.text).toBe('');
    expect(parsed.reason).toBe('in_progress');
  });

  test('坏数据不抛错', () => {
    expect(parseInteractionReply(null).text).toBe('');
    expect(parseInteractionReply({}).id).toBe('');
  });
});

describe('parseGenerateContentReply', () => {
  test('拼接 candidates[0].content.parts 的文本', () => {
    const parsed = parseGenerateContentReply({
      candidates: [{ content: { parts: [{ text: '潜龙' }, { text: '勿用' }] }, finishReason: 'STOP' }],
    });
    expect(parsed.text).toBe('潜龙勿用');
    expect(parsed.reason).toBe('STOP');
  });

  test('promptFeedback.blockReason 优先作为 reason', () => {
    const parsed = parseGenerateContentReply({
      promptFeedback: { blockReason: 'SAFETY' },
      candidates: [{ content: { parts: [] }, finishReason: 'OTHER' }],
    });
    expect(parsed.reason).toBe('SAFETY');
  });
});

describe('apiError — 可读的中文错误', () => {
  test('400 + api key 提示 Key 无效', () => {
    expect(apiError(400, { error: { message: 'API key not valid' } }, MODEL).message).toContain(
      'API Key 无效'
    );
  });

  test('401 / 403 引导换模型', () => {
    const msg = apiError(403, { error: { message: 'denied.' } }, MODEL).message;
    expect(msg).toContain(MODEL);
    expect(msg).toContain('更换 / 清除');
    expect(msg).not.toContain('.。');
  });

  test('404 提示模型不可用并给出可用模型名', () => {
    const msg = apiError(404, {}, MODEL).message;
    expect(msg).toContain('gemini-3.8-flash');
    expect(msg).toContain('gemini-flash-latest');
  });

  test('429 提示额度用尽', () => {
    expect(apiError(429, {}, MODEL).message).toContain('额度已用尽');
  });

  test('其他状态回落到上游文案或 HTTP 码', () => {
    expect(apiError(500, { error: { message: 'boom' } }, MODEL).message).toBe('boom');
    expect(apiError(502, {}, MODEL).message).toContain('HTTP 502');
  });
});

describe('stripEnd', () => {
  test('去掉句尾的中英文句点', () => {
    expect(stripEnd('不可用.')).toBe('不可用');
    expect(stripEnd('不可用。')).toBe('不可用');
    expect(stripEnd(' 不可用  ')).toBe('不可用');
    expect(stripEnd(null)).toBe('');
  });
});

describe('requestGemini — 传输层与回退', () => {
  test('优先 Interactions API，并只发本轮新输入', async () => {
    const { calls, impl } = fakeFetch([reply(200, INTERACTION_OK)]);
    const result = await requestGemini({
      ...baseRequest(),
      fetchImpl: /** @type {any} */ (impl),
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/v1beta/interactions');
    const body = JSON.parse(calls[0].init.body);
    expect(body.input).toBe('这次卦象的核心提示是什么？');
    expect(body.system_instruction).toBe('你是解卦师');
    expect(body.previous_interaction_id).toBeUndefined();
    expect(calls[0].init.headers['x-goog-api-key']).toBe(KEY);

    expect(result).toEqual({ text: '本卦为既济。', id: 'v1_abc', transport: 'interactions' });
  });

  test('会话里已有句柄时带 previous_interaction_id', async () => {
    const { calls, impl } = fakeFetch([reply(200, INTERACTION_OK)]);
    await requestGemini({
      ...baseRequest({ session: { previousInteractionId: 'v1_prev', transport: 'interactions' } }),
      fetchImpl: /** @type {any} */ (impl),
    });
    expect(JSON.parse(calls[0].init.body).previous_interaction_id).toBe('v1_prev');
  });

  test('默认模型名用来拼 generateContent 的 URL', () => {
    expect(generateContentUrl(MODEL)).toContain(`/models/${MODEL}:generateContent`);
  });

  test('Interactions 返回 404 时回退到 generateContent', async () => {
    const { calls, impl } = fakeFetch([
      reply(404, { error: { message: 'not found' } }),
      reply(200, { candidates: [{ content: { parts: [{ text: '回退成功' }] } }] }),
    ]);
    const result = await requestGemini({
      ...baseRequest(),
      fetchImpl: /** @type {any} */ (impl),
    });

    expect(calls).toHaveLength(2);
    expect(calls[1].url).toContain(':generateContent');
    const body = JSON.parse(calls[1].init.body);
    expect(body.systemInstruction.parts[0].text).toBe('你是解卦师');
    expect(body.contents).toHaveLength(1);
    expect(result.transport).toBe('generateContent');
    expect(result.text).toBe('回退成功');
  });

  test('已记住 generateContent 时不再先试 Interactions', async () => {
    const { calls, impl } = fakeFetch([
      reply(200, { candidates: [{ content: { parts: [{ text: '直接回退' }] } }] }),
    ]);
    const result = await requestGemini({
      ...baseRequest({ session: { transport: 'generateContent' } }),
      fetchImpl: /** @type {any} */ (impl),
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain(':generateContent');
    expect(result.transport).toBe('generateContent');
  });

  test('401 / 403 不触发回退，直接抛可读错误', async () => {
    const { calls, impl } = fakeFetch([reply(403, { error: { message: 'denied' } })]);
    await expect(
      requestGemini({ ...baseRequest(), fetchImpl: /** @type {any} */ (impl) })
    ).rejects.toThrow(/无权访问模型/);
    expect(calls).toHaveLength(1);
  });

  test('200 但没有正文时抛「未返回内容」', async () => {
    const { impl } = fakeFetch([reply(200, { id: 'v1_x', status: 'in_progress', steps: [] })]);
    await expect(
      requestGemini({ ...baseRequest(), fetchImpl: /** @type {any} */ (impl) })
    ).rejects.toThrow(/模型未返回内容（in_progress）/);
  });

  test('网络错误变成可读文案', async () => {
    const impl = async () => {
      throw new TypeError('Failed to fetch');
    };
    await expect(
      requestGemini({ ...baseRequest(), fetchImpl: /** @type {any} */ (impl) })
    ).rejects.toThrow(/网络错误/);
  });
});
