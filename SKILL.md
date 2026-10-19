---
name: product-drama
version: 1.0.0
description: |
  带货短剧生成器：给定产品参考图 / 卖点 / 几句话，先联网扒同类卖得最好的视频拆结构，
  再按抖音留存逻辑（黄金3秒钩子→放大冲突→解法转折→产品登场→信任锚点→升华CTA）生成
  短剧剧本+分镜，并尝试接图像/视频生成后端实际出图出片。相对 shuohao-skills 做了两处提速：
  ① 把 6 个串行 skill 压成 1 个、3 个轻量阶段；② 砍掉 H3 逐字对账锁，质量门只留 4–5 道核心门可迭代。
  零依赖（脚本只用 Node 标准库），联网用 Agent 的 WebSearch/WebFetch。
  Use when asked to 带货短剧、种草视频、带货视频、产品短视频、短视频脚本、扒爆款。
allowed-tools:
  - Read
  - Write
  - Bash
  - Task
  - Glob
  - WebSearch
  - WebFetch
metadata:
  license: Apache-2.0
  requires:
    bins:
      - node          # >= 18，只用标准库，无 npm 依赖
  runtimes:
    - claude-code
    - codex
---

## product-drama

给定产品参考图 / 卖点 / 几句话，**先扒爆款、再写短剧、最后出图出片**。一支带货短剧（30–90 秒、单产品）一条龙。

`{baseDir}` = 本文件所在目录。脚本 `{baseDir}/scripts/product-drama.mjs`，零依赖，`node` 直接跑。

**与原 shuohao-skills 的关系（学习 + 优化）**：
- 复用其已被验证的确定性机制：节拍流（动作⇄台词）、时长预算（台词 4.5 字/秒、动作 2.5 秒/拍）、钩子冷开场、段→切→镜头提示词、H3 多图对齐写法、可插拔出图后端。
- **砍掉慢的部分**：原 6 个 skill 串行、每步 seed→写→validate→render 多轮；最慢的是 storyboard 的 18 道质量门里 H3「逐字对账」（切点时刻逐字对、`[d]` 台词逐字进块）。本技能把管线压成 1 个 skill 3 阶段，质量门只留 **8 道核心门**、且**不做 H3 逐字对账**——门不过才修，不卡死在逐字锁上。

**三个阶段**：

```
① 爆款调研  → research.json   （联网扒同类爆款，拆结构；扒不到走兜底模板）
② 短剧脚本  → drama.json.beats（六段节拍流，时长预算，核心门自检）
③ 分镜+出片 → drama.json.segments + frames/ + 视频投产包（可插拔后端实际生成）
```

---

### Step 0 — 收输入（一次问完，别轮流盘问）

| 参数 | 处理 |
| --- | --- |
| 产品 / 参考图 / 卖点 / 几句话 | **必问其一**：用户给图就认图，给卖点就认卖点，给链接就先尝试扒原片 |
| 平台 | 默认 `douyin`（竖屏 9:16）；`xiaohongshu` 也可 |
| 目标时长 | 默认 45 秒；带货短剧 30–90 秒都常见 |
| 画幅 | 默认 `9:16`（竖屏）；横屏改 `16:9` |
| 是否接实际生成 | 默认尝试：配置了出图/出片后端就真出，没配置就只交提示词+投产包 |

### Step 1 — 爆款调研（新增，联网）

读 `{baseDir}/references/research-pass.md`，照三级递进：

```bash
# 无需脚本，直接用 WebSearch / WebFetch 联网
# 产出写到 <workdir>/research.json（结构见 research-pass.md）
```

- 用户给了视频链接 → 先尝试学习/扒原片，逐帧拆。
- 扒不到 → `WebSearch` 搜同类爆款 + `WebFetch` 读文案/评论，附来源链接，拆结构。
- 还不行（封锁/搜不到）→ 回退 `references/viral-patterns.md` 模板，`research.json` 标 `fallback: true`。

调研完把 `borrow`（可复用钩子/冲突/信任锚点）和来源链接汇报给用户。

### Step 2 — 写剧本（六段节拍流）

```bash
node {baseDir}/scripts/product-drama.mjs seed <spec.json> --product "产品名" --seconds 45 --aspect 9:16 > <workdir>/drama.json
```

读 `{baseDir}/references/script-pass.md` 和 `{baseDir}/references/schema.md`，把 `drama.json` 的 `beats` 写满（每拍带 `stage` 标签）。写完后：

```bash
node {baseDir}/scripts/product-drama.mjs validate <workdir>/drama.json
```

**8 道核心门（保留、可迭代，但不做 H3 逐字对账）**：总时长预算、单句台词 ≤ 35 字、六段结构齐全、钩子在前 3 拍、分镜认领全覆盖、每段 ≤ 15 秒、每切 2–5 秒、台词装得进分镜。**有违规逐条修，改完重跑，直到通过**——但门不再要求 H3 提示词逐字对账，迭代轮次大幅减少。

### Step 3 — 分镜 + 出图出片

读 `{baseDir}/references/storyboard-pass.md`，把 `segments` 写满（段→切→`frame`/`shot`/构图字段）。重跑 `validate`。然后：

```bash
node {baseDir}/scripts/product-drama.mjs render <workdir>/drama.json --html > drama-report.html
node {baseDir}/scripts/product-drama.mjs export <workdir>/drama.json --protocol h3 --frames frames > pack.json
```

**接实际生成（可插拔）**：

```bash
node {baseDir}/scripts/product-drama.mjs config --image-backend custom:<命令>   # 配出图后端
node {baseDir}/scripts/product-drama.mjs gen <workdir>/drama.json --out frames   # 生成分镜图
# 视频：把 frames + 每段 h3Prompt 交给 H3/Seedance（export 出的 pack.json 即投产包）
```

没配后端就只交付提示词 + 投产包，由下游生成。——**不要谎称「已出图」**，只说交付了什么。

### Step 4 — 汇报

一句话说清：扒到几支爆款（或走了兜底）、几段几镜、预估时长 vs 目标、报告路径、有没有真出图。门没过的明说。

---

## 边界

- 报告界面中文；提示词语言由 `promptLang` 控制（默认中文）。
- 时长是估算（容差 ±15% 为此留）；秒数是下给视频模型的生成时长。
- 联网调研扒的是「结构和方法」不是抄文案——落到自己剧本必须换成用户产品卖点（合规底线）。
- H3 提示词本技能不逐字对账；要精修接 H3/Seedance 时照 `references/h3-prompt.md`。

## 自测

```bash
node {baseDir}/scripts/selftest.mjs
```

12 项断言，不调模型、不花额度。8 道核心门每道都有击穿用例。改完脚本先跑这个。

## 自带样例

`{baseDir}/examples/洗发水-drama.json` + `洗发水-research.json`：一支 45 秒控油洗发水带货短剧，六段齐全、分镜认领全覆盖、全部核心门通过。当质量基准，也是自测夹具。
