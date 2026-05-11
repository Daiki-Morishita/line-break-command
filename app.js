// ── Constants ──────────────────────────────────
const TARGET_PER_LINE = 22;
const LONE_PARTICLES  = new Set([...'はがをのにでへとも']);

// Practical recommended range for Japanese subtitles
const WARN_MAX = 45;

let parser           = null;
let debounceTimer    = null;
let excludePunctFlag = true;
let charPixelWidth   = null;

function measureCharWidth() {
  const ta = document.getElementById('inputText');
  const cs = getComputedStyle(ta);
  const probe = document.createElement('span');
  Object.assign(probe.style, {
    position:      'fixed',
    visibility:    'hidden',
    whiteSpace:    'nowrap',
    fontFamily:    cs.fontFamily,
    fontSize:      cs.fontSize,
    fontWeight:    cs.fontWeight,
    letterSpacing: cs.letterSpacing,
  });
  probe.textContent = '一'.repeat(40);
  document.body.appendChild(probe);
  const w = probe.getBoundingClientRect().width / 40;
  probe.remove();
  return w;
}

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
  const cw = measureCharWidth();
  charPixelWidth = cw;
  const ta = document.getElementById('inputText');
  const paddingLeft = parseFloat(getComputedStyle(ta).paddingLeft);
  const step = 5;
  const ticks = [];
  for (let i = step; i <= maxChars; i += step) ticks.push(i);
  if (ticks.at(-1) !== maxChars) ticks.push(maxChars);
  const html = ticks.map(n => {
    const left = (paddingLeft + n * cw).toFixed(1) + 'px';
    return `<span class="ruler-tick${n === maxChars ? ' ruler-max' : ''}" style="left:${left}">${n}</span>`;
  }).join('');
  document.getElementById('rulerLeft').innerHTML  = html;
  document.getElementById('rulerRight').innerHTML = html;
}

function bindEvents() {
  document.getElementById('inputText').addEventListener('input', scheduleProcess);
  document.getElementById('maxChars').addEventListener('input', () => {
    const v = Math.min(45, Math.max(5, parseInt(document.getElementById('maxChars').value) || 27));
    updateCharWarning(v);
    buildRulers(v);
    scheduleProcess();
  });
  document.getElementById('removePunct').addEventListener('change',  scheduleProcess);
  document.getElementById('removeBlank').addEventListener('change',  scheduleProcess);
  document.getElementById('excludePunct').addEventListener('change', scheduleProcess);
  document.getElementById('clearBtn').addEventListener('click',      clearInput);
  document.getElementById('copyBtn').addEventListener('click',       copyOutput);
  document.getElementById('replaceToggleBtn').addEventListener('click', toggleReplaceBar);
  document.getElementById('closeReplaceBtn').addEventListener('click',  () => toggleReplaceBar(false));
  document.getElementById('replaceBtn').addEventListener('click',        applyReplace);
  document.getElementById('resetBtn').addEventListener('click', resetDefaults);
  document.getElementById('punctToSpace').addEventListener('change', scheduleProcess);

  // Quote dropdown
  document.getElementById('quoteBtnToggle').addEventListener('click', e => {
    e.stopPropagation();
    toggleDropdown('quoteMenu');
  });
  document.querySelectorAll('#quoteMenu .dropdown-item').forEach(btn => {
    btn.addEventListener('click', () => {
      convertQuotes(btn.dataset.quote);
      closeAllDropdowns();
    });
  });

  // Export dropdown
  document.getElementById('exportBtnToggle').addEventListener('click', e => {
    e.stopPropagation();
    toggleDropdown('exportMenu');
  });
  document.querySelectorAll('#exportMenu .dropdown-item').forEach(btn => {
    btn.addEventListener('click', () => {
      exportOutput(btn.dataset.format);
      closeAllDropdowns();
    });
  });

  document.addEventListener('click', closeAllDropdowns);

  buildRulers(27);
  updateCharWarning(27);
}

function scheduleProcess() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(process, 120);
}

// ── Dropdown ───────────────────────────────────

function toggleDropdown(menuId) {
  const menu = document.getElementById(menuId);
  const isOpen = menu.classList.contains('open');
  closeAllDropdowns();
  if (!isOpen) {
    menu.classList.add('open');
    const btn = menu.previousElementSibling;
    if (btn) btn.classList.add('open');
  }
}

function closeAllDropdowns() {
  document.querySelectorAll('.dropdown-menu').forEach(m => m.classList.remove('open'));
  document.querySelectorAll('.btn-quote, .btn-export').forEach(b => b.classList.remove('open'));
}

// ── Char warning ───────────────────────────────

function updateCharWarning(v) {
  const el = document.getElementById('charWarning');
  if (v > WARN_MAX) {
    el.textContent = `⚠ 1行の文字数は${WARN_MAX}文字が最大です。`;
    el.style.display = 'block';
  } else {
    el.style.display = 'none';
  }
}

// ── Algorithm ──────────────────────────────────

function effLen(s) {
  let n = 0;
  for (const c of s) {
    if (excludePunctFlag && (c === '、' || c === '。')) continue;
    n++;
  }
  return n;
}

function getChunks(text) {
  text = text.trim();
  if (!text || !parser) return [];
  let chunks;
  try { chunks = parser.parse(text); } catch { return [text]; }
  chunks = mergeDigitRanges(chunks);
  chunks = mergeListItems(chunks);
  return chunks;
}

// 「2、3年」のような数字範囲は一塊として扱う
function mergeDigitRanges(chunks) {
  const out = [];
  for (const c of chunks) {
    const last = out.at(-1);
    if (last && /[0-9０-９]、$/.test(last) && /^[0-9０-９]/.test(c)) {
      out[out.length - 1] = last + c;
    } else {
      out.push(c);
    }
  }
  return out;
}

// 「Gemini、Claude」のような並列リスト（非ひらがな要素の列挙）は結合
// 句末助詞（は/が/を等）の後の 、 は節境界なので結合しない
function mergeListItems(chunks) {
  const out = [];
  for (const c of chunks) {
    const last = out.at(-1);
    if (last) {
      const m = last.match(/(.)、$/);
      if (m && !/[ぁ-ん]/.test(m[1]) && c.length > 0 && !/[ぁ-ん\s]/.test(c[0])) {
        out[out.length - 1] = last + c;
        continue;
      }
    }
    out.push(c);
  }
  return out;
}

// Returns true when a 「」 content looks like direct speech (isolate it)
function isSpeechQuote(content) {
  if (content.length < 5) return false;
  // Technical terms / loanwords ending with closing bracket → don't isolate
  if (/[）\]｝》〉\)]$/.test(content)) return false;
  // 多語末尾（です/ます/ない 等）— 1文字より優先して検査
  if (/(?:です|ます|ません|でした|でしょう|だろう|である|ない|だった|ている|ています|ていた|していた|してい|ていく|てくる|かもしれない|はず|べき|わけ|つもり|ところ)$/.test(content)) return true;
  // 文末記号
  if (/[。．？！?!]$/.test(content)) return true;
  // 動詞終止形 / 形容詞 / 助動詞 / 終助詞の末尾文字
  // る す く つ ぬ ぶ む ぐ う = 動詞終止形
  // い = 形容詞 / 動詞「ます」化前
  // た = 過去
  // だ = 断定
  // よ ね わ ぞ ぜ か な さ = 終助詞
  if (/[るすくつぬぶむぐういただ。？！よねわぞぜかなさ]$/.test(content)) return true;
  return false;
}

function breakBonus(chunks, j) {
  const n = chunks.length;
  let bonus = 0;

  if (j > 0) {
    const prev = chunks[j - 1];
    // 文末（。．！？）は最強の改行候補
    if (/[。．！？!?]$/.test(prev)) {
      bonus -= 14;
    } else if (prev.endsWith('たら') || prev.endsWith('れば')) {
      bonus -= 7;
    } else if (prev.endsWith('、')) {
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
    } else if (prev.endsWith('と') && j < chunks.length && /^いった|^いう|^いわ/.test(chunks[j])) {
      bonus += 8;
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

// ・-chain of 3+ words (e.g. レイ・ダリオ・スタンレー): split at ・ boundaries,
// placing ・ at the head of each subsequent word so DP can break there.
// ひらがなを除外: 固有名詞（カタカナ・漢字・英字）の・連続のみ対象
const NAKAGURO_CHAIN_RE = /[^\s・、。？！「」『』（）[\]()ぁ-ん]+(?:・[^\s・、。？！「」『』（）[\]()ぁ-ん]+){2,}/g;

function processSentence(sentence, maxChars) {
  sentence = sentence.trim();
  if (!sentence) return [];
  if (effLen(sentence) <= maxChars) return [sentence];

  NAKAGURO_CHAIN_RE.lastIndex = 0;
  if (NAKAGURO_CHAIN_RE.test(sentence)) {
    NAKAGURO_CHAIN_RE.lastIndex = 0;
    const allChunks = [];
    let lastIndex = 0;
    let m;
    while ((m = NAKAGURO_CHAIN_RE.exec(sentence)) !== null) {
      if (m.index > lastIndex) {
        allChunks.push(...getChunks(sentence.slice(lastIndex, m.index)));
      }
      const parts = m[0].split('・');
      allChunks.push(parts[0]);
      for (let i = 1; i < parts.length; i++) {
        if (parts[i]) allChunks.push('・' + parts[i]);
      }
      lastIndex = m.index + m[0].length;
    }
    if (lastIndex < sentence.length) {
      allChunks.push(...getChunks(sentence.slice(lastIndex)));
    }
    if (!allChunks.length) return [sentence];
    return dpBreakChunks(allChunks, maxChars);
  }

  const chunks = getChunks(sentence);
  if (!chunks.length) return [sentence];
  return dpBreakChunks(chunks, maxChars);
}

function splitBySentence(text, maxChars) {
  const lines = [];
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

// Split paragraph at speech-quote boundaries and isolate each quote as own line(s)
function processParagraphWithQuotes(para, maxChars) {
  const re = /「([^」]*)」/g;
  let lastEnd = 0;
  let match;
  const segments = [];

  while ((match = re.exec(para)) !== null) {
    const before = para.slice(lastEnd, match.index);
    if (before) segments.push({ type: 'text', value: before });

    const content = match[1];
    if (isSpeechQuote(content)) {
      segments.push({ type: 'speech', value: match[0], content });
    } else {
      segments.push({ type: 'text', value: match[0] });
    }
    lastEnd = match.index + match[0].length;
  }

  const tail = para.slice(lastEnd);
  if (tail) segments.push({ type: 'text', value: tail });

  // No speech quotes → normal processing
  if (!segments.some(s => s.type === 'speech')) {
    return splitBySentence(para, maxChars);
  }

  const lines = [];
  let textBuf = '';

  for (const seg of segments) {
    if (seg.type === 'text') {
      textBuf += seg.value;
    } else {
      // Flush accumulated text first
      if (textBuf.trim()) {
        lines.push(...splitBySentence(textBuf.trim(), maxChars));
        textBuf = '';
      }
      // Output the speech quote as its own line(s)
      if (effLen(seg.value) <= maxChars) {
        lines.push(seg.value);
      } else {
        // Break long quote: attach 「 to first part and 」 to last part
        const innerChunks = getChunks(seg.content);
        const broken = dpBreakChunks(innerChunks, maxChars - 1);
        broken.forEach((part, i) => {
          if (broken.length === 1)      lines.push('「' + part + '」');
          else if (i === 0)              lines.push('「' + part);
          else if (i === broken.length - 1) lines.push(part + '」');
          else                           lines.push(part);
        });
      }
    }
  }

  if (textBuf.trim()) {
    lines.push(...splitBySentence(textBuf.trim(), maxChars));
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
        if (m[2].trim()) lines.push(...processParagraphWithQuotes(m[2].trim(), maxChars));
      } else {
        lines.push(...processParagraphWithQuotes(core, maxChars));
      }
    } else {
      lines.push(...processParagraphWithQuotes(part, maxChars));
    }
  }
  return lines;
}

// ※注釈は独立行として扱う。終端は接続詞/句点/別の※/文末で判定。
const ANNOT_END_LOOKAHEAD =
  /(?=しかし|しかも|ただし|また|なお|ところが|そして|ところで|つまり|ちなみに|要するに|そのため|したがって|それゆえ|それでも|それでは|ですが|でも|だが|だから|なぜなら|たとえば|例えば|具体的に|そこで|ところで|さて|では|それで|※|[。．？！\n]|$)/;

function splitOnAsterisk(text) {
  const result = [];
  const re = new RegExp('※[^※]*?' + ANNOT_END_LOOKAHEAD.source, 'g');
  let lastEnd = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastEnd) {
      const before = text.slice(lastEnd, m.index);
      if (before.trim()) result.push(before);
    }
    const annot = m[0].trim();
    if (annot && annot !== '※') result.push(annot);
    lastEnd = m.index + m[0].length;
    if (re.lastIndex <= m.index) re.lastIndex = m.index + 1;
  }
  if (lastEnd < text.length) {
    const tail = text.slice(lastEnd);
    if (tail.trim()) result.push(tail);
  }
  return result;
}

function processParagraph(para, maxChars) {
  if (!para.trim()) return [];

  // ※を含む段落: ※注釈を独立行として切り出してから他を処理
  if (para.includes('※')) {
    const segs = splitOnAsterisk(para);
    const lines = [];
    for (const seg of segs) {
      const s = seg.trim();
      if (!s) continue;
      if (s.startsWith('※')) {
        lines.push(s);
      } else {
        // ※を含まない断片: 通常処理（✔等は再帰）
        if (/[✔●▶]/.test(s)) {
          lines.push(...processAnnotated(s, maxChars));
        } else {
          lines.push(...processParagraphWithQuotes(s, maxChars));
        }
      }
    }
    return lines;
  }

  if (/[✔●▶]/.test(para)) return processAnnotated(para, maxChars);
  return processParagraphWithQuotes(para, maxChars);
}

// 複数行にまたがる（...）を1行に結合（空白行も跨ぐ）
function joinMultilineParens(text) {
  const lines = text.split('\n');
  const out = [];
  let buf = null;
  for (const line of lines) {
    if (buf !== null) {
      buf += line.trim();
      if (line.includes('）')) { out.push(buf); buf = null; }
    } else if (line.includes('（') && !line.includes('）')) {
      buf = line.trim();
    } else {
      out.push(line);
    }
  }
  if (buf !== null) out.push(buf);
  return out.join('\n');
}

function stage1Linebreak(text, maxChars) {
  text = joinMultilineParens(text);
  const result = [];
  const blocks = text.trim().split(/\n[ \t]*\n/);
  for (const block of blocks) {
    const rawLines = block.trim().split('\n').map(l => l.trim()).filter(Boolean);
    if (!rawLines.length) { result.push(''); continue; }

    const groups = [];
    let buf = null;
    for (const line of rawLines) {
      // （...）で完結する注釈行は独立 noBreak グループ
      if (line.startsWith('（') && line.endsWith('）')) {
        if (buf) { groups.push(buf); buf = null; }
        groups.push({type: 'noBreak', text: line});
        continue;
      }
      if (/^[\x00-\x7F]+$/.test(line)) {
        if (buf) { groups.push(buf); buf = null; }
        groups.push(line);
      } else {
        buf = buf ? buf + line : line;
      }
    }
    if (buf) groups.push(buf);

    for (const g of groups) {
      if (typeof g === 'object' && g.type === 'noBreak') {
        result.push(g.text);
      } else {
        result.push(...processParagraph(g, maxChars));
      }
    }
    result.push('');
  }
  while (result.length && result.at(-1) === '') result.pop();
  return result.join('\n');
}

function stage2Finalize(text, removePunct, removeBlank, punctToSpace) {
  if (punctToSpace) text = text.replace(/、/g, ' ');
  if (removePunct)  text = text.replace(/[。、]/g, '');
  if (removeBlank)  text = text.split('\n').filter(l => l.trim()).join('\n');
  return text;
}

// ── UI ─────────────────────────────────────────

function process() {
  if (!parser) return;

  const text     = document.getElementById('inputText').value;
  const maxChars = Math.max(5, parseInt(document.getElementById('maxChars').value) || 27);
  const rmPunct     = document.getElementById('removePunct').checked;
  const rmBlank     = document.getElementById('removeBlank').checked;
  const punctToSpace = document.getElementById('punctToSpace').checked;

  excludePunctFlag = document.getElementById('excludePunct').checked;

  const inputLen = [...text].filter(c => c.trim()).length;
  document.getElementById('inputCount').textContent = `${inputLen.toLocaleString()}文字`;

  if (!text.trim()) {
    document.getElementById('outputText').value = '';
    document.getElementById('outputCount').textContent = '0行';
    return;
  }

  let result = stage1Linebreak(text, maxChars);
  if (rmPunct || rmBlank || punctToSpace) result = stage2Finalize(result, rmPunct, rmBlank, punctToSpace);

  document.getElementById('outputText').value = result;
  const lineCount = result.split('\n').filter(l => l.trim()).length;
  document.getElementById('outputCount').textContent = `${lineCount.toLocaleString()}行`;
}

function clearInput() {
  document.getElementById('inputText').value = '';
  process();
  document.getElementById('inputText').focus();
}

function resetDefaults() {
  document.getElementById('maxChars').value = 27;
  document.getElementById('removePunct').checked = false;
  document.getElementById('removeBlank').checked = false;
  document.getElementById('excludePunct').checked = true;
  document.getElementById('punctToSpace').checked = false;
  toggleReplaceBar(false);
  buildRulers(27);
  updateCharWarning(27);
  process();
}


function toggleReplaceBar(show) {
  const bar = document.getElementById('replaceBar');
  const btn = document.getElementById('replaceToggleBtn');
  const isVisible = bar.style.display !== 'none';
  const shouldShow = show !== undefined ? show : !isVisible;
  bar.style.display = shouldShow ? 'flex' : 'none';
  btn.classList.toggle('active', shouldShow);
  if (shouldShow) document.getElementById('findText').focus();
}

function applyReplace() {
  const find = document.getElementById('findText').value;
  const replaceWith = document.getElementById('replaceText').value;
  if (!find) return;
  const ta = document.getElementById('inputText');
  const escaped = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  ta.value = ta.value.replace(new RegExp(escaped, 'g'), replaceWith);
  const btn = document.getElementById('replaceBtn');
  btn.textContent = '置換済み ✓';
  btn.classList.add('done');
  setTimeout(() => { btn.textContent = '全て置換'; btn.classList.remove('done'); }, 1500);
  scheduleProcess();
}

function convertQuotes(type) {
  const ta = document.getElementById('outputText');
  if (!ta.value) return;
  switch (type) {
    case 'kagi-double':   ta.value = ta.value.replace(/「/g, '“').replace(/」/g, '”'); break;
    case 'kagi-single':   ta.value = ta.value.replace(/「/g, '‘').replace(/」/g, '’'); break;
    case 'kakko-double':  ta.value = ta.value.replace(/『/g, '“').replace(/』/g, '”'); break;
    case 'kakko-single':  ta.value = ta.value.replace(/『/g, '‘').replace(/』/g, '’'); break;
  }
  const lineCount = ta.value.split('\n').filter(l => l.trim()).length;
  document.getElementById('outputCount').textContent = `${lineCount.toLocaleString()}行`;
}

// ── Export ─────────────────────────────────────

function formatSRTTime(seconds) {
  const h = String(Math.floor(seconds / 3600)).padStart(2, '0');
  const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
  const s = String(seconds % 60).padStart(2, '0');
  return `${h}:${m}:${s},000`;
}

function formatVTTTime(seconds) {
  const h = String(Math.floor(seconds / 3600)).padStart(2, '0');
  const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
  const s = String(seconds % 60).padStart(2, '0');
  return `${h}:${m}:${s}.000`;
}

function exportOutput(format) {
  const text = document.getElementById('outputText').value;
  if (!text.trim()) return;

  const lines = text.split('\n').filter(l => l.trim());
  let content = '';
  let mime = 'text/plain';

  switch (format) {
    case 'txt':
      content = text;
      break;
    case 'csv':
      content = lines.map(l => `"${l.replace(/"/g, '""')}"`).join('\n');
      mime = 'text/csv';
      break;
    case 'srt':
      content = lines.map((l, i) => {
        const start = formatSRTTime(i * 2);
        const end   = formatSRTTime(i * 2 + 2);
        return `${i + 1}\n${start} --> ${end}\n${l}`;
      }).join('\n\n');
      break;
    case 'vtt':
      content = 'WEBVTT\n\n' + lines.map((l, i) => {
        const start = formatVTTTime(i * 2);
        const end   = formatVTTTime(i * 2 + 2);
        return `${start} --> ${end}\n${l}`;
      }).join('\n\n');
      break;
    case 'json':
      content = JSON.stringify(lines, null, 2);
      mime = 'application/json';
      break;
  }

  const bom  = format === 'csv' ? '﻿' : '';
  const blob = new Blob([bom + content], { type: `${mime};charset=utf-8` });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `subtitles.${format}`;
  a.click();
  URL.revokeObjectURL(url);
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
