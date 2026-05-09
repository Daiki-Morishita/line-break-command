// ── Constants ──────────────────────────────────
const TARGET_PER_LINE = 22;
const LONE_PARTICLES  = new Set([...'はがをのにでへとも']);

let parser       = null;
let debounceTimer = null;

// ── Init ───────────────────────────────────────
window.addEventListener('load', () => {
  document.getElementById('loaderMsg').style.display = 'flex';
  try {
    parser = budoux.loadDefaultJapaneseParser();
  } catch (e) {
    console.error('BudouX load failed', e);
  }
  document.getElementById('loaderMsg').style.display = 'none';
  bindEvents();
  process();
});

function buildRulers(maxChars) {
  const step = 5;
  const ticks = [];
  for (let i = step; i <= maxChars; i += step) ticks.push(i);
  if (ticks.at(-1) !== maxChars) ticks.push(maxChars);
  const html = ticks.map(n =>
    `<span class="ruler-tick${n === maxChars ? ' ruler-max' : ''}">${n}</span>`
  ).join('');
  document.getElementById('rulerLeft').innerHTML  = html;
  document.getElementById('rulerRight').innerHTML = html;
}

function bindEvents() {
  document.getElementById('inputText').addEventListener('input',    scheduleProcess);
  document.getElementById('maxChars').addEventListener('input', () => {
    const v = Math.max(10, parseInt(document.getElementById('maxChars').value) || 30);
    buildRulers(v);
    scheduleProcess();
  });
  document.getElementById('removePunct').addEventListener('change', scheduleProcess);
  document.getElementById('removeBlank').addEventListener('change', scheduleProcess);
  document.getElementById('clearBtn').addEventListener('click',     clearInput);
  document.getElementById('copyBtn').addEventListener('click',      copyOutput);
  buildRulers(30);
}

function scheduleProcess() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(process, 120);
}

// ── Algorithm ──────────────────────────────────

function effLen(s) {
  let n = 0;
  for (const c of s) if (c !== '、' && c !== '。') n++;
  return n;
}

function getChunks(text) {
  text = text.trim();
  if (!text || !parser) return [];
  try { return parser.parse(text); } catch { return [text]; }
}

function breakBonus(chunks, j) {
  const n = chunks.length;
  let bonus = 0;

  if (j > 0) {
    const prev = chunks[j - 1];
    if (prev.endsWith('たら') || prev.endsWith('れば')) {
      bonus -= 7;
    } else if (prev.endsWith('、')) {
      // suppress inside 「…」
      let depth = 0;
      for (let k = 0; k < j; k++)
        for (const c of chunks[k]) {
          if (c === '「') depth++;
          else if (c === '」') depth--;
        }
      if (depth === 0) bonus -= 9;
    } else if (prev.endsWith('から') || prev.endsWith('まで')) {
      bonus -= 4;
    } else if (prev.endsWith('が') || prev.endsWith('は')) {
      bonus -= 4;
    } else if (prev.endsWith('を') || prev.endsWith('に')) {
      bonus -= 2;
    } else if (prev.endsWith('の')) {
      bonus -= 1;
    } else if (prev.endsWith('て') || prev.endsWith('で')) {
      bonus -= 1;
    }
  }

  if (j < n) {
    if (chunks[j][0] === '「') {
      const prev = j > 0 ? chunks[j - 1] : '';
      const isDemonstrative = prev.endsWith('この') || prev.endsWith('その') ||
                              prev.endsWith('あの') || prev.endsWith('どの');
      bonus += isDemonstrative ? 8 : -5;
    } else if (LONE_PARTICLES.has(chunks[j][0])) {
      bonus += 4;
    }
  }

  return bonus;
}

function searchNLines(chunks, cumeff, n, nLines, maxChars) {
  const cache = new Map();

  function search(start, remaining) {
    const key = `${start},${remaining}`;
    if (cache.has(key)) return cache.get(key);

    let result = null;

    if (remaining === 1) {
      const seg = cumeff[n] - cumeff[start];
      result = (seg > 0 && seg <= maxChars) ? [seg, seg, 0, [n]] : null;
    } else {
      let best = null;
      for (let end = start + 1; end < n; end++) {
        const seg = cumeff[end] - cumeff[start];
        if (seg > maxChars) break;
        if (seg === 0) continue;

        const sub = search(end, remaining - 1);
        if (!sub) continue;

        const bb = breakBonus(chunks, end);
        const [, subRaw, subBonus, subPath] = sub;

        const curRaw   = Math.max(seg, subRaw);
        const curBonus = bb + subBonus;
        let   curAdj   = curRaw + curBonus;

        // Penalty: line ending with unclosed 「
        let openQ = 0;
        for (let k = start; k < end; k++)
          for (const c of chunks[k]) {
            if (c === '「') openQ++;
            else if (c === '」') openQ--;
          }
        if (openQ > 0) curAdj += 8;

        if (!best || curAdj < best[0])
          best = [curAdj, curRaw, curBonus, [end, ...subPath]];
      }
      result = best;
    }

    cache.set(key, result);
    return result;
  }

  const res = search(0, nLines);
  if (!res) return null;

  const [,,,path] = res;
  const lines = [];
  let start = 0;
  for (const end of path) {
    const seg = chunks.slice(start, end).join('').replace(/^[、]+|[、]+$/g, '');
    if (seg) lines.push(seg);
    start = end;
  }
  return lines.length === nLines ? lines : null;
}

function forceBreakChunks(chunks, maxChars) {
  const lines = [];
  let buf = '', bufEff = 0;
  for (const c of chunks) {
    const ce = effLen(c);
    if (bufEff + ce > maxChars && buf) {
      lines.push(buf.replace(/^[、]+|[、]+$/g, ''));
      buf = c; bufEff = ce;
    } else {
      buf += c; bufEff += ce;
    }
  }
  if (buf) lines.push(buf.replace(/^[、]+|[、]+$/g, ''));
  return lines;
}

function dpBreakChunks(chunks, maxChars) {
  if (!chunks.length) return [];

  const n = chunks.length;
  const cumeff = [0];
  for (const c of chunks) cumeff.push(cumeff.at(-1) + effLen(c));

  const total = cumeff[n];
  if (total <= maxChars) return [chunks.join('')];

  const minN = Math.ceil(total / maxChars);

  for (const targetN of [minN, minN + 1, minN - 1]) {
    if (targetN < minN) continue;
    const result = searchNLines(chunks, cumeff, n, targetN, maxChars);
    if (result) return result;
  }

  return forceBreakChunks(chunks, maxChars);
}

function processSentence(sentence, maxChars) {
  sentence = sentence.trim();
  if (!sentence) return [];
  if (effLen(sentence) <= maxChars) return [sentence];
  const chunks = getChunks(sentence);
  if (!chunks.length) return [sentence];
  return dpBreakChunks(chunks, maxChars);
}

function splitBySentence(text, maxChars) {
  const lines = [];
  // Split after 。？！ — each becomes its own sentence unit
  const sentences = text.trim().split(/(?<=[。？！])/).filter(s => s.trim());
  for (const sent of sentences) {
    const hasMaru = sent.endsWith('。');
    const core = hasMaru ? sent.slice(0, -1) : sent;
    if (!core.trim()) continue;
    const processed = processSentence(core.trim(), maxChars);
    if (processed.length > 0 && hasMaru)
      processed[processed.length - 1] += '。';
    lines.push(...processed);
  }
  return lines;
}

function processAnnotated(para, maxChars) {
  const lines = [];
  for (let part of para.split(/(?=✔)/)) {
    part = part.trim();
    if (!part) continue;
    if (part.startsWith('✔')) {
      const core = part.replace(/。$/, '');
      const m = core.match(/^(✔[︎\s]*\S+(?:ない|する|いる|れる|された|ます|です|だ|い))\s+(.*)/);
      if (m) {
        if (m[1].trim()) lines.push(...processSentence(m[1].trim(), maxChars));
        if (m[2].trim()) lines.push(...splitBySentence(m[2].trim(), maxChars));
      } else {
        lines.push(...splitBySentence(core, maxChars));
      }
    } else {
      lines.push(...splitBySentence(part, maxChars));
    }
  }
  return lines;
}

function processParagraph(para, maxChars) {
  if (!para.trim()) return [];
  if (/[✔※●▶]/.test(para)) return processAnnotated(para, maxChars);
  return splitBySentence(para, maxChars);
}

function stage1Linebreak(text, maxChars) {
  const result = [];
  const blocks = text.trim().split(/\n[ \t]*\n/);
  for (const block of blocks) {
    const rawLines = block.trim().split('\n').map(l => l.trim()).filter(Boolean);
    if (!rawLines.length) { result.push(''); continue; }

    // ASCII-only lines (e.g. speaker names like "Masa") stay standalone.
    // All other consecutive lines are joined so the DP can optimize globally.
    const groups = [];
    let buf = null;
    for (const line of rawLines) {
      if (/^[\x00-\x7F]+$/.test(line)) {
        if (buf) { groups.push(buf); buf = null; }
        groups.push(line);
      } else {
        buf = buf ? buf + line : line;
      }
    }
    if (buf) groups.push(buf);

    for (const g of groups) result.push(...processParagraph(g, maxChars));
    result.push('');
  }
  while (result.length && result.at(-1) === '') result.pop();
  return result.join('\n');
}

function stage2Finalize(text, removePunct, removeBlank) {
  if (removePunct) text = text.replace(/[。、]/g, '');
  if (removeBlank) text = text.split('\n').filter(l => l.trim()).join('\n');
  return text;
}

// ── UI ─────────────────────────────────────────

function process() {
  if (!parser) return;

  const text      = document.getElementById('inputText').value;
  const maxChars  = Math.max(10, parseInt(document.getElementById('maxChars').value) || 30);
  const rmPunct   = document.getElementById('removePunct').checked;
  const rmBlank   = document.getElementById('removeBlank').checked;

  const inputLen = [...text].filter(c => c.trim()).length;
  document.getElementById('inputCount').textContent = `${inputLen.toLocaleString()}文字`;

  if (!text.trim()) {
    document.getElementById('outputText').value = '';
    document.getElementById('outputCount').textContent = '0行';
    return;
  }

  let result = stage1Linebreak(text, maxChars);
  if (rmPunct || rmBlank) result = stage2Finalize(result, rmPunct, rmBlank);

  document.getElementById('outputText').value = result;
  const lineCount = result.split('\n').filter(l => l.trim()).length;
  document.getElementById('outputCount').textContent = `${lineCount.toLocaleString()}行`;
}

function clearInput() {
  document.getElementById('inputText').value = '';
  process();
  document.getElementById('inputText').focus();
}

async function copyOutput() {
  const text = document.getElementById('outputText').value;
  if (!text) return;
  const btn = document.getElementById('copyBtn');
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = 'コピー済み ✓';
    btn.classList.add('copied');
  } catch {
    document.getElementById('outputText').select();
    document.execCommand('copy');
    btn.textContent = 'コピー済み ✓';
    btn.classList.add('copied');
  }
  setTimeout(() => {
    btn.textContent = 'コピー';
    btn.classList.remove('copied');
  }, 2000);
}
