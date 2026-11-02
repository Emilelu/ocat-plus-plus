// 语音播放控制器（数据驱动播放列表，跨页循环/随机）
import { store } from './store.js';

export function langToBcp47(lang) {
  return lang === 'ja' ? 'ja-JP' : lang === 'en' ? 'en-US' : lang === 'zh' ? 'zh-CN' : (lang || 'ja-JP');
}

export function createSpeech({ playlistRef, onSpeakItem }) {
  const st = {
    playing: false,
    index: -1,
    mode: store.get('mode', 'loop') === 'shuffle' ? 'shuffle' : 'loop',
    rate: parseFloat(store.get('rate', '1.25')) || 1.25,
    voiceURI: store.get('voice', ''),
  };
  let voices = [];
  let shuffleRecent = [];

  const loadVoices = () => { voices = window.speechSynthesis?.getVoices() || []; };
  if ('speechSynthesis' in window) {
    window.speechSynthesis.onvoiceschanged = loadVoices;
    loadVoices();
  }

  const getVoices = () => voices;
  function langPrefix(lang) {
    return lang === 'ja' ? 'ja' : lang === 'en' ? 'en' : lang === 'zh' ? 'zh' : (lang || 'ja');
  }
  function voiceFor(lang) {
    const prefix = langPrefix(lang);
    // 手动指定的音色仅在语言与当前句子一致时使用；否则回退到按语言前缀匹配，
    // 避免「英文音色读日语」导致 voice.lang 与 utterance.lang 不匹配而无声。
    if (st.voiceURI) {
      const v = voices.find(v => v.voiceURI === st.voiceURI);
      if (v && v.lang.toLowerCase().startsWith(prefix)) return v;
    }
    return voices.find(v => v.lang && v.lang.toLowerCase().startsWith(prefix)) || null;
  }

  function pickShuffle(n) {
    if (n <= 1) return 0;
    let idx, guard = 0;
    do { idx = Math.floor(Math.random() * n); } while (shuffleRecent.includes(idx) && guard++ < 50);
    shuffleRecent.push(idx);
    const keep = Math.min(n - 1, 10);
    while (shuffleRecent.length > keep) shuffleRecent.shift();
    return idx;
  }

  function wrap(i) {
    const n = playlistRef.current.length;
    return n ? ((i % n) + n) % n : -1;
  }

  function speakAt(i) {
    const list = playlistRef.current;
    if (!('speechSynthesis' in window)) return;
    const idx = wrap(i);
    if (idx < 0 || !list[idx]) { st.playing = false; onSpeakItem(); return; }
    st.index = idx;
    const item = list[idx];
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(item.content);
    u.lang = langToBcp47(item.lang);
    const voice = voiceFor(item.lang);
    if (voice) u.voice = voice;
    u.rate = st.rate;
    u.onend = () => {
      if (!st.playing) return;
      const n = playlistRef.current.length;
      if (!n) { st.playing = false; onSpeakItem(); return; }
      const next = st.mode === 'shuffle' ? pickShuffle(n) : st.index + 1;
      speakAt(next);
    };
    synth.speak(u);
    onSpeakItem(item, st.index);
  }

  return {
    state: st,
    getVoices,
    rebuildShuffle() { shuffleRecent = []; },
    setMode(mode) { st.mode = mode; store.set('mode', mode); shuffleRecent = []; },
    setRate(rate) { st.rate = rate; store.set('rate', rate); },
    setVoice(uri) { st.voiceURI = uri; store.set('voice', uri); },
    /** 播放中换音色：从当前句继续 */
    reapplyVoice() {
      if (st.playing && !window.speechSynthesis.paused) {
        window.speechSynthesis.cancel();
        speakAt(st.index);
      }
    },
    /** 播放过滤条件变化后重定位到同一句 */
    relocate(sid, fallbackIdx) {
      const list = playlistRef.current;
      if (!list.length) return;
      let idx = sid != null ? list.findIndex(it => String(it.sid) === String(sid)) : -1;
      st.index = idx >= 0 ? idx : Math.min(Math.max(fallbackIdx, 0), list.length - 1);
      onSpeakItem(list[st.index], st.index);
    },
    play(from = st.index) {
      const n = playlistRef.current.length;
      if (!n) return false;
      st.playing = true;
      speakAt(from < 0 || from >= n ? 0 : from);
      return true;
    },
    toggle() {
      const synth = window.speechSynthesis;
      if (!synth) return;
      if (synth.paused) { synth.resume(); st.playing = true; onSpeakItem(); return; }
      if (st.playing) { synth.pause(); st.playing = false; onSpeakItem(); return; }
      this.play(st.index);
    },
    stop() {
      window.speechSynthesis?.cancel();
      st.playing = false;
      onSpeakItem();
    },
    next() {
      const n = playlistRef.current.length;
      if (!n) return;
      st.playing = true;
      speakAt(st.mode === 'shuffle' ? pickShuffle(n) : st.index + 1);
    },
    prev() {
      const n = playlistRef.current.length;
      if (!n) return;
      st.playing = true;
      speakAt(st.mode === 'shuffle' ? pickShuffle(n) : st.index - 1);
    },
    /** 跳到播放列表中的某一项（播放中点句子） */
    jumpTo(index) {
      if (index < 0) return;
      st.playing = true;
      speakAt(index);
    },
    /** 🔊 停止状态：只读这一句（不推进列表） */
    speakOnce(item) {
      if (!('speechSynthesis' in window) || !item) return;
      const synth = window.speechSynthesis;
      synth.cancel();
      if (playlistRef.current.length) {
        const i = playlistRef.current.findIndex(it => String(it.sid) === String(item.sid));
        if (i >= 0) st.index = i;   // 之后按播放/空格从这句接续
      }
      const u = new SpeechSynthesisUtterance(item.content);
      u.lang = langToBcp47(item.lang);
      const voice = voiceFor(item.lang);
      if (voice) u.voice = voice;
      u.rate = st.rate;
      synth.speak(u);
      onSpeakItem(null, st.index);
    },
    reset() {
      st.playing = false; st.index = -1; shuffleRecent = [];
      onSpeakItem();
    },
  };
}
