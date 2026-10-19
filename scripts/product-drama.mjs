#!/usr/bin/env node
/**
 * product-drama.mjs — 带货短剧生成器的确定性工具
 *
 * 零依赖（只用 Node 标准库），不调模型、不花额度。脚本只负责：
 *   - 从调研/卖点生成剧本骨架（seed）
 *   - 时长确定性折算（台词按语速、动作按节拍）
 *   - 核心质量门检查（validate / checkup）—— 已去掉原 shuohao-skills 的 H3 逐字对账锁
 *   - 渲染报告（--md / --html）
 *   - 导出投产包（export）
 *   - 接图像/视频生成后端（config / gen / gen-video，可插拔）
 *
 * 方法论来源（内化，非依赖）：
 *   - 节拍流 + 时长预算 + 钩子冷开场：学自 shuohao-skills/novel-script
 *   - 段→切→镜头提示词 + H3 多图对齐：学自 shuohao-skills/novel-storyboard
 *   - 可插拔出图后端：学自 shuohao-skills/character-refs
 *   - 六段留存结构（黄金3秒钩子→放大冲突→解法转折→产品登场→信任锚点→升华CTA）：本技能自研
 */

import {
  appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync,
  writeFileSync, rmSync,
} from 'node:fs';
import { basename, join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const baseDir = resolve(__dirname, '..');

/* ------------------------------------------------------------------ */
/* 默认参数与枚举                                                       */
/* ------------------------------------------------------------------ */

const DEFAULTS = {
  charsPerSecond: 4.5, // 台词语速：非空白字符数 ÷ 该值 = 秒数
  actionSeconds: 2.5, // 单个动作节拍秒数
  tolerance: 0.15, // 时长容差 ±15%
  maxLineChars: 35, // 单句台词字数上限
  hookWindow: 3, // 钩子必须落在全集前 N 拍内
  maxSegmentSeconds: 15, // 单段（一次视频生成）上限
  minCutSeconds: 2, // 单切下限
  maxCutSeconds: 5, // 单切上限
  maxOnScreen: 3, // 单镜同框上限
};

// 六段留存结构（顺序即时间顺序）。goal 标注该段要优化的留存指标。
export const STAGES = [
  { id: 'hook', label: '黄金3秒钩子', goal: '2秒不退', desc: '痛点 / 反常识 / 强冲突直击，把人摁住' },
  { id: 'conflict', label: '放大冲突', goal: '5秒完播', desc: '把痛点放大成具体困境，制造共鸣' },
  { id: 'solution', label: '解法转折', goal: '完播钩子', desc: '抛出人设 / 悬念 / 反差，引出解法' },
  { id: 'product', label: '产品登场', goal: '卖点可视化', desc: '产品出场 + 核心卖点演示' },
  { id: 'trust', label: '信任锚点', goal: '转化信任', desc: '效果对比 / 背书 / 价格锚点' },
  { id: 'cta', label: '升华+行动召唤', goal: '整体完播+转化', desc: '情绪升华 + 引导下单' },
];
const STAGE_IDS = STAGES.map((s) => s.id);

const SHOT_SIZES = {
  'extreme-wide': '大远景', wide: '全景', medium: '中景', close: '特写', 'extreme-close': '大特写',
};
const CAMERA_MOVES = {
  Static: '固定', 'Push In': '推', 'Pull Out': '拉', 'Pan Left': '左摇', 'Pan Right': '右摇',
  'Truck Left': '左移', 'Truck Right': '右移', 'Arc Shot': '弧移', 'Tracking Shot': '跟拍',
  'POV': '主观', 'Shake Slightly': '微晃',
};
const STABILITY = { stable: '稳定', 'slight-shake': '微晃', handheld: '手持' };
const COMPOSITION_FIELDS = ['lens', 'cameraPosition', 'composition', 'eyeline', 'focus', 'stability'];

const CJK = /[一-鿿㐀-䶿]/;

/* ------------------------------------------------------------------ */
/* 通用工具                                                             */
/* ------------------------------------------------------------------ */

const r1 = (n) => Math.round(n * 10) / 10;
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const writeJson = (p, o) => writeFileSync(p, JSON.stringify(o, null, 2) + '\n');
const nonWS = (s) => String(s ?? '').replace(/\s/g, '').length;

function paramsOf(d) {
  return { ...DEFAULTS, ...(d?.params ?? {}) };
}

// 一个节拍的秒数：动作 = actionSeconds；台词 = 字数 ÷ charsPerSecond
function beatSeconds(b, p) {
  if (b?.action != null) return p.actionSeconds;
  if (b?.line != null) return nonWS(b.line) / p.charsPerSecond;
  return 0;
}

function allBeats(d) {
  return Array.isArray(d?.beats) ? d.beats : [];
}

function totalBeatSeconds(d) {
  const p = paramsOf(d);
  return allBeats(d).reduce((n, b) => n + beatSeconds(b, p), 0);
}

function segSeconds(seg) {
  return (seg?.cuts ?? []).reduce((n, c) => n + (Number(c?.seconds) || 0), 0);
}

/* ------------------------------------------------------------------ */
/* seed — 从卖点/调研生成骨架                                            */
/* ------------------------------------------------------------------ */

export function seedDrama(spec) {
  const p = { ...DEFAULTS, ...(spec?.params ?? {}) };
  const stages = STAGES.map((s) => ({ ...s, beats: [] }));
  return {
    product: spec?.product ?? '',
    sellingPoints: Array.isArray(spec?.sellingPoints) ? spec.sellingPoints : [],
    platform: spec?.platform ?? 'douyin',
    aspectRatio: spec?.aspectRatio ?? '9:16',
    promptLang: spec?.promptLang ?? 'zh',
    targetSeconds: spec?.targetSeconds ?? 45,
    researchRef: spec?.researchRef ?? '',
    params: p,
    stages, // 六段规划层（仅元信息，节拍平铺在 beats 里）
    beats: [], // 平铺节拍流，每项带 stage 标签
    segments: [], // 分镜层
  };
}

/* ------------------------------------------------------------------ */
/* 核心质量门（已去掉 H3 逐字对账，只留可迭代的核心门）                  */
/* ------------------------------------------------------------------ */

export function gateReport(d, ctx = {}) {
  const gates = [];
  const add = (id, label, ok, detail = '') => gates.push({ id, label, ok, detail });
  const p = paramsOf(d);
  const beats = allBeats(d);
  const bad = {
    duration: [], lineChars: [], stages: [], hook: [], coverage: [],
    segCap: [], cutLen: [], fit: [], frame: [],
  };

  // 1) 时长预算
  const total = totalBeatSeconds(d);
  if (d.targetSeconds > 0) {
    const lo = d.targetSeconds * (1 - p.tolerance);
    const hi = d.targetSeconds * (1 + p.tolerance);
    if (total < lo) bad.duration.push(`欠 ${r1(lo - total)} 秒（${r1(total)}s / 目标 ${d.targetSeconds}s）`);
    if (total > hi) bad.duration.push(`超 ${r1(total - hi)} 秒（${r1(total)}s / 目标 ${d.targetSeconds}s）`);
  }

  // 2) 单句台词字数
  beats.forEach((b, i) => {
    if (b?.line != null && nonWS(b.line) > p.maxLineChars) {
      bad.lineChars.push(`第 ${i + 1} 拍台词 ${nonWS(b.line)} 字 > ${p.maxLineChars}`);
    }
  });

  // 3) 六段结构齐全
  const present = new Set(beats.map((b) => b?.stage).filter(Boolean));
  const missing = STAGE_IDS.filter((s) => !present.has(s));
  if (missing.length) bad.stages.push(`缺段：${missing.map((s) => STAGES.find((x) => x.id === s).label).join('、')}`);

  // 4) 钩子在全集前 hookWindow 拍内
  const hookIdx = beats.findIndex((b) => b?.stage === 'hook');
  if (hookIdx < 0) bad.hook.push('没有钩子段（stage=hook）');
  else if (hookIdx >= p.hookWindow) bad.hook.push(`钩子在第 ${hookIdx + 1} 拍，超出前 ${p.hookWindow} 拍`);

  // 5–8) 分镜层（段/切）
  const segs = Array.isArray(d?.segments) ? d.segments : [];
  // 节拍认领全覆盖（每个节拍恰好一次、按顺序）
  const claims = [];
  segs.forEach((seg) => {
    const sid = seg?.id ?? '?';
    const s = segSeconds(seg);
    if (!(s > 0) || s > p.maxSegmentSeconds) bad.segCap.push(`${sid} 共 ${r1(s)} 秒`);
    (seg?.cuts ?? []).forEach((cut, ci) => {
      const cid = `${sid}#${ci + 1}`;
      const sec = Number(cut?.seconds);
      if (!(sec >= p.minCutSeconds) || sec > p.maxCutSeconds) bad.cutLen.push(`${cid} ${cut?.seconds ?? '?'} 秒`);
      const [from, to] = cut?.beats ?? [];
      if (Number.isInteger(from) && Number.isInteger(to) && from >= 1 && to <= beats.length && from <= to) {
        claims.push([from, to]);
        let dlg = 0;
        for (let k = from - 1; k < to; k++) if (beats[k]?.line != null) dlg += beatSeconds(beats[k], p);
        if (dlg > sec) bad.fit.push(`${cid} 台词 ${r1(dlg)} 秒装不进 ${sec} 秒`);
      }
      const frame = String(cut?.frame ?? '');
      if (!frame.trim()) bad.frame.push(`${cid} 分镜图提示词为空`);
    });
  });
  if (beats.length) {
    let cursor = 1;
    for (const [from, to] of claims.sort((a, b) => a[0] - b[0])) {
      if (from !== cursor) {
        bad.coverage.push(`第 ${cursor} 拍${from > cursor ? '没人认领' : `被重复认领`}`);
      }
      cursor = Math.max(cursor, to + 1);
    }
    if (claims.length && cursor <= beats.length) bad.coverage.push(`第 ${cursor}–${beats.length} 拍没人认领`);
    if (!claims.length) bad.coverage.push('整片没有分镜认领节拍');
  }

  add('duration', `总时长在目标 ±${Math.round(p.tolerance * 100)}% 内（${r1(total)}s / ${d.targetSeconds}s）`, bad.duration.length === 0, bad.duration.join('；'));
  add('max-line-chars', `单句台词 ≤ ${p.maxLineChars} 字`, bad.lineChars.length === 0, bad.lineChars.join('；'));
  add('six-stage', '六段结构齐全（钩子/冲突/解法/产品/信任/CTA）', bad.stages.length === 0, bad.stages.join('；'));
  add('hook-window', `钩子落在全集前 ${p.hookWindow} 拍`, bad.hook.length === 0, bad.hook.join('；'));
  add('beat-coverage', '分镜认领每个节拍恰好一次、按顺序', segs.length === 0 || bad.coverage.length === 0, segs.length === 0 ? '尚无分镜（视为通过）' : bad.coverage.join('；'));
  add('segment-cap', `每段 0 < 总秒数 ≤ ${p.maxSegmentSeconds}`, segs.length === 0 || bad.segCap.length === 0, bad.segCap.join('；'));
  add('cut-length', `每切 ${p.minCutSeconds}–${p.maxCutSeconds} 秒`, segs.length === 0 || bad.cutLen.length === 0, bad.cutLen.join('；'));
  add('dialogue-fit', '认领的台词装得进分镜秒数', segs.length === 0 || bad.fit.length === 0, bad.fit.join('；'));
  add('frame-prompt', '分镜图提示词非空', segs.length === 0 || bad.frame.length === 0, bad.frame.join('；'));

  return gates;
}

export function checkup(d, ctx = {}) {
  const gates = gateReport(d, ctx);
  const failed = gates.filter((g) => !g.ok);
  return { gates, failed, ok: failed.length === 0 };
}

/* ------------------------------------------------------------------ */
/* 渲染：Markdown                                                       */
/* ------------------------------------------------------------------ */

export function renderMd(d, ctx = {}) {
  const p = paramsOf(d);
  const beats = allBeats(d);
  const total = totalBeatSeconds(d);
  const lines = [];
  lines.push(`# ${d.product || '带货短剧'} · 分镜脚本`);
  lines.push('');
  lines.push(`- 平台：${d.platform}　画幅：${d.aspectRatio}　目标：${d.targetSeconds}s　预估：${r1(total)}s`);
  if (d.sellingPoints?.length) lines.push(`- 卖点：${d.sellingPoints.join(' / ')}`);
  lines.push('');
  // 六段节拍流
  lines.push(`## 节拍流（${STAGES.map((s) => s.label).join(' → ')}）`);
  lines.push('');
  const byStage = {};
  beats.forEach((b, i) => (byStage[b?.stage] ??= []).push([i, b]));
  for (const s of STAGES) {
    const items = byStage[s.id] ?? [];
    lines.push(`### ${s.label}（${s.goal}）`);
    if (!items.length) { lines.push('_（空）_'); lines.push(''); continue; }
    for (const [i, b] of items) {
      if (b.action != null) lines.push(`- **[${i + 1}] 动作** ${b.action}（${r1(beatSeconds(b, p))}s）`);
      else lines.push(`- **[${i + 1}] ${b.speaker ?? '?'}**：${b.line}${b.delivery ? `（${b.delivery}）` : ''}（${r1(beatSeconds(b, p))}s）`);
    }
    lines.push('');
  }
  // 分镜
  if (d.segments?.length) {
    lines.push('## 分镜');
    lines.push('');
    d.segments.forEach((seg) => {
      lines.push(`### ${seg.id}　${r1(segSeconds(seg))}s`);
      if (seg.blocking) lines.push(`- 走位：${seg.blocking}`);
      (seg.cuts ?? []).forEach((c, ci) => {
        const [from, to] = c.beats ?? [];
        lines.push(`  - #${ci + 1} ${c.size} ${c.camera} ${c.seconds}s　认领拍[${from}-${to}]`);
        lines.push(`    - 分镜图：${c.frame}`);
        lines.push(`    - 镜头：${c.shot}`);
      });
      if (seg.h3Prompt) lines.push(`\n**H3 提示词**\n\n\`\`\`\n${seg.h3Prompt}\n\`\`\``);
      lines.push('');
    });
  }
  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/* 渲染：HTML（自包含，双击即开）                                       */
/* ------------------------------------------------------------------ */

export function renderHtml(d, ctx = {}) {
  const p = paramsOf(d);
  const beats = allBeats(d);
  const total = totalBeatSeconds(d);
  const gates = gateReport(d, ctx);
  const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  // 节奏带：每段色块
  let strip = '';
  (d.segments ?? []).forEach((seg, si) => {
    const w = (segSeconds(seg) / Math.max(total, 1)) * 100;
    strip += `<div class="seg" style="width:${w}%" title="${esc(seg.id)} ${r1(segSeconds(seg))}s">${esc(seg.id)}</div>`;
  });
  let gateHtml = gates.map((g) => `<div class="gate ${g.ok ? 'ok' : 'bad'}">${g.ok ? '✓' : '✗'} ${esc(g.label)}${g.detail ? ` <span class="d">${esc(g.detail)}</span>` : ''}</div>`).join('');
  let beatsHtml = beats.map((b, i) => {
    const st = STAGES.find((s) => s.id === b.stage);
    const cls = b.action != null ? 'act' : 'line';
    const txt = b.action != null ? b.action : `${b.speaker ?? '?'}：${b.line}`;
    return `<tr><td>${i + 1}</td><td class="stage-${b.stage}">${esc(st?.label ?? '?')}</td><td class="${cls}">${esc(txt)}</td><td>${r1(beatSeconds(b, p))}s</td></tr>`;
  }).join('');
  let segHtml = (d.segments ?? []).map((seg) => {
    const cuts = (seg.cuts ?? []).map((c, ci) => `<tr><td>#${ci + 1}</td><td>${esc(c.size)}</td><td>${esc(c.camera)}</td><td>${c.seconds}s</td><td>${esc(c.frame)}</td></tr>`).join('');
    return `<div class="segcard"><h4>${esc(seg.id)} · ${r1(segSeconds(seg))}s</h4>${seg.blocking ? `<p class="blk">走位：${esc(seg.blocking)}</p>` : ''}<table class="cuts"><tr><th>#</th><th>景别</th><th>运镜</th><th>秒</th><th>分镜图提示词</th></tr>${cuts}</table></div>`;
  }).join('');

  return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(d.product || '带货短剧')} · 分镜</title><style>
  body{font:14px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;margin:0;padding:24px;background:#faf7f7;color:#222}
  h1{font-size:20px;margin:0 0 12px}.meta{color:#666;margin-bottom:16px}
  .strip{display:flex;height:34px;border-radius:6px;overflow:hidden;margin:10px 0;background:#eee}
  .seg{background:#b07070;color:#fff;font-size:11px;display:flex;align-items:center;justify-content:center;overflow:hidden;border-right:1px solid #fff}
  h2{font-size:16px;margin:24px 0 8px;border-left:4px solid #b07070;padding-left:8px}
  table{border-collapse:collapse;width:100%;margin:8px 0}td,th{border:1px solid #e2d9d9;padding:6px 8px;text-align:left;vertical-align:top}
  .stage-hook{color:#c0392b}.stage-conflict{color:#d35400}.stage-solution{color:#8e44ad}.stage-product{color:#27ae60}.stage-trust{color:#2980b9}.stage-cta{color:#16a085}
  .act{color:#555}.line{color:#222}
  .gates{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px}
  .gate{padding:6px 8px;border-radius:6px;font-size:12px;background:#fff;border:1px solid #e2d9d9}
  .gate.ok{border-left:4px solid #27ae60}.gate.bad{border-left:4px solid #c0392b}
  .gate .d{display:block;color:#c0392b;font-size:11px;margin-top:2px}
  .segcard{background:#fff;border:1px solid #e2d9d9;border-radius:8px;padding:12px;margin:10px 0}
  .blk{color:#666;margin:4px 0}
  </style></head><body>
  <h1>${esc(d.product || '带货短剧')} · 分镜脚本</h1>
  <div class="meta">平台 ${esc(d.platform)} · 画幅 ${esc(d.aspectRatio)} · 目标 ${d.targetSeconds}s · 预估 ${r1(total)}s</div>
  <div class="strip">${strip || '<div style="padding:8px;color:#999">尚无分镜</div>'}</div>
  <h2>核心质量门</h2><div class="gates">${gateHtml}</div>
  <h2>六段节拍流</h2>
  <table><tr><th>#</th><th>段</th><th>内容</th><th>秒</th></tr>${beatsHtml || '<tr><td colspan="4">空</td></tr>'}</table>
  <h2>分镜</h2>${segHtml || '<p class="meta">尚无分镜</p>'}
  </body></html>`;
}

/* ------------------------------------------------------------------ */
/* export — 投产包                                                      */
/* ------------------------------------------------------------------ */

export function exportPack(d, opts = {}) {
  const p = paramsOf(d);
  const protocol = opts.protocol ?? 'h3';
  const framesDir = opts.framesDir ?? 'frames';
  const pack = { product: d.product, platform: d.platform, aspectRatio: d.aspectRatio, protocol, segments: [] };
  (d.segments ?? []).forEach((seg) => {
    const item = { id: seg.id, seconds: r1(segSeconds(seg)), h3Prompt: seg.h3Prompt ?? null, frames: [] };
    (seg.cuts ?? []).forEach((c, ci) => {
      item.frames.push({ cut: `#${ci + 1}`, seconds: c.seconds, size: c.size, framePrompt: c.frame, shot: c.shot });
    });
    pack.segments.push(item);
  });
  return pack;
}

/* ------------------------------------------------------------------ */
/* 生成后端（可插拔）：config / gen / gen-video                          */
/* 学自 character-refs 的 config+gen 模式，后端可换、不锁模型。           */
/* ------------------------------------------------------------------ */

const CONFIG_PATH = join(baseDir, 'config.local.json');

export function loadConfig() {
  try { return JSON.parse(readFileSync(CONFIG_PATH, 'utf8')); } catch { return {}; }
}
export function saveConfig(cfg) {
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n');
}

/**
 * 调用出图后端生成一张分镜图。
 * backend: 'custom:<cmd>' | 'qwen' | 'codex' | 'openai'（后三者为占位，按需接适配器）
 * 返回写入的文件路径；失败抛错。
 */
export async function genFrame(backend, framePrompt, refImages, outFile) {
  mkdirSync(dirname(outFile), { recursive: true });
  if (backend?.startsWith('custom:')) {
    const cmd = backend.slice('custom:'.length);
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync(cmd, [framePrompt, ...refImages, outFile], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`custom 出图命令退出码 ${r.status}`);
    return outFile;
  }
  // 其余后端：打印提示，交由用户按 references/gen-backends.md 接入
  throw new Error(`后端「${backend}」未接入。参考 references/gen-backends.md 配置 custom:<命令> 或实现适配器。`);
}

export async function genAllFrames(d, opts = {}) {
  const cfg = loadConfig();
  const backend = opts.backend ?? cfg.imageBackend;
  if (!backend) throw new Error('未配置出图后端。先运行 config --image-backend custom:<命令>');
  const outDir = opts.outDir ?? 'frames';
  const results = [];
  for (const seg of d.segments ?? []) {
    for (const c of seg.cuts ?? []) {
      const out = join(outDir, seg.id, `${seg.id}-f.png`);
      // 单张主分镜图（首切）作为该段代表；真实多图对齐由调用方扩展
      try {
        await genFrame(backend, c.frame, opts.refImages ?? [], out);
        results.push({ seg: seg.id, ok: true, out });
      } catch (e) {
        results.push({ seg: seg.id, ok: false, error: String(e.message) });
      }
    }
  }
  return results;
}

/* ------------------------------------------------------------------ */
/* CLI                                                                  */
/* ------------------------------------------------------------------ */

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const flag = (name) => {
    const i = args.findIndex((a) => a === name);
    return i >= 0 ? args[i + 1] : null;
  };
  const hasFlag = (name) => args.includes(name);

  if (cmd === 'seed') {
    const specPath = args[0];
    const spec = specPath && existsSync(specPath) ? readJson(specPath) : {};
    if (flag('--product')) spec.product = flag('--product');
    if (flag('--seconds')) spec.targetSeconds = Number(flag('--seconds'));
    if (flag('--aspect')) spec.aspectRatio = flag('--aspect');
    if (flag('--platform')) spec.platform = flag('--platform');
    const out = seedDrama(spec);
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    return;
  }

  if (cmd === 'validate' || cmd === 'checkup') {
    const f = args[0];
    const d = readJson(f);
    const { gates, failed, ok } = checkup(d);
    if (cmd === 'validate') {
      for (const g of gates) console.log(`${g.ok ? '✓' : '✗'} ${g.label}${g.detail ? ' — ' + g.detail : ''}`);
      console.log(`\n${ok ? '全部通过' : `${failed.length} 道门未过，请逐条修订后重跑`}`);
      process.exit(ok ? 0 : 1);
    } else {
      for (const g of gates) console.log(`${g.ok ? '✓' : '✗'} ${g.label}${g.detail ? ' — ' + g.detail : ''}`);
    }
    return;
  }

  if (cmd === 'render') {
    const f = args[0];
    const d = readJson(f);
    if (hasFlag('--html')) process.stdout.write(renderHtml(d));
    else process.stdout.write(renderMd(d));
    return;
  }

  if (cmd === 'export') {
    const f = args[0];
    const d = readJson(f);
    const pack = exportPack(d, { protocol: flag('--protocol') ?? 'h3', framesDir: flag('--frames') });
    process.stdout.write(JSON.stringify(pack, null, 2) + '\n');
    return;
  }

  if (cmd === 'config') {
    const cfg = loadConfig();
    if (flag('--image-backend')) cfg.imageBackend = flag('--image-backend');
    if (flag('--video-backend')) cfg.videoBackend = flag('--video-backend');
    saveConfig(cfg);
    console.log('已保存配置：', JSON.stringify(cfg));
    return;
  }

  if (cmd === 'gen') {
    const f = args[0];
    const d = readJson(f);
    const res = await genAllFrames(d, { outDir: flag('--out'), refImages: flag('--refs') ? [flag('--refs')] : [] });
    res.forEach((r) => console.log(`${r.ok ? '✓' : '✗'} ${r.seg}${r.ok ? ' → ' + r.out : ' — ' + r.error}`));
    return;
  }

  console.log(`product-drama 用法：
  seed <spec.json> [--product 名 --seconds 45 --aspect 9:16 --platform douyin]   生成骨架
  validate <drama.json>                                                         核心门（不过 exit 1）
  checkup <drama.json>                                                           核心门（只报告）
  render <drama.json> [--html|--md]                                              渲染报告
  export <drama.json> [--protocol h3|seedance --frames <dir>]                    投产包
  config --image-backend custom:<命令> [--video-backend custom:<命令>]           配置生成后端
  gen <drama.json> [--out frames --refs 参考图]                                  生成分镜图
`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((e) => { console.error(e.message); process.exit(1); });

export default { seedDrama, gateReport, checkup, renderMd, renderHtml, exportPack, STAGES, DEFAULTS };
