import React, { useState, useRef, useMemo, useEffect, useCallback, useDeferredValue } from 'react';
import { marked } from 'marked';

import { store } from './lib/store.js';
import {
  parseDb, loadAllData, allConvs, findConvAnywhere, cacheData, loadCached,
  toggleMasteredDb, syncFromPhoneApi,
} from './lib/db.js';
import { escHtml, escAttr, stripMarkdown, renderContentWithRuby, cleanRubyText, preprocessLangBlocks } from './lib/text.js';
import { createSpeech } from './lib/speech.js';
import { getHue, applyPalette, randomHue } from './lib/palette.js';
import { initTokenizer, tokenize, simpleSplit, dictLinks, dictLinksEn } from './lib/lookup.js';
import {
  dateStamp, exportFileBase, getSelectedSentences,
  buildAnkiCsv, buildCsv, buildTxt, buildConvAnkiCsv, downloadFile,
} from './lib/export.js';

marked.setOptions({ breaks: true, gfm: true });

const PAGE_SIZES = [25, 50, 100, 200];

function matchSentence(s, conv, keyword, field) {
  if (field === 'all') return (s.content + s.translation + conv.userQuestion + conv.aiAnswer).toLowerCase().includes(keyword);
  if (field === 'content') return s.content.toLowerCase().includes(keyword);
  if (field === 'translation') return s.translation.toLowerCase().includes(keyword);
  if (field === 'question') return conv.userQuestion.toLowerCase().includes(keyword);
  if (field === 'answer') return conv.aiAnswer.toLowerCase().includes(keyword);
  return false;
}

export default function App() {
  // ===== 数据 =====
  const dataRef = useRef([]);
  const [dataVersion, setDataVersion] = useState(0);
  const bumpData = () => setDataVersion(v => v + 1);
  const dbRef = useRef(null);
  const [dbReady, setDbReady] = useState(false);       // 内存 db 是否可用（缓存或文件）
  const [dbFileName, setDbFileName] = useState('OCAT.db');
  const [dbDirty, setDbDirty] = useState(false);
  const [dbChipExtra, setDbChipExtra] = useState('');   // 「26分钟前」等
  const masteredCacheTimer = useRef(null);

  // ===== 视图 =====
  const [curColIdx, setCurColIdx] = useState(-1);
  const [searchKw, setSearchKw] = useState('');
  const [searchField, setSearchField] = useState('all');
  const [searchScope, setSearchScope] = useState('current');
  const deferredKw = useDeferredValue(searchKw);
  const [filterMastered, setFilterMastered] = useState(false);
  const [filterHasTags, setFilterHasTags] = useState(false);
  const [selConvs, setSelConvs] = useState(() => new Set());
  const [selSens, setSelSens] = useState(() => new Set());
  const [expanded, setExpanded] = useState(() => new Set());
  const [collapsedSecs, setCollapsedSecs] = useState(() => new Set());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(() => parseInt(store.get('pagesize', '50'), 10) || 50);
  const [navSearch, setNavSearch] = useState('');
  const [navW, setNavW] = useState(() => parseInt(store.get('navw', '0'), 10) || 120);

  // ===== 播放 =====
  const [playingIdx, setPlayingIdx] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const playlistRef = useRef([]);
  const [voicesVersion, setVoicesVersion] = useState(0);

  // ===== 外观 / 其他 =====
  const [theme, setTheme] = useState(() => store.get('theme', '') || '');
  const [skin, setSkin] = useState(() => store.get('skin', '') === 'glass' ? 'glass' : 'material');
  const [zoom, setZoomState] = useState(() => parseFloat(store.get('zoom', '')) || (screen.width >= 3000 ? 1.25 : 1));
  const [hue, setHueState] = useState(() => getHue());
  const [snack, setSnack] = useState(null);
  const [modal, setModal] = useState(null);   // {type:'conv'|'lookup'|'import'|'synchelp', ...}
  const [modalClosing, setModalClosing] = useState(false);
  const [backTop, setBackTop] = useState(false);
  const snackTimer = useRef(null);
  const convListRef = useRef(null);
  const searchInputRef = useRef(null);

  const showSnack = useCallback((msg, success) => {
    setSnack({ msg, success: !!success });
    clearTimeout(snackTimer.current);
    snackTimer.current = setTimeout(() => setSnack(null), 2500);
  }, []);

  const setDbChip = useCallback((loaded, extra) => {
    setDbReady(loaded);
    setDbChipExtra(extra || '');
  }, []);

  // ===== 语音控制器 =====
  const speechRef = useRef(null);
  if (!speechRef.current) {
    speechRef.current = createSpeech({
      playlistRef,
      onSpeakItem: (item, index) => {
        setPlayingIdx(index);
        setPlaying(speechRef.current.state.playing);
        setPaused(window.speechSynthesis ? window.speechSynthesis.paused : false);
        // 自动翻页 + 自动展开（item 仅在朗读某句时传入）
        if (item) {
          if (item.page !== pageRef.current) setPage(item.page);
          if (item.convId && !expandedRef.current.has(item.convId)) {
            setExpanded(prev => { const n = new Set(prev); n.add(item.convId); return n; });
          }
          if (item.secId != null && collapsedSecsRef.current.has(item.secId)) {
            setCollapsedSecs(prev => { const n = new Set(prev); n.delete(item.secId); return n; });
          }
        }
      },
    });
  }
  const speech = speechRef.current;
  const expandedRef = useRef(expanded); expandedRef.current = expanded;
  const collapsedSecsRef = useRef(collapsedSecs); collapsedSecsRef.current = collapsedSecs;
  const pageRef = useRef(page); pageRef.current = page;

  // ===== 外观副作用 =====
  useEffect(() => {
    const html = document.documentElement;
    if (theme) html.setAttribute('data-theme', theme); else html.removeAttribute('data-theme');
    store.set('theme', theme);
  }, [theme]);
  useEffect(() => {
    const html = document.documentElement;
    if (skin === 'glass') html.setAttribute('data-skin', 'glass'); else html.removeAttribute('data-skin');
    store.set('skin', skin);
  }, [skin]);
  useEffect(() => {
    const html = document.documentElement;
    html.style.zoom = zoom === 1 ? '' : String(zoom);
    document.body.style.height = zoom === 1 ? '' : (100 / zoom) + 'vh';
    html.style.setProperty('--ui-z', String(zoom));
    store.set('zoom', zoom);
  }, [zoom]);
  useEffect(() => { applyPalette(hue); }, [hue]);

  // ===== 启动：缓存 → 数据 + 重建内存 db =====
  useEffect(() => {
    (async () => {
      initTokenizer();
      const cached = await loadCached();
      if (cached && cached.data && cached.data.length) {
        dataRef.current = cached.data;
        bumpData();
        setDbDirty(!!cached.dirty);
        const name = cached.name || 'OCAT.db';
        setDbFileName(name);
        const age = Math.round((Date.now() - cached.time) / 60000);
        setDbChip(true, ` (${age}分钟前)`);
        if (cached.raw) {
          try {
            dbRef.current = await parseDb(cached.raw);
            setDbReady(true);
          } catch (e) { console.warn('缓存数据库重建失败', e); }
        }
      }
    })();
  }, []);

  const loadFromBuffer = useCallback(async (buf, name) => {
    dbRef.current = await parseDb(buf);
    const data = loadAllData(dbRef.current);
    dataRef.current = data;
    bumpData();
    setDbDirty(false);
    setDbFileName(name || 'OCAT.db');
    setDbChip(true, '');
    showSnack('数据库加载成功', true);
    await cacheData(data, dbRef.current, name || 'OCAT.db', false);
  }, [showSnack, setDbChip]);

  const openDatabase = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.db,.sqlite,.sqlite3';
    input.onchange = async e => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        await loadFromBuffer(await file.arrayBuffer(), file.name);
      } catch (err) { showSnack('加载失败: ' + err.message); }
    };
    input.click();
  }, [loadFromBuffer, showSnack]);

  const clearCache = useCallback(async () => {
    speech.stop();
    await new Promise(res => { const req = indexedDB.open('ocat_cache', 1); req.onsuccess = () => { req.result.close(); indexedDB.deleteDatabase('ocat_cache'); res(); }; });
    dataRef.current = []; bumpData();
    dbRef.current = null;
    setDbDirty(false); setDbFileName('OCAT.db');
    setDbChip(false, '');
    setCurColIdx(-1); setCrossResults(null); setSelConvs(new Set()); setSelSens(new Set());
    setExpanded(new Set()); setCollapsedSecs(new Set()); setPage(1);
    speech.reset();
    showSnack('缓存已清除，请重新选择数据库');
  }, [speech, showSnack, setDbChip]);

  // ===== 选择收藏夹 =====
  const selectCollection = useCallback((idx) => {
    setCurColIdx(idx);
    setCrossResults(null);
    setSearchKw(''); setSearchScope('current');
    setSelConvs(new Set()); setSelSens(new Set());
    setExpanded(new Set()); setCollapsedSecs(new Set());
    setPage(1); setPlayingIdx(-1);
    speech.stop(); speech.reset();
    const col = dataRef.current[idx];
    if (col) {
      const conds = new Set();
      allConvs(col).forEach((conv, i) => {
        if (i === 0 || !conv.userQuestion || conv.sentences.some(s => s.tags)) conds.add(conv.messageId);
      });
      setExpanded(conds);
      if (col.hasSections && col.sections) {
        const colSecs = new Set();
        col.sections.forEach((s, i) => { if (i > 0) colSecs.add('sec-' + i); });
        setCollapsedSecs(colSecs);
      }
    }
  }, [speech]);

  // ===== 搜索 / 过滤 =====
  const [crossResults, setCrossResults] = useState(null);

  useEffect(() => {
    const kw = deferredKw.toLowerCase().trim();
    if (searchScope === 'all' && kw) {
      const results = [];
      for (const col of dataRef.current) {
        for (const conv of allConvs(col)) {
          for (const s of conv.sentences) {
            if (s.type === 'section') continue;
            if (matchSentence(s, conv, kw, searchField)) {
              const key = `${col.id}|${conv.messageId}`;
              const existing = results.find(r => r.key === key);
              if (existing) existing.conv.sentences.push(s);
              else results.push({ key, collection: col, conv: { ...conv, sentences: [s] } });
            }
          }
        }
      }
      setCrossResults(results);
    } else {
      setCrossResults(null);
    }
  }, [deferredKw, searchScope, searchField]);

  // 过滤后的当前视图
  const view = useMemo(() => {
    const kw = deferredKw.toLowerCase().trim();
    if (crossResults) {
      return {
        title: '跨收藏夹搜索',
        cross: true,
        convs: crossResults.slice(0, 300),
        sections: null,
        capped: crossResults.length > 300,
      };
    }
    const col = dataRef.current[curColIdx];
    if (!col) return { title: '请选择数据库文件', cross: false, convs: [], sections: null };
    const convs = allConvs(col);
    let filtered = [];
    for (const conv of convs) {
      let sentences = conv.sentences.filter(s => s.type !== 'section');
      if (filterMastered) sentences = sentences.filter(s => s.isMastered);
      if (filterHasTags) sentences = sentences.filter(s => s.tags);
      if (kw) sentences = sentences.filter(s => matchSentence(s, conv, kw, searchField));
      if (sentences.length > 0) filtered.push({ ...conv, sentences });
    }
    if (col.hasSections && col.sections) {
      return { title: col.title, cross: false, convs: filtered, sections: col.sections, col };
    }
    return { title: col.title, cross: false, convs: filtered, sections: null, col };
  }, [dataVersion, curColIdx, crossResults, deferredKw, searchField, filterMastered, filterHasTags]);

  // 分栏视图时按 sec 分组 filtered convs
  const sectioned = useMemo(() => {
    if (!view.sections) return null;
    const indexOf = new Map(view.convs.map(c => [c.messageId, c]));
    return view.sections.map((sec, si) => ({
      si,
      title: sec.title,
      conversations: sec.conversations.map(c => indexOf.get(c.messageId)).filter(Boolean),
    })).filter(sec => true);
  }, [view]);

  // flatItems（与 legacy 相同：分栏头也占页宽）
  const flatItems = useMemo(() => {
    const items = [];
    if (view.cross) {
      view.convs.forEach(r => items.push({ type: 'conv', conv: r.conv, col: r.collection }));
    } else if (sectioned) {
      sectioned.forEach(sec => {
        items.push({ type: 'section', si: sec.si, title: sec.title, secId: 'sec-' + sec.si, convs: sec.conversations });
        sec.conversations.forEach(c => items.push({ type: 'conv', conv: c, secId: 'sec-' + sec.si }));
      });
    } else {
      view.convs.forEach(c => items.push({ type: 'conv', conv: c }));
    }
    return items;
  }, [view, sectioned]);

  const totalPages = Math.max(1, Math.ceil(flatItems.length / pageSize));
  const safePage = Math.min(page, totalPages);
  useEffect(() => { if (page !== safePage) setPage(safePage); }, [page, safePage]);

  // 播放列表：与分页页码对齐
  useMemo(() => {
    const list = [];
    const totalPages2 = Math.ceil(flatItems.length / pageSize) || 1;
    for (let p = 1; p <= totalPages2; p++) {
      const start = (p - 1) * pageSize;
      const end = Math.min(start + pageSize, flatItems.length);
      let row = 0;
      for (let i = start; i < end; i++) {
        const it = flatItems[i];
        if (it.type !== 'conv') continue;
        for (const s of it.conv.sentences) {
          if (s.type === 'section') continue;
          list.push({ sid: s.id, content: s.content || '', lang: s.lang || 'ja', page: p, row: row++, convId: it.conv.messageId, secId: it.secId ?? null });
        }
      }
    }
    playlistRef.current = list;
  }, [flatItems, pageSize]);

  const playlist = playlistRef.current;

  // 播放中过滤条件变化 → 重定位
  useEffect(() => {
    if (playing) {
      const cur = playlist[playingIdx];
      speech.relocate(cur?.sid ?? null, playingIdx);
    }
  }, [playlist]);

  // ===== 选择操作 =====
  const toggleConvSelect = useCallback((mid, checked) => {
    const conv = findConvAnywhere(dataRef.current, mid);
    setSelConvs(prev => { const n = new Set(prev); checked ? n.add(mid) : n.delete(mid); return n; });
    if (conv) {
      setSelSens(prev => {
        const n = new Set(prev);
        conv.sentences.forEach(s => { if (s.type !== 'section') checked ? n.add(s.id) : n.delete(s.id); });
        return n;
      });
    }
  }, []);

  const toggleSentenceSel = useCallback((sid, checked) => {
    setSelSens(prev => { const n = new Set(prev); checked ? n.add(sid) : n.delete(sid); return n; });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (view.cross) {
      const results = crossResults || [];
      const allSelected = results.length > 0 && results.every(r => selConvs.has(r.conv.messageId));
      if (allSelected) { setSelConvs(new Set()); setSelSens(new Set()); return; }
      const nc = new Set(selConvs), ns = new Set(selSens);
      results.forEach(r => {
        nc.add(r.conv.messageId);
        const orig = findConvAnywhere(dataRef.current, r.conv.messageId);
        if (orig) orig.sentences.forEach(s => { if (s.type !== 'section') ns.add(s.id); });
      });
      setSelConvs(nc); setSelSens(ns);
    } else {
      const col = dataRef.current[curColIdx];
      const convs = col ? allConvs(col) : [];
      if (convs.length && selConvs.size >= convs.length) { setSelConvs(new Set()); setSelSens(new Set()); return; }
      const nc = new Set(selConvs), ns = new Set(selSens);
      convs.forEach(c => {
        nc.add(c.messageId);
        c.sentences.forEach(s => { if (s.type !== 'section') ns.add(s.id); });
      });
      setSelConvs(nc); setSelSens(ns);
    }
  }, [view, crossResults, selConvs, selSens, curColIdx]);

  const deselectAll = useCallback(() => { setSelConvs(new Set()); setSelSens(new Set()); }, []);

  // 导出计数（与实际导出一致）
  const exportCount = useMemo(
    () => getSelectedSentences(dataRef.current, dataRef.current[curColIdx], !!crossResults, selConvs, selSens).length,
    [dataVersion, curColIdx, crossResults, selConvs, selSens]
  );

  // ===== 导出 =====
  const doExport = useCallback((kind) => {
    const sentences = getSelectedSentences(dataRef.current, dataRef.current[curColIdx], !!crossResults, selConvs, selSens);
    if (!sentences.length) { showSnack('请先选择要导出的句子'); return; }
    const base = exportFileBase(!!crossResults, dataRef.current[curColIdx]?.title);
    if (kind === 'anki') downloadFile(buildAnkiCsv(sentences), `${base}_anki_${dateStamp()}.csv`, 'text/csv;charset=utf-8');
    if (kind === 'csv') downloadFile(buildCsv(sentences), `${base}_${dateStamp()}.csv`, 'text/csv;charset=utf-8');
    if (kind === 'txt') downloadFile(buildTxt(sentences), `${base}_${dateStamp()}.txt`, 'text/plain;charset=utf-8');
    showSnack(`已导出 ${sentences.length} 条`, true);
  }, [crossResults, selConvs, selSens, curColIdx, showSnack]);

  // ===== 保存 / 导入 / 同步 =====
  const saveDatabase = useCallback(async () => {
    if (!dbRef.current) { showSnack('请先加载一个数据库'); return; }
    const data = dbRef.current.export();
    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: dbFileName || 'OCAT.db',
          types: [{ description: 'SQLite 数据库', accept: { 'application/octet-stream': ['.db'] } }],
        });
        const w = await handle.createWritable();
        await w.write(data); await w.close();
        setDbDirty(false);
        showSnack('已保存到 ' + handle.name, true);
        await cacheData(dataRef.current, dbRef.current, dbFileName, false);
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return;
      }
    }
    const blob = new Blob([data], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = dbFileName || 'OCAT.db';
    a.click(); URL.revokeObjectURL(url);
    setDbDirty(false);
    showSnack('数据库已导出，请替换原文件', true);
    await cacheData(dataRef.current, dbRef.current, dbFileName, false);
  }, [dbFileName, showSnack]);

  const openImportDialog = useCallback(async () => {
    if (!dbRef.current) { showSnack('请先加载一个数据库'); return; }
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.db';
    input.onchange = async e => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const srcDb = await parseDb(await file.arrayBuffer());
        const stmt = srcDb.prepare(`SELECT id, title, lang, translationLang, summary FROM CollectionList WHERE deleted = 0 ORDER BY \`index\``);
        const rows = [];
        while (stmt.step()) rows.push(stmt.getAsObject());
        stmt.free();
        if (!rows.length) { showSnack('源数据库中没有收藏夹'); return; }
        setModal({ type: 'import', rows, srcDb, fileName: file.name });
      } catch (err) { showSnack('读取失败: ' + err.message); }
    };
    input.click();
  }, [showSnack]);

  const importSelected = useCallback(async (srcDb, fileName) => {
    const checkboxes = [...document.querySelectorAll('#modalBody input[type=checkbox]:checked')];
    const ids = checkboxes.map(cb => cb.dataset.id);
    if (!ids.length) { showSnack('请选择至少一个收藏夹'); return; }
    closeModal();
    const db = dbRef.current;
    let imported = 0, skipped = 0;
    db.run('BEGIN TRANSACTION');
    try {
      for (const colId of ids) {
        const existing = db.exec(`SELECT id FROM CollectionList WHERE id = '${colId}'`);
        if (existing.length && existing[0].values.length) { skipped++; continue; }
        const copyRows = (srcDb, table, where) => {
          const stmt = srcDb.prepare(`SELECT * FROM ${table}${where ? ' WHERE ' + where : ''}`);
          const cols = stmt.getColumnNames();
          while (stmt.step()) {
            const vals = stmt.get();
            const colList = cols.map(c => `\`${c}\``).join(',');
            const ph = cols.map(() => '?').join(',');
            db.run(`INSERT OR IGNORE INTO ${table} (${colList}) VALUES (${ph})`, vals);
          }
          stmt.free();
        };
        copyRows(srcDb, 'CollectionList', `id = '${colId}'`);
        copyRows(srcDb, 'Collection', `collectionListId = '${colId}' AND deleted = 0`);
        copyRows(srcDb, 'LocalMessage', `id IN (SELECT messageId FROM Collection WHERE collectionListId = '${colId}' AND messageId IS NOT NULL)`);
        imported++;
      }
      db.run('COMMIT');
    } catch (e) {
      db.run('ROLLBACK');
      showSnack('导入失败: ' + e.message);
      return;
    }
    const data = loadAllData(db);
    dataRef.current = data; bumpData();
    setDbDirty(true);
    showSnack(`成功导入 ${imported} 个收藏夹` + (skipped ? `，${skipped} 个已存在跳过` : '') + (imported ? '，记得点击保存' : ''), imported > 0);
    clearTimeout(masteredCacheTimer.current);
    masteredCacheTimer.current = setTimeout(() => cacheData(data, db, dbFileName, true), 1000);
  }, [dbFileName, showSnack]);

  const syncFromPhone = useCallback(async () => {
    setDbChip(true, dbChipExtra);
    try {
      const buf = await syncFromPhoneApi();
      await loadFromBuffer(buf, 'OCAT.db');
      showSnack('已从手机同步最新数据库', true);
    } catch (e) {
      if (e.name === 'TypeError' || e.name === 'AbortError') setModal({ type: 'synchelp' });
      else showSnack('同步失败: ' + e.message);
    }
  }, [loadFromBuffer, showSnack, setDbChip, dbChipExtra]);

  // ===== 标记已掌握 =====
  const toggleMastered = useCallback((sid) => {
    if (!dbRef.current) { showSnack('请先加载数据库'); return; }
    let item = null;
    outer:
    for (const col of dataRef.current) {
      for (const conv of allConvs(col)) {
        for (const s of conv.sentences) {
          if (String(s.id) === String(sid)) { item = s; break outer; }
        }
      }
    }
    if (!item) return;
    const newVal = item.isMastered ? 0 : 1;
    try { toggleMasteredDb(dbRef.current, sid, newVal); } catch (err) { showSnack('写入失败: ' + err.message); return; }
    item.isMastered = !!newVal;
    bumpData();
    setDbDirty(true);
    showSnack(newVal ? '已标记为已掌握，记得保存' : '已取消掌握', true);
    clearTimeout(masteredCacheTimer.current);
    masteredCacheTimer.current = setTimeout(() => cacheData(dataRef.current, dbRef.current, dbFileName, true), 3000);
  }, [dbFileName, showSnack]);

  // ===== 播放操作 =====
  const onRowClick = useCallback((sentence) => {
    if (!speech.state.playing) return;   // 非播放状态点句子不动作（方便划选取词）
    if (window.getSelection()?.toString().trim()) return;
    const idx = playlist.findIndex(it => String(it.sid) === String(sentence.id));
    if (idx >= 0) speech.jumpTo(idx);
  }, [speech, playlist]);

  const onSpeakOnce = useCallback((sentence) => {
    if (speech.state.playing) {
      const idx = playlist.findIndex(it => String(it.sid) === String(sentence.id));
      speech.jumpTo(idx);
    } else {
      speech.speakOnce({ sid: sentence.id, content: sentence.content, lang: sentence.lang || 'ja' });
      setPlayingIdx(speech.state.index);
    }
  }, [speech, playlist]);

  // ===== 模态框 =====
  const closeModal = useCallback(() => {
    setModalClosing(true);
    setTimeout(() => { setModal(null); setModalClosing(false); }, 170);
  }, []);

  const viewConv = useCallback((mid) => {
    const conv = findConvAnywhere(dataRef.current, mid);
    if (conv) setModal({ type: 'conv', conv });
  }, []);

  const openLookup = useCallback((sentence) => {
    const isJa = /[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff]/.test(sentence.content || '');
    const words = isJa ? tokenize(sentence.content) : simpleSplit(sentence.content).map(w => ({ word: w, base: null }));
    setModal({ type: 'lookup', words: words.slice(0, 30), jp: isJa });
  }, []);

  const copyConvText = useCallback(async (conv) => {
    const text = (conv.userQuestion ? conv.userQuestion + '\n\n' : '') + (conv.aiAnswer || '');
    try {
      await navigator.clipboard.writeText(text);
      showSnack('已复制全文', true);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); showSnack('已复制全文', true); } catch { showSnack('复制失败，请手动选择复制'); }
      document.body.removeChild(ta);
    }
  }, [showSnack]);

  const exportConvAnki = useCallback((mid) => {
    const conv = findConvAnywhere(dataRef.current, mid);
    if (!conv) return;
    let colName = 'OCAT';
    for (const col of dataRef.current) {
      if (allConvs(col).some(c => c.messageId === mid)) { colName = col.title; break; }
    }
    downloadFile(buildConvAnkiCsv(conv, colName), `ocat_单对话_${dateStamp()}.csv`, 'text/csv;charset=utf-8');
    showSnack('已导出');
  }, [showSnack]);

  // ===== 键盘快捷键 =====
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { closeModal(); return; }
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.ctrlKey && e.key === 'a') { e.preventDefault(); toggleSelectAll(); return; }
      if (document.querySelector('.modal-scrim') && modal) return;
      if (e.key === '/') {
        const si = searchInputRef.current;
        if (si && !si.disabled) { e.preventDefault(); si.focus(); }
      } else if (e.code === 'Space') {
        e.preventDefault(); speech.toggle(); setPlaying(speech.state.playing);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault(); speech.prev(); setPlaying(true);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault(); speech.next(); setPlaying(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [speech, toggleSelectAll, closeModal, modal]);

  // ===== 渲染 =====
  const curCol = dataRef.current[curColIdx];
  const colCount = dataRef.current.length;
  const totalConvs = dataRef.current.reduce((s, c) => s + allConvs(c).length, 0);
  const totalSens = dataRef.current.reduce((s, c) => s + allConvs(c).reduce((t, cv) => t + cv.sentences.length, 0), 0);
  const playingSid = playing && playlist[playingIdx] ? playlist[playingIdx].sid : null;

  const chipText = dbReady ? dbFileName + (dbChipExtra || '') + (dbDirty ? ' · ⚠ 未保存' : '') : '未加载';

  const pageBlocks = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    const slice = flatItems.slice(start, start + pageSize);
    const blocks = [];
    for (const it of slice) {
      if (it.type === 'section') {
        blocks.push({ section: it, convs: [] });
      } else if (blocks.length && blocks[blocks.length - 1].section && !blocks[blocks.length - 1].closed) {
        blocks[blocks.length - 1].convs.push(it);
      } else {
        blocks.push({ section: null, convs: [it] });
      }
    }
    return blocks;
  }, [flatItems, safePage, pageSize]);

  // 测试/调试钩子
  useEffect(() => {
    window.__ocat = {
      loadBuffer: loadFromBuffer,
      selectCollection,
      toggleMastered,
      speech,
      data: () => dataRef.current,
      db: () => dbRef.current,
      info: () => ({
        title: view.title, cross: !!view.cross,
        convCount: view.convs.length,
        senCount: view.convs.reduce((x, c) => x + c.sentences.length, 0),
        secCount: sectioned ? sectioned.length : 0,
        page: safePage, pageSize,
        playlist: playlistRef.current.length,
        selConvs: selConvs.size, selSens: selSens.size,
        exportCount, dbDirty, dbReady: !!dbRef.current,
      }),
    };
  });

  return (
    <>
      {/* 顶栏 */}
      <div className="top-bar">
        <h1 style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
            onClick={() => convListRef.current?.scrollTo({ top: 0 })} title="点击回到顶部">
          <img src="https://writer.drakeet.com/images/orca_dark.png" width="28" height="28" style={{ borderRadius: 4 }} alt="OCAT" />
          OCAT++
        </h1>
        <button className="md-btn md-btn-icon" onClick={() => setTheme(t => t === '' ? 'dark' : t === 'dark' ? 'light' : '')} title={theme === 'dark' ? '深色模式（点击切换）' : theme === 'light' ? '浅色模式（点击恢复跟随系统）' : '跟随系统（点击切换）'}>
          <span className="mi">{theme === 'dark' ? 'light_mode' : theme === 'light' ? 'dark_mode' : 'brightness_auto'}</span>
        </button>
        <button className="md-btn md-btn-icon" onClick={() => setSkin(s => s === 'glass' ? 'material' : 'glass')}
                title={skin === 'glass' ? '当前：液态玻璃（点击切换到 Material）' : '当前：Material（点击切换到液态玻璃）'}>
          <span className="mi">{skin === 'glass' ? 'blur_on' : 'layers'}</span>
        </button>
        <button className="md-btn md-btn-icon" data-pal-btn="1"
                title="随机配色（点击换色，双击恢复默认）"
                onClick={(e) => { const h = randomHue(); setHueState(h); showSnack(`配色 #${h}`, true); }}
                onDoubleClick={() => { setHueState(null); showSnack('已恢复默认配色', true); }}>
          <span className="mi">palette</span>
        </button>
        <select className="md-select" id="zoomSelect" value={String(zoom)} title="界面缩放（大屏幕可调大）"
                onChange={e => setZoomState(parseFloat(e.target.value) || 1)} style={{ height: 36 }}>
          {['1', '1.1', '1.25', '1.5', '1.75'].map(z => <option key={z} value={z}>{Math.round(z * 100)}%</option>)}
        </select>
        <span className={'db-chip' + (dbReady ? ' loaded' : '')} title={dbReady && dbDirty ? '浏览器内的数据包含尚未写回磁盘文件的更改，请点击右上角保存按钮' : ''}>{chipText}</span>
        <button className="md-btn md-btn-filled" onClick={openDatabase}><span className="mi">folder_open</span>选择数据库</button>
        <button className="md-btn md-btn-tonal" onClick={syncFromPhone} title="通过 ADB 从手机同步最新数据库"><span className="mi">sync</span>同步手机</button>
        <span className="stats">{colCount ? `${colCount} 收藏夹 · ${totalConvs} 对话 · ${totalSens} 句` : ''}</span>
        <button className="md-btn md-btn-icon md-btn-outlined" onClick={openImportDialog} title="从其他数据库导入收藏夹"><span className="mi">move_to_inbox</span></button>
        <button className="md-btn md-btn-icon md-btn-outlined" onClick={saveDatabase} title="保存数据库到文件"><span className="mi">save</span></button>
        <button className="md-btn md-btn-icon md-btn-outlined" onClick={clearCache} title="清除缓存重新解析"><span className="mi">refresh</span></button>
      </div>

      {/* 搜索栏 */}
      <div className="search-bar">
        <div className="search-field">
          <span className="mi">search</span>
          <input ref={searchInputRef} type="text" value={searchKw}
                 placeholder="搜索句子、翻译、用户提问、AI回答…（按 / 聚焦）"
                 onChange={e => setSearchKw(e.target.value)} />
        </div>
        <select className="md-select" value={searchField} onChange={e => setSearchField(e.target.value)}>
          <option value="all">全部字段</option>
          <option value="content">日语句子</option>
          <option value="translation">中文翻译</option>
          <option value="question">用户提问</option>
          <option value="answer">AI回答</option>
        </select>
        <select className="md-select" value={searchScope} onChange={e => setSearchScope(e.target.value)}>
          <option value="current">当前收藏夹</option>
          <option value="all">全部收藏夹</option>
        </select>
        <span className="search-hint">{view.cross ? `在 ${colCount} 个收藏夹中找到 ${view.convs.reduce((s, r) => s + r.conv.sentences.length, 0)} 条句子` : (deferredKw ? '找到匹配结果' : '')}</span>
      </div>

      <div className="main">
        {/* 导航栏 */}
        <div className="nav-rail" style={{ width: navW }}>
          <div className="nav-search">
            <div className="nav-search-field">
              <span className="mi">search</span>
              <input type="text" placeholder="搜索收藏夹" value={navSearch}
                     onChange={e => setNavSearch(e.target.value)}
                     onKeyDown={e => { if (e.key === 'Escape') { setNavSearch(''); e.target.blur(); } }} />
            </div>
          </div>
          {dataRef.current.map((col, i) => {
            const totalS = allConvs(col).reduce((t, c) => t + c.sentences.length, 0);
            const langLabel = col.lang === 'ja' ? '日' : col.lang === 'en' ? '英' : col.lang === 'zh' ? '中' : '';
            const langColors = { ja: '#e74c3c', en: '#3498db', zh: '#e67e22' };
            const match = !navSearch.trim() || col.title.toLowerCase().includes(navSearch.toLowerCase());
            return (
              <div key={col.id ?? i} className={'nav-rail-item' + (i === curColIdx ? ' active' : '')}
                   style={match ? {} : { display: 'none' }}
                   data-title={escAttr(col.title)}
                   title={`${col.title} (${totalS} 句)`}
                   onClick={() => selectCollection(i)}>
                <span className="nav-icon" style={{ width: 32, height: 32, borderRadius: '50%', background: langColors[col.lang] || '#8e9099', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 600, flexShrink: 0 }}>
                  {langLabel || <span className="mi" style={{ fontSize: 16 }}>folder</span>}
                </span>
                <span className="nav-label">{col.title}</span>
                {totalS > 99 ? <span className="nav-badge">{totalS > 999 ? '999+' : totalS}</span> : ''}
              </div>
            );
          })}
        </div>
        <div className="nav-rail-resizer" onMouseDown={(e) => {
          const startX = e.clientX, startW = navW;
          const onMove = ev => setNavW(Math.max(60, Math.min(300, startW + ev.clientX - startX)));
          const onUp = () => { store.set('navw', navW); document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); document.body.style.cursor = ''; document.body.style.userSelect = ''; };
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
          document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none';
        }} />

        <div className="content-area">
          <div className="sheet">
            {/* 工具栏 */}
            <div className="toolbar">
              <span className="title">{view.cross ? '跨收藏夹搜索' : view.title}</span>
              <span className="count">{toolbarCount(view, sectioned, pageSize, flatItems, safePage)}</span>
              <span className="spacer" />
              <button className="md-btn md-btn-outlined md-btn-sm" onClick={toggleSelectAll} title="全选当前收藏夹的所有句子（跨收藏夹搜索时为全部搜索结果）">全选</button>
              <button className="md-btn md-btn-text md-btn-sm" onClick={deselectAll} title="清空所有勾选">取消</button>
              <button className="md-btn md-btn-filled md-btn-sm" onClick={() => doExport('anki')} disabled={!exportCount}>
                <span className="mi">file_download</span>{exportCount > 0 ? `Anki (${exportCount})` : 'Anki'}
              </button>
              <button className="md-btn md-btn-outlined md-btn-sm" onClick={() => doExport('csv')} disabled={!exportCount}>CSV</button>
              <button className="md-btn md-btn-text md-btn-sm" onClick={() => doExport('txt')} disabled={!exportCount}>TXT</button>
            </div>

            <div className="filter-chips" style={{ display: curColIdx >= 0 && !view.cross ? 'flex' : 'none' }}>
              <div className={'md-chip' + (filterMastered ? ' selected' : '')} onClick={() => setFilterMastered(v => !v)}>
                <span className="mi chip-icon">check_circle</span> 已掌握
              </div>
              <div className={'md-chip' + (filterHasTags ? ' selected' : '')} onClick={() => setFilterHasTags(v => !v)}>
                <span className="mi chip-icon">label</span> 有标签
              </div>
            </div>

            <div className="section-nav" style={{ display: sectioned && !view.cross ? 'flex' : 'none' }}>
              {(sectioned || []).map((sec, si) => (
                <span key={si} className={'nav-chip' + (activeSection(pageBlocks, sec.si) ? ' active' : '')}
                      onClick={() => jumpToSection(sec.si)}>{sec.title || '(未分类)'}</span>
              ))}
            </div>

            {/* 列表 */}
            <div className="scroll-list" ref={convListRef}
                 onScroll={() => {
                   const show = (convListRef.current?.scrollTop || 0) > 300;
                   if (show !== backTop) setBackTop(show);
                 }}>
              {!dbReady && !dataRef.current.length ? (
                <div className="empty-state">
                  <div className="icon mi">folder_open</div>
                  <div className="title">欢迎使用 OCAT++</div>
                  <div className="desc">点击上方「选择数据库」加载 SQLite DB 文件</div>
                </div>
              ) : flatItems.length === 0 ? (
                <div className="empty-state">
                  <div className="icon mi">search</div>
                  <div className="title">没有匹配的结果</div>
                </div>
              ) : pageBlocks.map((b, bi) => (
                b.section ? (
                  <div key={bi} className={'section-group' + (collapsedSecs.has(b.section.secId) ? ' collapsed' : '')} id={b.section.secId}>
                    <div className="section-group-header" onClick={() => setCollapsedSecs(prev => {
                      const n = new Set(prev); n.has(b.section.secId) ? n.delete(b.section.secId) : n.add(b.section.secId); return n;
                    })}>
                      <span className="section-arrow"><span className="mi" style={{ fontSize: 14 }}>expand_more</span></span>
                      <span className="mi" style={{ fontSize: 16, color: 'var(--md-sys-color-primary)' }}>folder</span>
                      {escHtml(b.section.title || '(未分类)')}
                      <span className="section-count">{b.section.convs.length} 对话 · {b.section.convs.reduce((t, c) => t + c.sentences.length, 0)} 句</span>
                    </div>
                    <div className="section-group-body">
                      {b.convs.map(it => <ConvCard key={it.conv.messageId} conv={it.conv} state={makeState()} />)}
                    </div>
                  </div>
                ) : b.convs.map(it => <ConvCard key={it.conv.messageId} conv={it.conv} state={makeState()} />)
              ))}
              {view.cross && view.capped && <div style={{ padding: 16, textAlign: 'center', color: 'var(--md-sys-color-on-surface-variant)' }}>仅显示前 300 个对话，请缩小搜索范围</div>}
            </div>

            {/* 分页 */}
            {totalPages > 1 && (
              <div className="pagination-bar" id="paginationBar">
                <select className="md-select" style={{ height: 28, fontSize: 12 }} value={String(pageSize)}
                        onChange={e => { const v = parseInt(e.target.value, 10); setPageSizeState(v); store.set('pagesize', v); setPage(1); }}>
                  {PAGE_SIZES.map(n => <option key={n} value={n}>{n}条/页</option>)}
                </select>
                <span className={'pager-btn' + (safePage <= 1 ? ' disabled' : '')} onClick={() => setPage(safePage - 1)} title="上一页"><span className="mi" style={{ fontSize: 18 }}>chevron_left</span></span>
                {pageRange(safePage, totalPages).map((p, i) => p === '...'
                  ? <span key={'e' + i} className="pager-ellipsis">…</span>
                  : <span key={p} className={'pager-btn' + (p === safePage ? ' active' : '')} onClick={() => setPage(p)}>{p}</span>)}
                <span className={'pager-btn' + (safePage >= totalPages ? ' disabled' : '')} onClick={() => setPage(safePage + 1)} title="下一页"><span className="mi" style={{ fontSize: 18 }}>chevron_right</span></span>
                <input type="number" min="1" max={totalPages} placeholder={`${safePage}/${totalPages}`} title="输入页码后回车跳转"
                       style={{ width: 60, height: 28, border: '1px solid var(--md-sys-color-outline)', borderRadius: 6, textAlign: 'center', fontSize: 12 }}
                       onKeyDown={e => { if (e.key === 'Enter') setPage(parseInt(e.target.value, 10) || safePage); }} />
              </div>
            )}

            {/* 播放条 */}
            <div className="playback-bar">
              <span style={{ font: 'var(--md-sys-typescale-label-small)', marginRight: 4 }}>倍速</span>
              <input type="range" min="0.5" max="2.0" step="0.05" value={speech.state.rate}
                     onChange={e => { speech.setRate(parseFloat(e.target.value)); setVoicesVersion(v => v + 1); }}
                     style={{ width: 80, accentColor: 'var(--md-sys-color-primary)' }} />
              <span style={{ font: 'var(--md-sys-typescale-label-small)', minWidth: 36 }}>{speech.state.rate.toFixed(2)}x</span>
              <select value={speech.state.voiceURI} style={{ maxWidth: 140, height: 28, fontSize: 11, border: '1px solid var(--md-sys-color-outline)', borderRadius: 4, background: 'var(--md-sys-color-surface)', color: 'var(--md-sys-color-on-surface)' }}
                      onChange={e => { speech.setVoice(e.target.value); speech.reapplyVoice(); }}>
                <option value="">自动</option>
                {speech.getVoices().map(v => <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>)}
              </select>
              <div style={{ flex: 1 }} />
              <button className="md-btn" onClick={() => { speech.prev(); setPlaying(true); }} title="上一句"><span className="mi">skip_previous</span></button>
              <button className="md-btn pb-play" onClick={() => { speech.toggle(); setPlaying(speech.state.playing); setPaused(window.speechSynthesis?.paused); }} title={paused ? '继续' : playing ? '暂停' : '播放'}>
                <span className="mi">{paused && !playing ? 'play_arrow' : playing ? 'pause' : 'play_arrow'}</span>
              </button>
              <button className="md-btn" onClick={() => { speech.next(); setPlaying(true); }} title="下一句"><span className="mi">skip_next</span></button>
              <button className="md-btn" onClick={() => { speech.stop(); setPlaying(false); setPlayingIdx(-1); }} title="停止"><span className="mi">stop</span></button>
              <button className="md-btn" onClick={() => { speech.setMode(speech.state.mode === 'loop' ? 'shuffle' : 'loop'); setVoicesVersion(v => v + 1); }}
                      title={speech.state.mode === 'loop' ? '列表循环' : '随机播放（跨页、不重复）'}>
                <span className="mi">{speech.state.mode === 'loop' ? 'repeat' : 'shuffle'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 回到顶部 */}
      <button className="back-to-top" style={{ opacity: backTop ? 1 : 0, pointerEvents: backTop ? 'auto' : 'none' }}
              onClick={() => convListRef.current?.scrollTo({ top: 0, behavior: 'smooth' })} title="回到顶部">
        <span className="mi">arrow_upward</span>
      </button>

      {/* 划词弹框 */}
      <SelectionPopup onLookUp={(text) => {
        const isJa = /[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff]/.test(text);
        const words = isJa ? tokenize(text) : simpleSplit(text).map(w => ({ word: w, base: null }));
        setModal({ type: 'lookup', words: words.slice(0, 30), jp: isJa });
      }} />

      {/* 模态框 */}
      {modal && (
        <div className={'modal-scrim' + (modalClosing ? ' closing' : '')} onMouseDown={e => { if (e.target === e.currentTarget) closeModal(); }}>
          <div className="modal-dialog">
            <div className="modal-header">
              <h3>{modalTitles[modal.type] || '详情'}</h3>
              <button className="modal-close" onClick={closeModal} title="关闭 (Esc)"><span className="mi">close</span></button>
            </div>
            <div className="modal-body" id="modalBody">
              {modal.type === 'conv' && <ConvModal conv={modal.conv} onCopy={copyConvText} />}
              {modal.type === 'lookup' && <LookupModal modal={modal} />}
              {modal.type === 'import' && <ImportModal modal={modal} onConfirm={() => importSelected(modal.srcDb, modal.fileName)} onClose={closeModal} />}
              {modal.type === 'synchelp' && <SyncHelpModal onCopy={() => { navigator.clipboard?.writeText(syncCmd()).then(() => showSnack('已复制命令')); }} onClose={closeModal} />}
            </div>
          </div>
        </div>
      )}

      {/* Snackbar */}
      {snack && <div className="snackbar" onClick={() => setSnack(null)}>{(snack.success ? '✅ ' : '') + snack.msg}</div>}
    </>
  );

  // ---- 内部辅助 ----
  function toolbarCount(view, sectioned, ps, items, pg) {
    if (view.cross) return `${view.convs.length} 个对话`;
    if (sectioned) return `${sectioned.length} 分栏 · ${view.convs.reduce((s, c) => s + c.sentences.length, 0)} 句`;
    return `${view.convs.length} 对话 · ${view.convs.reduce((s, c) => s + c.sentences.length, 0)} 句`;
  }
  function pageRange(page, total) {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    let start = Math.max(1, page - 3);
    let end = Math.min(total, start + 6);
    start = Math.max(1, end - 6);
    const pages = [];
    if (start > 1) { pages.push(1); if (start > 2) pages.push('...'); }
    for (let i = start; i <= end; i++) pages.push(i);
    if (end < total) { if (end < total - 1) pages.push('...'); pages.push(total); }
    return pages;
  }
  function jumpToSection(si) {
    const idx = flatItems.findIndex(it => it.type === 'section' && it.si === si);
    if (idx >= 0) {
      setPage(Math.floor(idx / pageSize) + 1);
      setCollapsedSecs(prev => { const n = new Set(prev); n.delete('sec-' + si); return n; });
    }
  }
  function activeSection(blocks, si) {
    // 当前页可见的分栏高亮
    const start = (safePage - 1) * pageSize;
    const slice = flatItems.slice(start, start + pageSize);
    const first = slice.find(it => it.type === 'section');
    return first && first.si === si;
  }
  function makeState() {
    return {
      playingSid,
      expanded, collapsedSecs,
      selConvs, selSens,
      onToggleConv: (mid) => setExpanded(prev => { const n = new Set(prev); n.has(mid) ? n.delete(mid) : n.add(mid); return n; }),
      onToggleConvSelect: toggleConvSelect,
      onToggleSenSelect: toggleSentenceSel,
      onRowClick,
      onSpeakOnce,
      onLookup: openLookup,
      onMastered: toggleMastered,
      onView: viewConv,
      onExportConv: exportConvAnki,
    };
  }
}

const modalTitles = { conv: '对话详情', lookup: '分词查词', import: '导入收藏夹', synchelp: '同步服务未启动' };

function syncCmd() {
  const dir = decodeURIComponent(window.location.href.replace('/index.html', '').replace('file:///', ''));
  return `cmd /c "cd /d ${dir} && python sync_server.py"`;
}

// ===== 对话卡片 =====
function ConvCard({ conv, colTitle, state }) {
  const isExpanded = state.expanded.has(conv.messageId);
  const isSelected = state.selConvs.has(conv.messageId);
  const summary = stripMarkdown(conv.aiSummary || '');
  const modelShort = (conv.model || '').substring(0, 20);
  return (
    <div className={'conv-card' + (isExpanded ? ' expanded' : '') + (isSelected ? ' selected' : '')} data-msg-id={conv.messageId}>
      <div className="conv-card-header" onClick={() => state.onToggleConv(conv.messageId)}>
        <input type="checkbox" className="md-checkbox" checked={isSelected} title="勾选导出"
               onClick={e => e.stopPropagation()}
               onChange={e => state.onToggleConvSelect(conv.messageId, e.target.checked)} />
        <div className="conv-card-body">
          {colTitle ? <div className="collection-badge"><span className="mi" style={{ fontSize: 12 }}>folder</span> {escHtml(colTitle)}</div> : null}
          <div className="conv-question">{conv.userQuestion || '(无用户提问)'}</div>
          {summary ? <div className="conv-summary">{summary}</div> : null}
          <div className="conv-card-meta">
            <span>{conv.sentences.length} 句</span>
            {modelShort ? <span className="sen-tag">{modelShort}</span> : ''}
          </div>
        </div>
        <div className="conv-card-actions">
          <button className="md-btn md-btn-text md-btn-sm" onClick={e => { e.stopPropagation(); state.onView(conv.messageId); }} title="查看对话原文"><span className="mi">article</span>原文</button>
          <button className="md-btn md-btn-text md-btn-sm" onClick={e => { e.stopPropagation(); state.onExportConv(conv.messageId); }} title="导出该对话为 Anki CSV"><span className="mi">file_download</span></button>
        </div>
      </div>
      <div className="conv-sentences"><div className="conv-sentences-inner">
        {conv.sentences.filter(s => s.type !== 'section').map(s => (
          <SentenceRow key={s.id} s={s} state={state} convId={conv.messageId} />
        ))}
      </div></div>
    </div>
  );
}

function SentenceRow({ s, state }) {
  const isPlaying = state.playingSid != null && String(state.playingSid) === String(s.id);
  return (
    <div className={'sentence-row' + (isPlaying ? ' playing' : '')}
         onClick={() => state.onRowClick(s)}>
      <input type="checkbox" className="md-checkbox" checked={state.selSens.has(s.id)} title="勾选导出"
             onClick={e => e.stopPropagation()}
             onChange={e => state.onToggleSenSelect(s.id, e.target.checked)} />
      <div className="sen-content">
        <div className="sen-ja" dangerouslySetInnerHTML={{ __html: renderContentWithRuby(s.content, s.ruby) }} />
        <div className="sen-zh">{s.translation}</div>
        <div className="sen-tags">{s.tags ? <span className="sen-tag">{s.tags}</span> : null}</div>
      </div>
      <span className={'sen-lookup sen-mastered' + (s.isMastered ? ' on' : '')} title={s.isMastered ? '取消已掌握' : '标记为已掌握'}
            onClick={e => { e.stopPropagation(); state.onMastered(s.id); }}>
        <span className="mi">{s.isMastered ? 'check_circle' : 'radio_button_unchecked'}</span>
      </span>
      <span className="sen-lookup" title="分词查词典" onClick={e => { e.stopPropagation(); state.onLookup(s); }}><span className="mi">menu_book</span></span>
      <span className="sen-lookup" title="只读这一句" onClick={e => { e.stopPropagation(); state.onSpeakOnce(s); }}><span className="mi">volume_up</span></span>
    </div>
  );
}

// ===== 模态框内容 =====
function ConvModal({ conv, onCopy }) {
  const mdHtml = marked.parse(preprocessLangBlocks(conv.aiAnswer));
  return (
    <>
      <div className="user-q">
        <div className="label">👤 用户提问</div>
        {escHtml(conv.userQuestion || '(无)')}
      </div>
      <div className="md-content">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div className="label" style={{ font: 'var(--md-sys-typescale-label-small)', opacity: .7 }}>🤖 AI 回复</div>
          <button className="md-btn md-btn-text md-btn-sm" onClick={() => onCopy(conv)}><span className="mi">content_copy</span>复制全文</button>
        </div>
        <div dangerouslySetInnerHTML={{ __html: mdHtml }} />
      </div>
    </>
  );
}

function LookupModal({ modal }) {
  return (
    <>
      <div style={{ font: 'var(--md-sys-typescale-label-small)', color: 'var(--md-sys-color-on-surface-variant)', marginBottom: 12 }}>
        点击单词跳转词典 · 也可以手动划选句子中的文字
      </div>
      {modal.words.map(({ word, base }, i) => {
        const enc = encodeURIComponent(word);
        const links = modal.jp ? dictLinks(base || word) : dictLinksEn(word);
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--md-sys-color-outline-variant)' }}>
            <span style={{ fontFamily: 'var(--font-ja)', fontSize: 16, flex: 1 }}>
              {word}{base ? <span style={{ fontSize: 12, color: 'var(--md-sys-color-on-surface-variant)' }}> ← {base}</span> : null}
            </span>
            {links.map(l => (
              <a key={l.label} href={l.href} target="_blank" rel="noopener" className="md-btn md-btn-text md-btn-sm" style={{ fontSize: 11 }}>
                <span className="mi" style={{ fontSize: 14 }}>{l.icon}</span>{l.label}
              </a>
            ))}
          </div>
        );
      })}
    </>
  );
}

function ImportModal({ modal, onConfirm, onClose }) {
  return (
    <div style={{ padding: 0 }}>
      <div style={{ font: 'var(--md-sys-typescale-title-medium)', marginBottom: 12 }}>选择要导入的收藏夹</div>
      {modal.rows.map((r, i) => (
        <label key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', cursor: 'pointer' }}>
          <input type="checkbox" className="md-checkbox" defaultChecked data-id={r.id} />
          <span>{r.title} <span style={{ color: 'var(--md-sys-color-on-surface-variant)', fontSize: 12 }}>{r.lang || ''} {r.translationLang ? '→ ' + r.translationLang : ''}</span></span>
        </label>
      ))}
      <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
        <button className="md-btn md-btn-filled" onClick={onConfirm}>确认导入</button>
        <button className="md-btn md-btn-text" onClick={onClose}>取消</button>
      </div>
    </div>
  );
}

function SyncHelpModal({ onCopy, onClose }) {
  return (
    <div style={{ textAlign: 'center', padding: 16 }}>
      <div style={{ fontSize: 48, marginBottom: 12 }}><span className="mi" style={{ fontSize: 48 }}>smartphone</span></div>
      <div style={{ font: 'var(--md-sys-typescale-title-medium)', marginBottom: 8 }}>同步服务未启动</div>
      <div style={{ font: 'var(--md-sys-typescale-body-medium)', color: 'var(--md-sys-color-on-surface-variant)', marginBottom: 12 }}>请在新终端运行以下命令：</div>
      <div style={{ background: 'var(--md-sys-color-surface-container)', padding: '10px 14px', borderRadius: 8, fontFamily: 'Consolas, monospace', fontSize: 13, marginBottom: 12, textAlign: 'left', userSelect: 'all' }}>{syncCmd()}</div>
      <button className="md-btn md-btn-filled" onClick={() => { onCopy(); onClose(); }}>📋 复制</button>
      <button className="md-btn md-btn-text" onClick={onClose} style={{ marginLeft: 8 }}>关闭</button>
    </div>
  );
}

// ===== 划词弹框（状态机，防复现）=====
function SelectionPopup({ onLookUp }) {
  const [popup, setPopup] = useState(null);   // {text, jp, x, y}
  const popupRef = useRef(null);
  const suppressRef = useRef(false);
  const closedTextRef = useRef('');
  popupRef.current = popup;

  useEffect(() => {
    const close = () => setPopup(null);
    const onMousedown = (e) => {
      const el = document.querySelector('.pitch-popup');
      if (el) {
        if (!el.contains(e.target)) {
          closedTextRef.current = (window.getSelection() ? window.getSelection().toString() : '').trim();
          close();
          suppressRef.current = true;
        }
      } else {
        suppressRef.current = false;
      }
    };
    const onMouseup = (e) => {
      const zone = e.target.closest && (e.target.closest('.sentence-row') || e.target.closest('#modalBody'));
      if (!zone) return;
      const sel = window.getSelection();
      const text = sel ? sel.toString().trim() : '';
      if (!text || text.length > 30) return;
      if (suppressRef.current) {
        suppressRef.current = false;
        if (text === closedTextRef.current) return;
      }
      const jp = /[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff]/.test(text);
      // html zoom 会放大布局坐标，而 clientX/Y 是未缩放视口坐标，需要反除对齐
      const z = parseFloat(document.documentElement.style.zoom) || 1;
      setPopup({
        text, jp,
        x: Math.min(e.clientX / z, window.innerWidth / z - 220),
        y: Math.min((e.clientY + 8) / z, window.innerHeight / z - 180),
        fixed: !!e.target.closest('#modalBody'),
      });
    };
    document.addEventListener('mousedown', onMousedown);
    document.addEventListener('mouseup', onMouseup);
    return () => {
      document.removeEventListener('mousedown', onMousedown);
      document.removeEventListener('mouseup', onMouseup);
    };
  }, []);

  useEffect(() => {
    const list = document.querySelector('.scroll-list');
    if (!list) return;
    const close = () => setPopup(null);
    list.addEventListener('scroll', close);
    return () => list.removeEventListener('scroll', close);
  }, []);

  if (!popup) return null;
  const enc = encodeURIComponent(popup.text);
  const links = popup.jp ? dictLinks(popup.text).map(l => ({ ...l, label: l.label === 'Jisho' ? 'Jisho 词典' : 'OJAD 音调' })) : dictLinksEn(popup.text);
  return (
    <div className="pitch-popup" style={{ position: popup.fixed ? 'fixed' : 'absolute', top: popup.y, left: popup.x }}>
      <div className="popup-word">{escHtml(popup.text)}</div>
      {links.map(l => (
        <a key={l.label} href={l.href} target="_blank" rel="noopener"><span className="mi" style={{ fontSize: 16 }}>{l.icon}</span>{l.label}</a>
      ))}
    </div>
  );
}
