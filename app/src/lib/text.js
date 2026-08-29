// 文本与注音工具（与 legacy 版逻辑一致）
export function escHtml(s) {
  if (s === null || s === undefined || s === '') return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
export function escAttr(s) { return escHtml(s); }

export function stripMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/[*_~`#]{1,3}/g, '')
    .replace(/---+/g, '')
    .replace(/\n{2,}/g, ' ')
    .replace(/^\s*[-*+]\s/gm, '')
    .replace(/^\s*\d+\.\s/gm, '')
    .trim();
}

// DB 里的 ruby HTML → 漢字[かんじ] 括号格式
export function rubyToBrackets(html) {
  if (!html) return '';
  return html.replace(/<ruby[^>]*>(.*?)<rt>(.*?)<\/rt><\/ruby>/g, '$1[$2]').replace(/<[^>]+>/g, '').trim();
}

// ===== 注音：读音按比例拆到每个汉字，逐字原生 ruby =====
const SMALL_KANA = 'ぁぃぅぇぉっゃゅょゎァィゥェォッャュョ';
const KANJI_RE = /[\u3400-\u4dbf\u4e00-\u9fff々]/;

export function distributeReading(base, reading) {
  const chars = [...base];
  let r = [...reading];
  const isKanji = chars.map(c => KANJI_RE.test(c));
  const n = isKanji.filter(Boolean).length;
  if (!n || r.length === 0) return chars.map(c => ({ char: c, rt: '' }));

  // 剪尾部假名：取尾部假名 run 中紧邻汉字的前 k 个，与读音末尾做最长匹配
  let tailKana = 0;
  for (let i = chars.length - 1; i >= 0 && !KANJI_RE.test(chars[i]); i--) tailKana++;
  for (let k = tailKana; k >= 1; k--) {
    if (k < r.length &&
        chars.slice(chars.length - tailKana, chars.length - tailKana + k).join('') === r.slice(-k).join('')) {
      r = r.slice(0, r.length - k);
      break;
    }
  }
  // 剪头部假名
  let headKana = 0;
  for (let i = 0; i < chars.length && !KANJI_RE.test(chars[i]); i++) headKana++;
  for (let k = headKana; k >= 1; k--) {
    if (k < r.length &&
        chars.slice(headKana - k, headKana).join('') === r.slice(0, k).join('')) {
      r = r.slice(k);
      break;
    }
  }

  const m = r.length;
  if (m === 0) return chars.map(c => ({ char: c, rt: '' }));
  const perKanji = [];
  let prev = 0;
  for (let k = 1; k <= n; k++) {
    let b = k === n ? m : Math.round(m * k / n);
    while (b < m && b > prev && SMALL_KANA.includes(r[b])) b--;
    if (b <= prev) b = Math.min(prev + 1, m);
    perKanji.push(r.slice(prev, b).join(''));
    prev = b;
  }
  let ki = 0;
  return chars.map(c => KANJI_RE.test(c)
    ? { char: c, rt: perKanji[ki++] || '' }
    : { char: c, rt: '' });
}

// 漢字[かんじ] → 逐字 <ruby>
export function bracketsToRuby(text) {
  if (!text) return '';
  return text.replace(/([^\]]+?)\[([^\]]+)\]/g, (m, base, reading) =>
    distributeReading(base, reading).map(({ char, rt }) =>
      rt ? `<ruby>${escHtml(char)}<rt>${escHtml(rt)}</rt></ruby>` : escHtml(char)
    ).join('')
  );
}

// 带注音的句子 HTML
export function renderContentWithRuby(content, ruby) {
  if (!ruby) return escHtml(content);
  return bracketsToRuby(escHtml(ruby));
}

// 从 DOM 元素取正文（去掉 rt 注音），用于朗读/查词
export function cleanRubyText(el) {
  const clone = el.cloneNode(true);
  clone.querySelectorAll('rt, .rt').forEach(rt => rt.remove());
  return clone.textContent.replace(/[\s\n]+/g, ' ').trim();
}

// <lang code="xx">...</lang> 预处理为 markdown 友好的 div
export function preprocessLangBlocks(aiText) {
  return (aiText || '').replace(/<lang\s+code="([^"]*)">([\s\S]*?)<\/lang>/gi, (_, code, text) => {
    return `\n<div class="lang-block" data-lang="${code}">${text.trim()}</div>\n`;
  });
}
