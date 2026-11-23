import { describe, expect, test } from 'bun:test';
import {
  TOOL_DEFINITIONS,
  createWebMCPTools,
  registerWebMCP,
} from '../webmcp.js';

const okFetch = (calls) => async (url, init = {}) => {
  calls.push({
    url: String(url),
    method: init.method || 'GET',
    body: init.body ? JSON.parse(String(init.body)) : null,
  });
  return new Response(
    JSON.stringify({ ok: true, data: { echoed: String(url) } }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
};

describe('WebMCP 工具定义', () => {
  test('四个工具都强调三层内容与排除边界', () => {
    expect(TOOL_DEFINITIONS.map((tool) => tool.name)).toEqual([
      'zhouyi_cast',
      'zhouyi_read',
      'zhouyi_hexagram',
      'zhouyi_list_hexagrams',
    ]);
    expect(TOOL_DEFINITIONS[0].description).toContain('象数骨架');
    expect(TOOL_DEFINITIONS[0].description).toContain('不含时效判断');
    expect(TOOL_DEFINITIONS[1].inputSchema.required).toEqual(['numbers']);
  });

  test('zhouyi_read 把六爻值 POST 到 /readings', async () => {
    const calls = [];
    const tools = createWebMCPTools({ fetchImpl: okFetch(calls) });
    const read = tools.find((tool) => tool.name === 'zhouyi_read');
    const result = await read.execute({ numbers: [6, 7, 8, 9, 7, 8] });

    expect(result.echoed).toContain('/api/v1/readings');
    expect(calls).toEqual([
      {
        url: '/api/v1/readings',
        method: 'POST',
        body: { numbers: [6, 7, 8, 9, 7, 8] },
      },
    ]);
  });

  test('zhouyi_hexagram 对 edition 做 URL 编码', async () => {
    const calls = [];
    const tools = createWebMCPTools({ fetchImpl: okFetch(calls) });
    const hexagram = tools.find((tool) => tool.name === 'zhouyi_hexagram');
    await hexagram.execute({ id: 1, edition: '通行 本' });
    expect(calls[0].url).toBe('/api/v1/hexagrams/1?edition=%E9%80%9A%E8%A1%8C%20%E6%9C%AC');
  });

  test('服务端错误转成可读 Error', async () => {
    const tools = createWebMCPTools({
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            ok: false,
            error: { code: 'invalid_numbers', message: 'numbers 必须是六个 6–9 的整数' },
          }),
          { status: 400, headers: { 'content-type': 'application/json' } }
        ),
    });
    const read = tools.find((tool) => tool.name === 'zhouyi_read');
    await expect(read.execute({ numbers: [] })).rejects.toThrow(
      'numbers 必须是六个 6–9 的整数'
    );
  });
});

describe('WebMCP 注册', () => {
  test('优先使用 registerTool', () => {
    const registered = [];
    const tools = registerWebMCP({
      modelContext: { registerTool: (tool) => registered.push(tool) },
      fetchImpl: okFetch([]),
    });
    expect(tools).toHaveLength(4);
    expect(registered).toHaveLength(4);
    expect(registered[0].name).toBe('zhouyi_cast');
  });

  test('退回到 provideContext({ tools })', () => {
    let context = null;
    const tools = registerWebMCP({
      modelContext: { provideContext: (value) => (context = value) },
      fetchImpl: okFetch([]),
    });
    expect(tools).toHaveLength(4);
    expect(context.tools).toHaveLength(4);
  });

  test('没有 WebMCP 时返回空数组，不抛错', () => {
    expect(registerWebMCP({ modelContext: null })).toEqual([]);
  });

  test('execute 返回 content + structuredContent；错误返回 isError', async () => {
    let call = 0;
    const tools = registerWebMCP({
      modelContext: { registerTool: () => {} },
      fetchImpl: async () => {
        call++;
        if (call === 1) {
          return new Response(
            JSON.stringify({ ok: true, data: { schema: 'zhouyi.reading/v1' } }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          );
        }
        return new Response(
          JSON.stringify({ ok: false, error: { message: '出错了' } }),
          { status: 400, headers: { 'content-type': 'application/json' } }
        );
      },
    });

    const good = await tools[0].execute({});
    expect(good.structuredContent).toEqual({ schema: 'zhouyi.reading/v1' });
    expect(good.content[0].type).toBe('text');

    const bad = await tools[0].execute({});
    expect(bad.isError).toBe(true);
    expect(bad.content[0].text).toContain('出错了');
  });
});
