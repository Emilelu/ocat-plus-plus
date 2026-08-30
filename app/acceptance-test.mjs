// 验收测试：真实 DB 全流程增删改查 + 验证内存操作不落盘、仅 db.export() 持久化
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  parseDb, loadAllData, allConvs, insertCollectionList, insertSentence,
  updateSentence, deleteSentenceDb, deleteConvDb, maxCollectionIndex,
  uuid, bracketsToRubyHtml,
} from './src/lib/db.js';

const here = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(here, '..', 'OCAT.db');

const assert = (cond, msg) => { if (!cond) { console.error('✗ FAIL:', msg); process.exitCode = 1; throw new Error(msg); } console.log('✓', msg); };
const hash = (b) => createHash('sha256').update(b).digest('hex');

const fileBytes = readFileSync(DB_PATH);
const beforeHash = hash(fileBytes);

const db = await parseDb(fileBytes);

// ---- 1. 读取：所有收藏夹（含空收藏夹保留）----
let data = loadAllData(db);
assert(data.length >= 17, `loadAllData 返回 ${data.length} 个收藏夹（≥17）`);
const emptyCols = data.filter(c => allConvs(c).length === 0);
console.log(`    其中空收藏夹 ${emptyCols.length} 个（应保留可见）`);

// ---- 2. 新建收藏夹 ----
const colId = uuid();
const beforeColCount = data.length;
insertCollectionList(db, { id: colId, title: '验收测试夹', lang: 'ja', index: maxCollectionIndex(db) });
data = loadAllData(db);
assert(data.length === beforeColCount + 1, `新建收藏夹后数量 ${beforeColCount} -> ${data.length}`);
const newCol = data.find(c => c.id === colId);
assert(newCol && newCol.title === '验收测试夹', '新建收藏夹可被读取且标题正确');
assert(allConvs(newCol).length === 0, '新建收藏夹为空且被保留');

// ---- 3. 添加普通句子（应单独成对话）----
const sid1 = uuid(); const mid1 = uuid();
insertSentence(db, { id: sid1, collectionListId: colId, messageId: mid1, content: '東京へ行く', translation: '去东京', tags: '旅行', ruby: null, lang: 'ja', type: null });
data = loadAllData(db);
const c1 = data.find(c => c.id === colId);
assert(c1 && allConvs(c1).length === 1, '添加普通句子后该收藏夹有 1 个对话');
assert(allConvs(c1)[0].sentences.length === 1 && allConvs(c1)[0].sentences[0].content === '東京へ行く', '句子内容正确');

// ---- 4. 添加带注音的句子（验证 ruby 往返 + content 派生）----
const sid2 = uuid(); const mid2 = uuid();
insertSentence(db, { id: sid2, collectionListId: colId, messageId: mid2, content: '東京へ行く', translation: '去东京', tags: null, ruby: bracketsToRubyHtml('東京[とうきょう]へ行く'), lang: 'ja', type: null });
data = loadAllData(db);
const c2 = data.find(c => c.id === colId);
assert(allConvs(c2).length === 2, '带注音句子单独成第二个对话（不并入第一个）');
const rubyConv = allConvs(c2).find(cv => cv.messageId === mid2);
assert(rubyConv && rubyConv.sentences[0].ruby === '東京[とうきょう]へ行く', '注音括号格式往返一致');
assert(rubyConv.sentences[0].content === '東京へ行く', 'content 与注音去括号一致');

// ---- 5. 添加分栏 ----
const sidSec = uuid();
insertSentence(db, { id: sidSec, collectionListId: colId, messageId: null, content: '第一栏', translation: null, tags: null, ruby: null, lang: 'ja', type: 'section' });
data = loadAllData(db);
const c3 = data.find(c => c.id === colId);
assert(c3.hasSections === true, '添加分栏后收藏夹进入分栏视图');
assert(c3.sections && c3.sections.some(s => s.title === '第一栏'), '分栏标题可被读取');

// ---- 6. 编辑句子 ----
updateSentence(db, sid1, { content: '東京へ行きたい', translation: '想去东京', tags: '旅行,语法', ruby: null });
data = loadAllData(db);
let edited = null;
outer:
for (const c of data) for (const cv of allConvs(c)) for (const s of cv.sentences) if (s.id === sid1) { edited = s; break outer; }
assert(edited && edited.content === '東京へ行きたい', '编辑后 content 更新');
assert(edited.translation === '想去东京', '编辑后 translation 更新');
assert(edited.tags === '旅行,语法', '编辑后 tags 更新');

// ---- 7. 软删除句子 ----
deleteSentenceDb(db, sid1);
const stmt = db.prepare('SELECT deleted FROM Collection WHERE id = ?'); stmt.bind([sid1]); stmt.step();
assert(stmt.getAsObject().deleted === 1, '软删除句子后 deleted=1（未物理删除）'); stmt.free();
data = loadAllData(db);
let stillThere = false;
for (const c of data) for (const cv of allConvs(c)) for (const s of cv.sentences) if (s.id === sid1) stillThere = true;
assert(!stillThere, '软删除后句子从视图中消失');

// ---- 8. 软删除对话（该对话下所有句子 deleted=1）----
deleteConvDb(db, mid2, colId);
const stmt2 = db.prepare('SELECT COUNT(*) AS n FROM Collection WHERE messageId = ? AND collectionListId = ? AND deleted = 0');
stmt2.bind([mid2, colId]); stmt2.step();
assert(stmt2.getAsObject().n === 0, '软删除对话后该对话所有句子从视图消失'); stmt2.free();

// ---- 9. 内存操作不落盘 ----
const afterHash = hash(readFileSync(DB_PATH));
assert(beforeHash === afterHash, '内存增删改后磁盘文件字节未变（不落盘）');

// ---- 10. 仅 export 持久化 ----
const exported = db.export();
assert(beforeHash !== hash(exported), 'db.export() 产物与原始文件不同（改动已编码）');
const db2 = await parseDb(exported);
const data2 = loadAllData(db2);
const col2 = data2.find(c => c.id === colId);
assert(col2 && col2.title === '验收测试夹', '重载导出库：新建收藏夹仍在');
assert(col2.hasSections === true && col2.sections.length === 1 && col2.sections[0].title === '第一栏', '重载导出库：分栏保留');
assert(allConvs(col2).length === 0, '重载导出库：两句均被软删除，仅剩 1 个空分栏');

// ---- 11. 注音 HTML 输出格式核对（与原始库逐字 ruby 一致）----
const rubyHtml = bracketsToRubyHtml('口頭[こうとう]での一番[いちばん]の壁[かべ]は');
assert(rubyHtml === '<ruby>口頭<rt>こうとう</rt></ruby><ruby>で</ruby><ruby>の</ruby><ruby>一番<rt>いちばん</rt></ruby><ruby>の</ruby><ruby>壁<rt>かべ</rt></ruby><ruby>は</ruby>', `注音 HTML 格式正确：${rubyHtml}`);

console.log('\n=== 验收测试全部通过 ===');
