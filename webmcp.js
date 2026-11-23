// @ts-check
/* ======================================================
   WebMCP — 把周易象数服务暴露给浏览器内的 AI agent
   ------------------------------------------------------
   The page registers four tools on `navigator.modelContext`:

     zhouyi_cast              随机起卦
     zhouyi_read              按六个 6–9 的爻值读卦
     zhouyi_hexagram          单卦原典 + 象意
     zhouyi_list_hexagrams    六十四卦索引

   Tools call the same /api/v1 service the human UI uses. They return
   only the three core layers; session expiry and personalized
   interpretation stay out of the tool contract.
   ====================================================== */

const DEFAULT_API_BASE = '/api/v1';

/**
 * @typedef {object} ToolSpec
 * @property {string} name
 * @property {string} description
 * @property {Record<string, unknown>} inputSchema
 * @property {(input: Record<string, unknown>) => Promise<unknown>} execute
 */

/**
 * @typedef {object} ToolDefinition
 * @property {string} name
 * @property {string} description
 * @property {Record<string, unknown>} inputSchema
 */

/** @type {[ToolDefinition, ToolDefinition, ToolDefinition, ToolDefinition]} */
export const TOOL_DEFINITIONS = [
  {
    name: 'zhouyi_cast',
    description:
      '随机投掷三枚硬币六次，返回周易卦象。结果只含象数骨架（六爻值、本卦、变卦、互卦、动爻、变爻规则）、原典文本（卦辞、爻辞、彖传、象传）与客观象意（八卦属性、爻位关系）；不含时效判断，也不含个人化吉凶断语。',
    inputSchema: {
      type: 'object',
      properties: {
        edition: {
          type: 'string',
          description: '底本名称，默认“通行本”。',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'zhouyi_read',
    description:
      '按六个 6–9 的爻值读卦（6=老阴、7=少阳、8=少阴、9=老阳，自下而上）。返回象数骨架、原典文本与客观象意三层数据，不做个人处境推演。',
    inputSchema: {
      type: 'object',
      properties: {
        numbers: {
          type: 'array',
          description: '六个 6–9 的整数，初爻在前。',
          items: { type: 'integer', minimum: 6, maximum: 9 },
          minItems: 6,
          maxItems: 6,
        },
        edition: {
          type: 'string',
          description: '底本名称，默认“通行本”。',
        },
      },
      required: ['numbers'],
      additionalProperties: false,
    },
  },
  {
    name: 'zhouyi_hexagram',
    description:
      '按卦序号（1–64）取单卦资料：卦辞、爻辞、彖传、大象与小象原文，以及八卦属性和爻位关系。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer', minimum: 1, maximum: 64 },
        edition: {
          type: 'string',
          description: '底本名称，默认“通行本”。',
        },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'zhouyi_list_hexagrams',
    description:
      '列出六十四卦的序号、卦名、卦符、六位二进制与上下卦，便于后续按 id 取单卦资料。',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
];

/**
 * @typedef {object} ModelContext
 * @property {(tool: any) => void} [registerTool]
 * @property {(context: any) => void} [provideContext]
 */

/** @returns {ModelContext | undefined} */
function getModelContext() {
  if (typeof navigator === 'undefined') return undefined;
  return /** @type {ModelContext | undefined} */ (
    /** @type {any} */ (navigator).modelContext
  );
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {string} apiBase
 * @param {string} path
 * @param {{ method?: string, body?: Record<string, unknown> }} [options]
 * @param {typeof fetch} [fetchImpl]
 */
async function callApi(apiBase, path, options = {}, fetchImpl = fetch) {
  const method = options.method || 'GET';
  const response = await fetchImpl(`${apiBase}${path}`, {
    method,
    headers: options.body ? { 'content-type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`服务返回了非 JSON 响应（HTTP ${response.status}）`);
  }

  if (!response.ok || !isObject(payload) || payload.ok !== true) {
    const error = isObject(payload) && isObject(payload.error) ? payload.error : {};
    throw new Error(
      String(error.message || `服务请求失败（HTTP ${response.status}）`)
    );
  }
  return payload.data;
}

/**
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {string} [options.apiBase]
 * @returns {ToolSpec[]}
 */
export function createWebMCPTools(options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const apiBase = options.apiBase || DEFAULT_API_BASE;

  /** @param {unknown} input */
  const asInput = (input) => (isObject(input) ? input : {});

  return [
    {
      ...TOOL_DEFINITIONS[0],
      execute: async (input) => {
        const value = asInput(input);
        return callApi(
          apiBase,
          '/cast',
          { method: 'POST', body: { edition: value.edition } },
          fetchImpl
        );
      },
    },
    {
      ...TOOL_DEFINITIONS[1],
      execute: async (input) => {
        const value = asInput(input);
        return callApi(
          apiBase,
          '/readings',
          {
            method: 'POST',
            body: { numbers: value.numbers, edition: value.edition },
          },
          fetchImpl
        );
      },
    },
    {
      ...TOOL_DEFINITIONS[2],
      execute: async (input) => {
        const value = asInput(input);
        const query =
          typeof value.edition === 'string' && value.edition
            ? `?edition=${encodeURIComponent(value.edition)}`
            : '';
        return callApi(apiBase, `/hexagrams/${value.id}${query}`, {}, fetchImpl);
      },
    },
    {
      ...TOOL_DEFINITIONS[3],
      execute: async () => callApi(apiBase, '/hexagrams', {}, fetchImpl),
    },
  ];
}

/**
 * Wrap a tool result in the shape browser agents expect.
 * @param {unknown} result
 */
function toolResult(result) {
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    structuredContent: result,
  };
}

/**
 * @param {object} [options]
 * @param {ModelContext} [options.modelContext]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {string} [options.apiBase]
 * @returns {ToolSpec[]} registered tools (empty when WebMCP is unavailable)
 */
export function registerWebMCP(options = {}) {
  const modelContext = options.modelContext || getModelContext();
  if (!modelContext) return [];

  const tools = createWebMCPTools(options).map((tool) => ({
    ...tool,
    /** @param {Record<string, unknown>} input */
    execute: async (input) => {
      try {
        return toolResult(await tool.execute(input));
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `错误：${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  }));

  if (typeof modelContext.registerTool === 'function') {
    for (const tool of tools) modelContext.registerTool(tool);
  } else if (typeof modelContext.provideContext === 'function') {
    modelContext.provideContext({ tools });
  } else {
    return [];
  }

  return tools;
}

// Auto-register on real WebMCP-enabled browsers; harmless in tests / dev.
if (getModelContext()) {
  try {
    const tools = registerWebMCP();
    if (tools.length > 0) {
      console.info(`[WebMCP] 已注册 ${tools.length} 个周易工具`);
    }
  } catch (error) {
    console.warn('[WebMCP] 注册失败', error);
  }
}
