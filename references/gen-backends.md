# 图像 / 视频生成后端（可插拔）

后端模式学自 shuohao-skills/character-refs 的 `config` + `gen` 思路：**模型不锁定、一致性来自同一份参考图、配置写本地不进版本控制**。

本技能 `product-drama.mjs` 提供三条命令：

```bash
node scripts/product-drama.mjs config --image-backend custom:<命令> [--video-backend custom:<命令>]
node scripts/product-drama.mjs gen <drama.json> --out frames [--refs 参考图.png]
node scripts/product-drama.mjs export <drama.json> --protocol h3 --frames frames
```

## 后端类型

| 类型 | 说明 | 怎么接 |
| --- | --- | --- |
| `custom:<命令>` | 你自己的出图/出片命令 | 命令签名：`<命令> <提示词文件或字符串> <参考图...> <输出文件>`；脚本把 frame 提示词、参考图、输出路径依次传给它 |
| `qwen` | Qwen Image（ComfyUI） | 实现适配器：读 `COMFY_URL` 等，POST 工作流（参考 character-refs） |
| `codex` | codex 内置出图 | 实现适配器，吃 ChatGPT 订阅额度 |
| `openai` | OpenAI Images / Video API | 实现适配器，需 key |

> 本仓库只实装了 `custom:<命令>` 的调度骨架；`qwen` / `codex` / `openai` 留作占位，按需按 character-refs 的适配器写法补齐。文本生成（提示词）永远零依赖、零 key。

## 参考图纪律（出图质量的一半在这）

分镜图生成 = 提示词 + 参考图。切镜时就想好每格挂什么：

- 产品设定图（必挂，保证每帧产品一致）
- 人物设定图（有真人出镜就挂）
- 场景设定图（浴室 / 厨房 / 街头…）

提示词与参考图冲突时模型听参考图的——所以 `frame` 专心写构图、此刻位置状态、姿态，长相材质交给参考图。产品大资产（瓶子、包装）一定要挂它自己的设定图，不挂就每帧长得不一样。

## 视频生成

拿到分镜图（frames/段号/f.png）+ 每段 `h3Prompt` 后，用 `export --protocol h3` 导出投产包，喂给 H3 / Seedance 等视频模型做 I2VA 生成。视频后端同样走 `custom:<命令>` 可插拔。

## 配置落地

配置写在 `<skill>/config.local.json`（已在 .gitignore 精神内，不进版本控制）。不要把 .env 里的 key 打印出来。
