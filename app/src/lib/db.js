// 数据库与缓存层（sql.js + IndexedDB，逻辑与 legacy 一致）
import initSqlJs from 'sql.js';
import wasmB64 from './sql-wasm.b64.js';
import { rubyToBrackets, distributeReading } from './text.js';

let SQL = null;
export async function ensureSql() {
  if (!SQL) {
    // 直接解码内联的 base64，file:// 下零网络请求
    const bytes = Uint8Array.from(atob(wasmB64), c => c.charCodeAt(0));
    SQL = await initSqlJs({ wasmBinary: bytes });
  }
  return SQL;
}

export async function parseDb(buf) {
  const SQL = await ensureSql();
  return new SQL.Database(new Uint8Array(buf));
}

// 解析全部收藏夹 → DATA 结构（与 legacy 相同）
export function loadAllData(db) {
  const q = (sql, params = []) => {
    const stmt = db.prepare(sql);
    if (params.length) stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  };

  const collections = q(`SELECT id, title, summary, lang, translationLang FROM CollectionList WHERE deleted = 0 ORDER BY "index"`);
  const colMap = {};
  collections.forEach(c => { colMap[c.id] = { ...c, conversations: [], sections: null, hasSections: false }; });

  const sentences = q(`SELECT id, "index", content, translation, ruby, lang, isMastered, tags, collectionListId, messageId, createdAt, type FROM Collection WHERE deleted = 0 ORDER BY collectionListId, messageId, "index"`);
  const messages = {};
  q(`SELECT id, authorId, text, contextMessageId, contextMessageText, model, createdAt FROM LocalMessage`).forEach(m => { messages[m.id] = { ...m }; });

  const convMap = {};
  sentences.forEach(s => {
    if (!colMap[s.collectionListId]) return;
    const key = `${s.collectionListId}|${s.messageId || ''}`;
    if (!convMap[key]) convMap[key] = [];
    convMap[key].push({
      id: s.id, content: s.content || '', translation: s.translation || '',
      ruby: rubyToBrackets(s.ruby), lang: s.lang || '',
      isMastered: !!s.isMastered, tags: s.tags || '',
      createdAt: s.createdAt || 0, type: s.type || '', index: s.index,
    });
  });

  for (const clid of Object.keys(colMap)) {
    const allItems = [];
    for (const [key, sens] of Object.entries(convMap)) {
      const [convClid, msgid] = key.split('|', 2);
      if (convClid !== clid) continue;
      const sections = sens.filter(s => s.type === 'section');
      const normals = sens.filter(s => s.type !== 'section');
      let userQ = '', aiA = '', model = '';
      if (msgid && messages[msgid]) {
        const aiMsg = messages[msgid];
        aiA = aiMsg.text || '';
        model = aiMsg.model || '';
        if (aiMsg.contextMessageId && messages[aiMsg.contextMessageId]) {
          userQ = messages[aiMsg.contextMessageId].text || '';
        }
      }
      if (sections.length) {
        sections.forEach(sec => allItems.push({ idx: sec.index, isSection: true, title: sec.content, conv: { messageId: msgid, userQuestion: '', aiAnswer: '', aiSummary: '', model: '', sentences: [] } }));
      } else if (normals.length) {
        allItems.push({ idx: normals[0].index, isSection: false, title: '', conv: { messageId: msgid, userQuestion: userQ, aiAnswer: aiA, aiSummary: aiA.substring(0, 250), model, sentences: normals } });
      }
    }
    if (!allItems.length) continue;
    allItems.sort((a, b) => a.idx - b.idx);
    const hasSections = allItems.some(it => it.isSection);
    if (hasSections) {
      const sections = []; let cur = null;
      allItems.forEach(it => {
        if (it.isSection) { cur = { title: it.title, conversations: [] }; sections.push(cur); }
        else if (cur) cur.conversations.push(it.conv);
        else { if (!sections.length) sections.push({ title: '', conversations: [] }); sections[0].conversations.push(it.conv); }
      });
      colMap[clid].sections = sections; colMap[clid].hasSections = true;
    } else {
      colMap[clid].conversations = allItems.map(it => it.conv);
    }
  }
  // 管理端：保留空收藏夹（新建后尚未添加句子也可见）
  return Object.values(colMap);
}

export function allConvs(col) {
  return col.hasSections ? col.sections.flatMap(s => s.conversations) : col.conversations;
}

export function findConvAnywhere(DATA, msgId) {
  for (const col of DATA) {
    const conv = allConvs(col).find(c => c.messageId === msgId);
    if (conv) return conv;
  }
  return null;
}

// ===== IndexedDB 缓存（含原始 DB 字节，缓存会话可编辑/保存）=====
function openCache() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('ocat_cache', 1);
    req.onupgradeneeded = () => { req.result.createObjectStore('data'); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function cacheData(DATA, db, name, dirty) {
  let raw = null;
  try { raw = db ? db.export() : null; } catch (e) { raw = null; }
  const idb = await openCache();
  await new Promise((resolve) => {
    const tx = idb.transaction('data', 'readwrite');
    tx.objectStore('data').put({ data: DATA, raw, name, time: Date.now(), dirty: !!dirty }, 'current');
    tx.oncomplete = () => { idb.close(); resolve(); };
  });
}

export async function loadCached() {
  try {
    const idb = await openCache();
    const result = await new Promise((resolve) => {
      const tx = idb.transaction('data', 'readonly');
      const get = tx.objectStore('data').get('current');
      get.onsuccess = () => { idb.close(); resolve(get.result || null); };
      get.onerror = () => { idb.close(); resolve(null); };
    });
    return result;
  } catch { return null; }
}

// 标记已掌握（写回内存 DB）
export function toggleMasteredDb(db, sid, newVal) {
  db.run('UPDATE Collection SET isMastered = ? WHERE id = ?', [newVal, sid]);
}

// ===== 手机同步 =====
export async function syncFromPhoneApi() {
  const resp = await fetch('http://localhost:8899/api/sync', { signal: AbortSignal.timeout(30000) });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || '未知错误');
  }
  return resp.arrayBuffer();
}

// ===== 写功能（编辑/删除/新建）=====
export function uuid() {
  return crypto.randomUUID ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });
}

// 漢字[かんじ] 括号格式 → app 数据库使用的 HTML ruby（与原始库一致：逐字保留假名、汉字按词分组）
export function bracketsToRubyHtml(text) {
  if (!text) return null;
  let out = '';
  let hasRuby = false;
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('[', i);
    if (open === -1) { out += plainRubyChars(text.slice(i)); break; }
    const close = text.indexOf(']', open);
    if (close === -1) { out += plainRubyChars(text.slice(i)); break; }
    const base = text.slice(i, open);            // 可能含前导假名
    const reading = text.slice(open + 1, close);
    // 用 distributeReading 拆出前导假名（无注音）与汉字（按拍分配读音），再按连续汉字合并为词
    const parts = distributeReading(base, reading);
    let buf = '', bufRt = '';
    const flush = () => { if (buf) { out += `<ruby>${buf}<rt>${bufRt}</rt></ruby>`; buf = ''; bufRt = ''; } };
    for (const { char, rt } of parts) {
      if (rt) { buf += char; bufRt += rt; }
      else { flush(); out += `<ruby>${char}</ruby>`; }
    }
    flush();
    hasRuby = true;
    i = close + 1;
  }
  return hasRuby ? out : null;
}

function plainRubyChars(s) {
  let o = '';
  for (const ch of s) o += `<ruby>${ch}</ruby>`;
  return o;
}

function nextIndex(db, collectionListId) {
  const stmt = db.prepare('SELECT MAX("index") AS m FROM Collection WHERE collectionListId = ?');
  stmt.bind([collectionListId]);
  stmt.step();
  const m = stmt.getAsObject().m;
  stmt.free();
  return (m === null || m === undefined ? 0 : m) + 1;
}

export function maxCollectionIndex(db) {
  const stmt = db.prepare('SELECT MAX("index") AS m FROM CollectionList');
  stmt.step();
  const m = stmt.getAsObject().m;
  stmt.free();
  return (m === null || m === undefined ? 0 : m) + 1;
}

export function insertCollectionList(db, { id, title, lang, index }) {
  const now = Date.now();
  db.run(`INSERT INTO CollectionList (id, title, icon, summary, tags, "index", deleted, deletedAt, createdAt, updatedAt, syncState, isPublic, shareId, lang, translationLang, isCopied)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, title, null, '', null, index, 0, 0, now, now, 0, 0, null, lang || null, null, 0]);
}

export function insertSentence(db, { id, collectionListId, content, translation, tags, ruby, lang, type, messageId = null }) {
  db.run(`INSERT INTO Collection (id, content, translation, lang, ruby, "index", tags, collectionListId, messageId, deleted, deletedAt, createdAt, updatedAt, syncState, ttsKey, translationLang, type, hasSyncedTts, isTtsUploaded, isMastered, isCopied, ttsTone, ttsVoice)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, content, translation || null, lang || 'ja', ruby || null, nextIndex(db, collectionListId), tags || null,
     collectionListId, messageId, 0, 0, Date.now(), Date.now(), 0, null, null, type || null, 0, 0, 0, 0, null, null]);
}

export function updateSentence(db, sid, { content, translation, tags, ruby }) {
  db.run('UPDATE Collection SET content=?, translation=?, tags=?, ruby=?, updatedAt=? WHERE id=?',
    [content, translation || null, tags || null, ruby || null, Date.now(), sid]);
}

export function deleteSentenceDb(db, sid) {
  db.run('UPDATE Collection SET deleted=1, deletedAt=?, updatedAt=? WHERE id=?', [Date.now(), Date.now(), sid]);
}

export function deleteConvDb(db, mid, collectionListId) {
  db.run('UPDATE Collection SET deleted=1, deletedAt=?, updatedAt=? WHERE messageId=? AND collectionListId=?',
    [Date.now(), Date.now(), mid, collectionListId]);
}
