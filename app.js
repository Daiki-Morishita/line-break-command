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

function bindEvents() {
  document.getElementById('inputText').addEventListener('input',  scheduleProcess);
  document.getElementById('maxChars').addEventListener('input',   scheduleProcess);
  document.getElementById('removePunct').addEventListener('change', scheduleProcess);
  document.getElementById('removeBlank').addEventListener('change', scheduleProcess);
  document.getElementById('clearBtn').addEventListener('click',   clearInput);
  document.getElementById('copyBtn').addEventListener('click',    copyOutput);
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
      bonus -= 5;
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

  const minN       = Math.ceil(total / maxChars);
  const preferredN = Math.max(minN, Math.ceil(total / TARGET_PER_LINE));

  for (const targetN of [preferredN, preferredN + 1, preferredN - 1]) {
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
        if (m[2].trim()) lines.push(...processSentence(m[2].trim(), maxChars));
      } else {
        lines.push(...processSentence(core, maxChars));
      }
    } else {
      lines.push(...processSentence(part.replace(/。$/, ''), maxChars));
    }
  }
  return lines;
}

function processParagraph(para, maxChars) {
  if (!para.trim()) return [];
  if (/[✔※●▶]/.test(para)) return processAnnotated(para, maxChars);

  const lines = [];
  const sentences = para.trim()
    .split('。')
    .map((s, i, arr) => i < arr.length - 1 ? s + '。' : s)
    .filter(s => s.trim());

  for (const sent of sentences) {
    const core = sent.endsWith('。') ? sent.slice(0, -1) : sent;
    if (core.trim()) lines.push(...processSentence(core.trim(), maxChars));
  }
  return lines;
}

function stage1Linebreak(text, maxChars) {
  const result = [];
  for (const para of text.trim().split('\n')) {
    const p = para.trim();
    if (!p) { result.push(''); continue; }
    result.push(...processParagraph(p, maxChars));
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
