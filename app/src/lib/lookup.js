// 分词查词（kuromoji 优先，TinySegmenter 降级，最后按标点切分）
import './vendor-kuromoji.js';
import TinySegmenter from './vendor-tiny-segmenter.js';

let tokenizer = null;
let tokenizerFailed = false;
let notified = false;

// kuromoji 词典在 CDN，弱网/离线会失败：超时或报错后降级 TinySegmenter，
// 并通过 onDegraded 通知调用方给出可见提示（避免静默降级，用户无感知地损失分词质量）
export function initTokenizer(onDegraded) {
  if (tokenizer || tokenizerFailed) return Promise.resolve(tokenizer);
  if (!window.kuromoji) {
    tokenizerFailed = true;
    if (onDegraded && !notified) { notified = true; onDegraded(new Error('kuromoji unavailable')); }
    return Promise.resolve(null);
  }
  const build = new Promise((resolve, reject) => {
    window.kuromoji.builder({ dicPath: 'https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict/' }).build((err, t) => {
      if (err) reject(err); else resolve(t);
    });
  });
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('dict load timeout')), 15000));
  return Promise.race([build, timeout])
    .then(t => { tokenizer = t; return t; })
    .catch(e => {
      tokenizerFailed = true;
      if (onDegraded && !notified) { notified = true; onDegraded(e); }
      return null;
    });
}

const PUNCT_RE = /^[、。，．！？\s　.,!?\n「」『』（）]+$/;

export function tokenize(sentence) {
  if (!sentence) return [];
  if (tokenizer) {
    return tokenizer.tokenize(sentence)
      .filter(t => t.pos !== '助詞' && t.pos !== '助動詞' && t.pos !== '記号' && t.surface_form.length >= 1)
      .map(t => {
        const base = t.basic_form !== '*' && t.basic_form !== t.surface_form ? t.basic_form : null;
        return { word: t.surface_form, base };
      });
  }
  const seg = new TinySegmenter();
  return seg.segment(sentence)
    .filter(w => w.length >= 1 && !PUNCT_RE.test(w))
    .map(w => ({ word: w, base: null }));
}

export function simpleSplit(sentence) {
  return [...new Set(sentence.split(/[\s.,!?;:'"()\[\]{}、。，．！？「」]+/).filter(w => w.length > 1))].slice(0, 20);
}

// 词典链接
export function dictLinks(word) {
  const enc = encodeURIComponent(word);
  return [
    { label: 'Jisho', icon: 'menu_book', href: `https://jisho.org/search/${enc}` },
    { label: 'OJAD', icon: 'graphic_eq', href: `http://www.gavo.t.u-tokyo.ac.jp/ojad/search/index/word:${enc}` },
  ];
}

export function dictLinksEn(word) {
  const enc = encodeURIComponent(word);
  return [
    { label: 'MW', icon: 'menu_book', href: `https://www.merriam-webster.com/dictionary/${enc}` },
    { label: '剑桥', icon: 'translate', href: `https://dictionary.cambridge.org/dictionary/english/${enc}` },
    { label: 'YouGlish', icon: 'graphic_eq', href: `https://youglish.com/pronounce/${enc}/english` },
  ];
}
