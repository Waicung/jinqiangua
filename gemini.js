// @ts-check
/* ======================================================
   gemini — the transport for 本机对话
   ------------------------------------------------------
   One function: requestGemini(). Everything about how the
   browser talks to Gemini lives behind it:

   - Key travels in the x-goog-api-key header (never in the
     URL / logs / Referer).
   - Interactions API (2026-06 GA) is preferred: only the new
     input is sent, history is kept server-side behind
     previous_interaction_id.
   - On 404 / 405 the legacy generateContent transport is
     tried, replaying the full contents array. The working
     transport is returned so the caller can remember it on
     the 会话 record.
   - Errors become readable Chinese messages; statuses other
     than 404/405 never trigger a fallback.

   No DOM, no module state, no storage. The 会话 record is an
   input (previousInteractionId / transport) and is never
   mutated here — the caller writes it back through the store.
   ====================================================== */

/** @typedef {'interactions'|'generateContent'} Transport */

/**
 * @typedef {object} GeminiSessionHandle
 * @property {string} [previousInteractionId]
 * @property {Transport} [transport]
 */

/**
 * @typedef {object} GeminiRequest
 * @property {string} key
 * @property {string} model
 * @property {string} text
 * @property {{ role: 'user' | 'model', text: string }[]} history  generateContent 需要重放完整上下文
 * @property {string} system
 * @property {GeminiSessionHandle | null} session
 * @property {typeof fetch} [fetchImpl]
 */

/**
 * @typedef {object} GeminiReply
 * @property {string} text
 * @property {string} id
 * @property {Transport} transport
 */

export const CHAT_TIMEOUT_MS = 60000;
export const INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';

/**
 * @param {string} model
 * @returns {string}
 */
export function generateContentUrl(model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

/**
 * @param {string | null | undefined} model
 * @returns {string}
 */
export function normalizeModel(model) {
  const clean = String(model || '').trim().replace(/^models\//, '');
  return clean;
}

/**
 * @param {string} url
 * @param {unknown} body
 * @param {string} key
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<{ res: Response, data: any }>}
 */
async function postJson(url, body, key, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // 用 header 传 Key，避免出现在 URL / 日志 / Referer 中
        'x-goog-api-key': key,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => null);
    return { res, data };
  } catch (err) {
    const name = /** @type {any} */ (err).name;
    throw new Error(
      name === 'AbortError' ? '请求超时，请稍后重试' : '网络错误，无法连接 Gemini'
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Interactions API：只需发本轮新输入，历史由 previous_interaction_id 维护。
 * system_instruction 是 interaction 级别的，每轮都要重发。
 * @param {GeminiRequest} request
 * @param {typeof fetch} fetchImpl
 */
function callInteractions(request, fetchImpl) {
  /** @type {Record<string, unknown>} */
  const body = {
    model: request.model,
    input: request.text,
    system_instruction: request.system,
  };
  const previousInteractionId =
    request.session && request.session.previousInteractionId;
  if (previousInteractionId) body.previous_interaction_id = previousInteractionId;
  return postJson(INTERACTIONS_URL, body, request.key, fetchImpl);
}

/**
 * 旧接口 generateContent：需重放完整 contents。
 * @param {GeminiRequest} request
 * @param {typeof fetch} fetchImpl
 */
function callGenerateContent(request, fetchImpl) {
  return postJson(
    generateContentUrl(request.model),
    {
      systemInstruction: { parts: [{ text: request.system }] },
      contents: request.history.map((m) => ({
        role: m.role,
        parts: [{ text: m.text }],
      })),
    },
    request.key,
    fetchImpl
  );
}

/**
 * @param {any} data
 * @returns {{ text: string, id: string, reason: string }}
 */
export function parseInteractionReply(data) {
  const steps = (data && data.steps) || [];
  /** @type {string[]} */
  const texts = [];
  for (const step of steps) {
    if (step.type !== 'model_output' || !Array.isArray(step.content)) continue;
    for (const block of step.content) {
      if (block.type === 'text' && typeof block.text === 'string') texts.push(block.text);
    }
  }
  const text = texts.join('').trim();
  // status 只在没有正文时才是「未返回内容」的理由，completed 不是失败
  const reason = text ? '' : (data && data.status) || '';
  return { text, id: (data && data.id) || '', reason };
}

/**
 * @param {any} data
 * @returns {{ text: string, id: string, reason: string }}
 */
export function parseGenerateContentReply(data) {
  const candidate = data && data.candidates && data.candidates[0];
  const parts = (candidate && candidate.content && candidate.content.parts) || [];
  const reason =
    (data && data.promptFeedback && data.promptFeedback.blockReason) ||
    (candidate && candidate.finishReason) ||
    '';
  return {
    text: parts.map((/** @type {any} */ p) => p.text || '').join('').trim(),
    id: '',
    reason,
  };
}

/** 上游文案自带句点时避免出现「.。」这样的双标点 */
/**
 * @param {unknown} msg
 * @returns {string}
 */
export function stripEnd(msg) {
  return String(msg || '').trim().replace(/[.。]$/, '');
}

/**
 * @param {number} status
 * @param {any} data
 * @param {string} model
 * @returns {Error}
 */
export function apiError(status, data, model) {
  const msg = (data && data.error && data.error.message) || '';
  if (status === 400 && /api key/i.test(msg)) {
    return new Error('API Key 无效，请检查后重新保存');
  }
  if (status === 401 || status === 403) {
    return new Error(
      `该 Key 无权访问模型「${model}」：${stripEnd(msg) || '请确认该模型已对你的账号开放'} 可在「更换 / 清除」中换个模型名（如 gemini-flash-latest）。`
    );
  }
  if (status === 404) {
    return new Error(
      `模型「${model}」不可用：${stripEnd(msg) || '可能已对新用户下线'} 请在「更换 / 清除」中改为 gemini-3.8-flash 或 gemini-flash-latest。`
    );
  }
  if (status === 429) return new Error('调用额度已用尽，请稍后重试或更换 Key');
  return new Error(msg || `请求失败（HTTP ${status}）`);
}

/**
 * Send one 追问 and return the answer.
 *
 * Fallback rule: a transport is only swapped when the endpoint itself is
 * missing (404 / 405). Any other failure is a real error for the user.
 *
 * @param {GeminiRequest} request
 * @returns {Promise<GeminiReply>}
 */
export async function requestGemini(request) {
  const fetchImpl = request.fetchImpl || fetch;

  // 记住上次成功的传输层；首次默认 Interactions API
  const preferred = request.session && request.session.transport;
  /** @type {Transport[]} */
  const attempts =
    preferred === 'generateContent'
      ? ['generateContent']
      : ['interactions', 'generateContent'];

  /** @type {{ res: Response, data: any } | null} */
  let result = null;
  for (const transport of attempts) {
    result = transport === 'interactions'
      ? await callInteractions(request, fetchImpl)
      : await callGenerateContent(request, fetchImpl);

    if (result.res.ok) {
      const reply = transport === 'interactions'
        ? parseInteractionReply(result.data)
        : parseGenerateContentReply(result.data);

      if (reply.text) return { text: reply.text, id: reply.id || '', transport };

      // in_progress / requires_action 等：明确告知而不是空回复
      throw new Error(
        reply.reason ? `模型未返回内容（${reply.reason}）` : '模型未返回内容'
      );
    }

    // 只有「接口不存在」才值得换另一条路，其余错误直接抛
    if (result.res.status !== 404 && result.res.status !== 405) break;
  }

  const last = /** @type {{ res: Response, data: any }} */ (result);
  throw apiError(last.res.status, last.data, request.model);
}
