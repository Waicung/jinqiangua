# 周易象数服务 API

Base URL: `/api/v1`

服务版本：`zhouyi.reading/v1`（读卦）、`zhouyi.hexagram/v1`（单卦）。

## 设计边界

服务只负责三层客观数据：

1. **象数骨架**：六爻原始值、本卦、变卦、互卦、动爻、变爻规则。
2. **原典文本**：卦辞、爻辞、彖传、象传，按底本寻址。
3. **客观象意**：八卦属性、核心意象、爻位关系。

以下内容不属于本服务：

- 交流有效期、能否重占、卦历、会话消息：由 `session.js` 与调用方的日志层负责。
- 个人处境白话、行业 / 感情 / 财务推演、吉凶断言：由上层 AI 解读负责。

因此 API 响应中没有 `expiresAt`、`canContinue`、`question`、`advice` 等字段。

## 端点

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1` | 服务自述：三层、排除边界、可用底本、八卦字典 |
| GET | `/api/v1/health` | 健康检查 |
| GET | `/api/v1/hexagrams` | 六十四卦索引 |
| GET | `/api/v1/hexagrams/:id?edition=通行本` | 单卦：原典 + 象意 |
| POST | `/api/v1/readings` | 六爻值 → 三层读卦 |
| POST | `/api/v1/cast` | 随机起卦 → 六爻值 + 三层读卦 |

所有响应带 CORS，支持 `OPTIONS` 预检。非 `/api/*` 请求交给静态资产。

## POST /readings

请求：

```json
{
  "numbers": [6, 7, 8, 9, 7, 8],
  "edition": "通行本"
}
```

`numbers` 必须是六个 6–9 的整数，自下而上（初爻 → 上爻）：

| 值 | 爻 |
| --- | --- |
| 6 | 老阴（动） |
| 7 | 少阳（静） |
| 8 | 少阴（静） |
| 9 | 老阳（动） |

`edition` 可省略，默认取数据里的 `defaultEdition`。

响应 `data`：

```json
{
  "schema": "zhouyi.reading/v1",
  "skeleton": {
    "numbers": [6, 7, 8, 9, 7, 8],
    "lines": [
      {
        "index": 0,
        "position": "初六",
        "value": 6,
        "name": "老阴",
        "yang": false,
        "moving": true,
        "symbol": "⚋"
      }
    ],
    "primary": {
      "id": 47,
      "symbol": "䷮",
      "name": "困",
      "binary": "010110",
      "trigrams": {
        "lower": { "binary": "010", "name": "坎", "symbol": "☵" },
        "upper": { "binary": "110", "name": "兑", "symbol": "☱" }
      }
    },
    "transformed": { "id": 60, "name": "节" },
    "nuclear": { "id": 37, "name": "家人" },
    "moving": {
      "count": 2,
      "indices": [0, 3],
      "positions": ["初六", "九四"],
      "lines": [
        {
          "index": 0,
          "position": "初六",
          "value": 6,
          "name": "老阴",
          "from": "yin",
          "to": "yang",
          "label": "老阴 ⚋→⚊"
        }
      ]
    },
    "rule": {
      "id": "two-moving",
      "title": "二爻动",
      "movingCount": 2,
      "method": "以本卦两动爻爻辞占，以上爻为主。",
      "school": "朱熹《易学启蒙·考变占》",
      "targets": [
        { "kind": "line", "hexagram": "primary", "index": 3, "position": "九四", "role": "main" },
        { "kind": "line", "hexagram": "primary", "index": 0, "position": "初六", "role": "secondary" }
      ]
    }
  },
  "text": {
    "edition": { "name": "通行本", "label": "通行本", "source": [] },
    "primary": {
      "id": 47,
      "name": "困",
      "symbol": "䷮",
      "judgment": "……",
      "lines": [{ "position": "初六", "text": "……", "type": "yin" }],
      "tuan": "……",
      "image": {
        "great": "……",
        "lines": [{ "position": "初六", "text": "……" }]
      }
    },
    "transformed": {},
    "nuclear": {}
  },
  "imagery": {
    "primary": {
      "id": 47,
      "name": "困",
      "binary": "010110",
      "trigrams": {
        "upper": { "name": "兑", "nature": "泽", "attribute": "说（悦）", "keywords": [] },
        "lower": { "name": "坎", "nature": "水", "attribute": "陷", "keywords": [] }
      },
      "naturalImage": "泽水",
      "formation": "上兑下坎",
      "attributes": ["说（悦）", "陷"],
      "keywords": ["喜悦", "泽", "口舌", "险陷", "水", "劳"],
      "lines": [
        {
          "index": 0,
          "position": "初六",
          "yang": false,
          "correct": false,
          "center": false,
          "threeTalents": "地",
          "response": {
            "index": 3,
            "position": "九四",
            "mutual": true,
            "label": "有应"
          },
          "over": null,
          "under": {
            "index": 1,
            "position": "九二",
            "relation": "阴承阳（柔承刚）"
          }
        }
      ]
    },
    "transformed": {},
    "nuclear": {}
  }
}
```

## 变爻规则

`rule.targets` 使用朱熹《易学启蒙·考变占》：

| 动爻数 | 取象 |
| --- | --- |
| 0 | 本卦卦辞 |
| 1 | 本卦动爻爻辞 |
| 2 | 本卦两动爻爻辞，以上爻为主 |
| 3 | 本卦与变卦卦辞，本卦为主 |
| 4 | 变卦两不变爻爻辞，以下爻为主 |
| 5 | 变卦不变爻爻辞 |
| 6 | 乾用九、坤用六；其余取变卦卦辞 |

`targets` 只给“读哪条原文”的引用，不附带吉凶解释。

## 互卦

取本卦二、三、四爻为互卦下卦，三、四、五爻为互卦上卦：

```text
nuclear.binary = primary[1] + primary[2] + primary[3]
               + primary[2] + primary[3] + primary[4]
```

## 底本

`data/canonical.json` 的结构是：

```json
{
  "defaultEdition": "通行本",
  "editions": {
    "通行本": { "label": "通行本", "source": [], "hexagrams": {} }
  }
}
```

请求未知底本返回 400：

```json
{
  "ok": false,
  "error": {
    "code": "unknown_edition",
    "message": "未知底本：帛书（可用：通行本）",
    "available": ["通行本"]
  }
}
```

当前只提供通行本；新增底本时向 `editions` 增加完整条目即可，服务代码无需改动。不会用推测文本填充缺失底本。

## 错误码

| HTTP | code | 场景 |
| --- | --- | --- |
| 400 | `invalid_json` / `invalid_body` | 请求体不是 JSON 对象 |
| 400 | `invalid_numbers` | 不是六个 6–9 的整数 |
| 400 | `invalid_edition` / `unknown_edition` | 底本字段类型错误或不存在 |
| 400 | `invalid_hexagram_id` | 卦号不是整数 |
| 404 | `hexagram_not_found` | 卦号不存在 |
| 404 | `not_found` | 未知接口或 API 版本 |
| 405 | `method_not_allowed` | 方法不匹配 |
| 500 | `internal_error` | 未预期错误 |

## WebMCP

`webmcp.js` 在 `navigator.modelContext` 可用时注册：

| 工具 | 输入 | 调用 |
| --- | --- | --- |
| `zhouyi_cast` | `{ edition? }` | `POST /cast` |
| `zhouyi_read` | `{ numbers, edition? }` | `POST /readings` |
| `zhouyi_hexagram` | `{ id, edition? }` | `GET /hexagrams/:id` |
| `zhouyi_list_hexagrams` | `{}` | `GET /hexagrams` |

优先使用 `registerTool(tool)`；不支持时回退到 `provideContext({ tools })`。工具结果返回：

```json
{
  "content": [{ "type": "text", "text": "…JSON…" }],
  "structuredContent": {}
}
```

失败时返回 `{ content, isError: true }`，不会向 agent 抛裸异常。

## 演示 UI

`/` 保留原有摇卦流程。结果页新增可折叠的「服务数据：象数 / 原典 / 象意」区块，直接展示本服务的三层输出；解卦提示也会带上互卦、变爻规则、彖传、大象与爻位关系。UI 自身不发明吉凶断语。
