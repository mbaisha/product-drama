# drama.json 结构

一支带货短剧一份文件，顶层：

```json
{
  "product": "产品名",
  "sellingPoints": ["卖点1", "卖点2"],
  "platform": "douyin",
  "aspectRatio": "9:16",
  "promptLang": "zh",
  "targetSeconds": 45,
  "researchRef": "research.json 路径或内联摘要",
  "params": { "charsPerSecond": 4.5, "actionSeconds": 2.5, "tolerance": 0.15, "maxLineChars": 35, "hookWindow": 3, "maxSegmentSeconds": 15, "minCutSeconds": 2, "maxCutSeconds": 5, "maxOnScreen": 3 },
  "stages": [ { "id": "hook", "label": "黄金3秒钩子", "goal": "2秒不退", "desc": "..." }, ... ],
  "beats": [ ... ],
  "segments": [ ... ]
}
```

`params` 可省略，省略用默认值。九键只在需偏离默认时写。`stages` 是六段规划层的元信息（标签/目标），真正的内容平铺在 `beats` 里、每项带 `stage` 标签。

## beat（节拍）——二选一，必须带 `stage`

**动作节拍**：

```json
{ "stage": "hook", "action": "女生甩头，发丝油腻打绺。" }
```

**台词节拍**：

```json
{ "stage": "product", "speaker": "C01", "line": "一泵起泡，洗完三天不油。", "delivery": "展示" }
```

| 字段 | 说明 |
| --- | --- |
| `stage` | 六段之一：`hook` / `conflict` / `solution` / `product` / `trust` / `cta`。**必填**，质量门 `six-stage` 查六段齐全 |
| `action` | 叙述体画面描述，一拍一件事。不许出现引号台词 |
| `speaker` | 说话人 id（`C01` 起，自定）或 `"VO"`（画外音） |
| `line` | 台词本体，口语，单句 ≤ 35 字（非空白字符计） |
| `delivery` | 表演提示：语气、伴随动作、潜台词。可省略 |

一个节拍不能既有 `action` 又有 `line`。

## 时长折算（确定性）

- 台词秒数 = 非空白字符数 ÷ `charsPerSecond`
- 动作秒数 = `actionSeconds`（每动作拍）
- 每片预估 = 全部节拍之和，必须落在 `targetSeconds × (1 ± tolerance)` 内（质量门 `duration`）

## segment（段）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 段号 `E01-01`，按顺序连号（单产品通常 1–3 段） |
| `blocking` | string | 开场人物关系与构图逻辑：谁在左谁在右、朝向、间距 |
| `cuts` | cut[] | 段内分镜，按时间顺序。段总秒数 = 分镜秒数之和 |
| `h3Prompt` | string | 可选，一段一条 H3 视频提示词（见 references/h3-prompt.md）。本技能不逐字对账 |
| `soundscape` | string | 音景（中文）：环境声、动作声 |
| `music` | string | 配乐（中文），没有省略 |

## cut（分镜）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `beats` | [int, int] | 认领 `beats` 数组的 [起, 止]（1 基，含两端）。每个节拍被恰好一个分镜认领（质量门 `beat-coverage`） |
| `seconds` | number | 分镜时长，2–5 秒（质量门 `cut-length`） |
| `size` | enum | 景别：`extreme-wide` / `wide` / `medium` / `close` / `extreme-close` |
| `camera` | enum | 运镜（H3 词表）：`Static` `Push In` `Pull Out` `Pan Left/Right` `Truck Left/Right` `Arc Shot` `Tracking Shot` `POV` `Shake Slightly` |
| `characters` | string[] | 画内人物（C 编号） |
| `frame` | string | 分镜图提示词（中文）：主体、位置状态、动作瞬间、光线。景别中文词在内；直呼产品/人物名（指向参考图） |
| `shot` | string | 镜头正文（中文，通用身份）：这几秒发生什么。不写角色名、秒数、编号 |
| `lens` | string | 焦距 + 景深：`50mm 标准，中浅景深` |
| `cameraPosition` | string | 机位：`女生 + 平视正面` |
| `composition` | string | 构图：`三分法` / `中心构图` / `对角线` / `对称` |
| `eyeline` | string | 视线落点：`对方面部` / `镜头` |
| `focus` | string | 焦点：`锁定女生上半身` |
| `stability` | enum | `stable` / `slight-shake` / `handheld` |

## research.json（Stage 1 产出，见 references/research-pass.md）

```json
{
  "product": "产品名",
  "query": "搜索词",
  "sources": [ { "platform": "douyin", "url": "...", "account": "...", "metric": "播放/销量", "note": "为什么爆" } ],
  "viralBreakdown": [ { "stage": "hook", "hookType": "痛点直击", "seconds": "0-3", "what": "...", "why": "..." } ],
  "borrow": [ "可复用钩子句式", "可复用信任锚点" ],
  "fallback": false
}
```

`fallback: true` 表示走了兜底模板（没扒到真实爆款），汇报时明说。
