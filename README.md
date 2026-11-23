# 周易象数服务 / 周易起卦

金钱卦的**象数服务**。`/` 是服务首页，三个出口都从这里进入：

| 出口 | 路径 | 用途 |
| --- | --- | --- |
| 服务首页 | `/` | 服务说明、API / WebMCP 文档与在线试用，演示入口 |
| 演示 UI | `/demo` | 原有摇卦、本卦 / 变卦、爻辞与解卦面板 |
| HTTP API | `/api/v1/*` | 给脚本、Agent、第三方应用调用 |
| WebMCP | `navigator.modelContext` | 让浏览器内 AI agent 直接调用起卦与读卦工具 |

演示 UI 仍然可以离线完整使用；API 与 WebMCP 只返回下面的三层核心数据。

## 三层边界

| 层级 | 包含 | 明确排除 |
| --- | --- | --- |
| 象数骨架 | 六爻原始值（6/7/8/9）、本卦、变卦（之卦）、互卦、动爻位置与数量、朱熹变爻取象规则 | “这卦算不算过期”“能不能重占”等状态判断 |
| 原典文本 | 卦辞、爻辞、彖传、象传（大象 + 小象），按底本寻址（当前为通行本） | 针对个人处境的白话安慰、算命式吉凶断言 |
| 客观象意 | 八卦自然属性与核心意象、爻位关系（当位、得中、应与、承乘） | 行业 / 感情 / 财务背景的定制化推演 |

状态判断归会话与日志层（`session.js`）；个人化解读归上层 AI。服务层不写这两种内容。

## 快速开始

```bash
bun install
bun run dev        # wrangler dev，同时服务首页、演示页与 /api/v1
# 本地持久化放在 /tmp/jinqiangua-dev，避免 assets 目录监听自触发重载
bun test
```

本地打开 `http://localhost:8787/` 看服务首页，`/demo` 是演示页。

生产部署：

```bash
bun run deploy
```

## HTTP API

```bash
# 服务自述
curl https://651372.xyz/api/v1

# 随机起卦
curl -X POST https://651372.xyz/api/v1/cast \
  -H 'content-type: application/json' -d '{}'

# 按六爻值读卦（6=老阴 7=少阳 8=少阴 9=老阳，自下而上）
curl -X POST https://651372.xyz/api/v1/readings \
  -H 'content-type: application/json' \
  -d '{"numbers":[6,7,8,9,7,8]}'

# 六十四卦索引 / 单卦原典与象意
curl https://651372.xyz/api/v1/hexagrams
curl https://651372.xyz/api/v1/hexagrams/1
```

接口返回统一结构：

```json
{
  "ok": true,
  "data": {
    "schema": "zhouyi.reading/v1",
    "skeleton": { "numbers": [], "primary": {}, "transformed": {}, "nuclear": {}, "moving": {}, "rule": {} },
    "text": { "edition": {}, "primary": {}, "transformed": {}, "nuclear": {} },
    "imagery": { "primary": {}, "transformed": {}, "nuclear": {} }
  }
}
```

错误统一为 `{ ok: false, error: { code, message } }`，例如 `invalid_numbers`、`unknown_edition`、`hexagram_not_found`。

完整接口与字段说明见 [docs/SERVICE.md](docs/SERVICE.md)。

## WebMCP

`webmcp.js` 在支持 WebMCP 的浏览器中注册四个工具（首页与演示页都会加载）：

| 工具 | 作用 |
| --- | --- |
| `zhouyi_cast` | 随机起卦 |
| `zhouyi_read` | 按六个 6–9 的爻值读卦 |
| `zhouyi_hexagram` | 按 1–64 卦号取原典与象意 |
| `zhouyi_list_hexagrams` | 六十四卦索引 |

工具走同一个 `/api/v1`，返回内容同样只有三层，不含有效期或个人化断语。

## 数据

- `data/iching.json`：六十四卦结构、卦辞、爻辞。
- `data/canonical.json`：按底本组织的原典（通行本的卦辞、爻辞、彖传、象传）。
- `zhouyi/*.md`：原典来源。

重新生成：

```bash
bun run data
```

## 文件布局

```text
index.html         服务首页：说明、API / WebMCP 文档、在线试用、演示入口
demo.html          演示页：摇卦流程与结果页
landing.js         首页交互：复制代码块、API 试用、WebMCP 状态
version-badge.js   右下角版本徽标（首页与演示页共用）
src/worker.js      Cloudflare Worker：路由 /api/v1，其余交给静态资产
service.js         三层拼装、随机起卦、单卦资料
hexagram.js        象数骨架：本卦、变卦、互卦、动爻、变爻规则
canonical.js       原典文本层，按底本寻址
imagery.js         客观象意字典与爻位关系
webmcp.js          浏览器 WebMCP 工具注册
app.js             演示页 UI：摇卦、结果页、解卦面板
session.js         会话 / 卦历 / 交流有效期（日志层，不属于 API）
```

## 测试

```bash
bun test
node_modules/.bin/tsc --noEmit
```

测试覆盖三层数据、0–6 个动爻的取象规则、64 卦原典完整性、HTTP 路由与 WebMCP 工具。
