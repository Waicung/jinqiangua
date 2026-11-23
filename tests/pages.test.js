import { describe, expect, test } from 'bun:test';

const read = (path) => Bun.file(new URL(`../${path}`, import.meta.url)).text();

describe('页面结构', () => {
  test('首页是服务说明与演示入口', async () => {
    const html = await read('index.html');
    expect(html).toContain('周易象数服务');
    expect(html).toContain('id="api"');
    expect(html).toContain('id="webmcp"');
    expect(html).toContain('href="demo"');
    expect(html).toContain('src="landing.js"');
    // 首页不再承载摇卦 UI
    expect(html).not.toContain('id="btn-start"');
    expect(html).not.toContain('src="app.js"');
  });

  test('演示页保留起卦 UI 并链回首页', async () => {
    const html = await read('demo.html');
    for (const id of [
      'btn-start',
      'btn-throw',
      'btn-reset',
      'phase-idle',
      'phase-casting',
      'phase-result',
      'btn-history',
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain('href="/"');
    expect(html).toContain('src="app.js"');
    expect(html).toContain('src="webmcp.js"');
  });

  test('Service Worker 预缓存首页、演示页与共享模块', async () => {
    const sw = await read('sw.js');
    expect(sw).toContain("'/'");
    expect(sw).toContain("'/demo'");
    expect(sw).toContain("'/landing.js'");
    expect(sw).toContain("'/version-badge.js'");
  });
});
