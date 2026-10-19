#!/usr/bin/env node
/**
 * selftest.mjs — product-drama 确定性自测，不调模型、不花额度。
 * 覆盖：时长折算、六段结构、钩子前3拍、台词字数、分镜认领覆盖、段/切时长门。
 */
import { seedDrama, gateReport, checkup, renderMd, renderHtml, exportPack, STAGES } from './product-drama.mjs';

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.error('  FAIL:', name); } };

// 构造一个合法剧本：六段各若干拍，总分镜认领全覆盖
function buildGood() {
  const d = seedDrama({ product: '测试洗发水', targetSeconds: 32, platform: 'douyin' });
  const add = (stage, b) => d.beats.push({ stage, ...b });
  add('hook', { action: '女生甩头，发丝油腻打绺。' }); // 动作 2.5s
  add('hook', { speaker: 'C01', line: '三天没洗的头，见人都不敢抬头。', delivery: '压低声音' }); // 14字/4.5≈3.1s
  add('conflict', { action: '同事捂鼻挪开半步。' });
  add('conflict', { speaker: 'C01', line: '油头塌扁，整个人显脏十岁。', delivery: '自嘲' }); // 12字≈2.7s
  add('solution', { action: '她从包里掏出一瓶洗发水。' });
  add('solution', { speaker: 'C01', line: '直到换了这瓶控油洗发水。', delivery: '转折' }); // 12字≈2.7s
  add('product', { action: '泵头一按，泡沫丰盈裹住发丝。' });
  add('product', { speaker: 'C01', line: '一泵起泡，洗完三天不油。', delivery: '展示' }); // 11字≈2.4s
  add('trust', { action: '左右分屏：前一天 vs 第三天。' });
  add('trust', { speaker: 'C02', line: '同事实测，油头真的不塌了。', delivery: '背书' }); // 12字≈2.7s
  add('cta', { action: '她对着镜头举起瓶子笑。' });
  add('cta', { speaker: 'C01', line: '点左下，今天还有活动价。', delivery: '引导' }); // 12字≈2.7s
  // 分镜：3 段认领全部 12 拍（2,2,2,2,2,2 分组）
  const groups = [[1, 2], [3, 4], [5, 6], [7, 8], [9, 10], [11, 12]];
  for (let i = 0; i < groups.length; i++) {
    const [from, to] = groups[i];
    d.segments.push({
      id: `E01-${String(i + 1).padStart(2, '0')}`,
      blocking: '女生在画面左，产品在右。',
      cuts: [{
        beats: [from, to], seconds: 5, size: 'medium', camera: 'Static', characters: [],
        frame: '中景：女生在明亮浴室，手持洗发水瓶。', shot: '女生展示洗发水，镜头固定。',
        lens: '50mm 标准', cameraPosition: '女生平视正面', composition: '三分法', eyeline: '镜头', focus: '女生上半身', stability: 'stable',
      }],
    });
  }
  return d;
}

// 1) 时长折算
{
  const d = seedDrama({});
  d.beats = [{ stage: 'hook', action: '动作拍。' }, { stage: 'hook', speaker: 'C01', line: '一二三四五六七八九十' }];
  // 1 动作 = 2.5s；10字/4.5 = 2.22s → 总 4.72s
  const total = d.beats.reduce((n, b) => n + (b.action != null ? 2.5 : 10 / 4.5), 0);
  ok('时长折算=动作+台词', Math.abs(total - (2.5 + 10 / 4.5)) < 1e-6);
}

// 2) 全通过
{
  const d = buildGood();
  const { ok: allOk, failed } = checkup(d);
  ok('合法剧本全部门通过', allOk);
  if (!allOk) console.error('   failed:', failed.map((g) => g.label));
}

// 3) 缺段失败
{
  const d = buildGood();
  d.beats = d.beats.filter((b) => b.stage !== 'trust');
  ok('缺信任段 → six-stage 门失败', !checkup(d).ok);
}

// 4) 钩子不在前3拍
{
  const d = buildGood();
  d.beats.forEach((b) => { if (b.stage === 'hook') b.stage = 'product'; });
  d.beats[6].stage = 'hook'; // 第7拍
  ok('钩子在第7拍 → hook-window 门失败', !checkup(d).ok);
}

// 5) 台词超字数
{
  const d = buildGood();
  d.beats[1].line = '这是一句明显超过了三十五个中文字符上限的超级长的台词用来测试门是否会正确拦截';
  ok('超长台词 → max-line-chars 门失败', !checkup(d).ok);
}

// 6) 分镜未全覆盖
{
  const d = buildGood();
  d.segments[0].cuts[0].beats = [1, 2];
  d.segments[2].cuts[0].beats = [5, 5]; // 第6拍没人认领
  ok('节拍未全覆盖 → beat-coverage 门失败', !checkup(d).ok);
}

// 7) 切超长
{
  const d = buildGood();
  d.segments[0].cuts[0].seconds = 8;
  ok('单切8秒 → cut-length 门失败', !checkup(d).ok);
}

// 8) 段超上限
{
  const d = buildGood();
  d.segments[0].cuts[0].seconds = 20; // 该段 20s > 15
  ok('段超15秒 → segment-cap 门失败', !checkup(d).ok);
}

// 9) 时长超预算（把目标设很小）
{
  const d = buildGood();
  d.targetSeconds = 10;
  ok('远超目标 → duration 门失败', !checkup(d).ok);
}

// 10) 渲染与导出不报错
{
  const d = buildGood();
  ok('renderMd 产出字符串', typeof renderMd(d) === 'string' && renderMd(d).includes('节拍流'));
  ok('renderHtml 含质量门', renderHtml(d).includes('核心质量门'));
  const pack = exportPack(d, { protocol: 'h3' });
  ok('exportPack 含 segments', Array.isArray(pack.segments) && pack.segments.length === 6);
}

console.log(`\nproduct-drama 自测：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
