// 导出（Anki CSV / CSV / TXT）
export function dateStamp() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

export function exportFileBase(isCrossSearch, collectionTitle) {
  if (isCrossSearch) return 'ocat_跨收藏夹';
  const t = (collectionTitle || 'ocat').replace(/[\\/:*?"<>|]/g, '_');
  return 'ocat_' + t;
}

export function getSelectedSentences(DATA, currentCollection, isCrossSearch, selectedConvs, selectedSentences) {
  const all = [];
  const cols = isCrossSearch ? DATA : (currentCollection ? [currentCollection] : []);
  for (const col of cols) {
    for (const conv of allConvsOf(col)) {
      const convSelected = selectedConvs.has(conv.messageId);
      for (const s of conv.sentences) {
        if ((convSelected || selectedSentences.has(s.id)) && s.type !== 'section') {
          all.push({ ...s, userQuestion: conv.userQuestion, collectionName: col.title });
        }
      }
    }
  }
  return all;
}
function allConvsOf(col) {
  return col.hasSections ? col.sections.flatMap(s => s.conversations) : col.conversations;
}

// CSV 公式注入防护（BUG-09）：= + - @ 或制表符开头的字段会被 Excel/WPS 当公式执行，
// 前缀单引号使其按文本处理（OWASP CSV Injection 惯例）；同时保留双引号转义
function csvSafe(v) {
  const s = String(v == null ? '' : v).replace(/"/g, '""');
  return /^[=+\-@\t]/.test(s) ? "'" + s : s;
}

export function buildAnkiCsv(sentences) {
  let csv = '正面,反面,标签\n';
  sentences.forEach(s => {
    const front = `"${csvSafe(s.translation || '')}<br><br><small>${csvSafe(s.userQuestion || '')}</small>"`;
    let back = csvSafe(s.content || '');
    if (s.ruby) back += `<br><br><small>${csvSafe(s.ruby)}</small>`;
    const tags = [csvSafe(s.collectionName)];
    if (s.tags) tags.push(csvSafe(s.tags));
    if (s.isMastered) tags.push('mastered');
    csv += `${front},"${back}","${tags.join(' ')}"\n`;
  });
  return csv;
}

export function buildCsv(sentences) {
  let csv = '序号,收藏夹,日语句子,中文翻译,振假名,用户提问,标签,已掌握\n';
  sentences.forEach((s, i) => {
    csv += `${i + 1},"${csvSafe(s.collectionName)}","${csvSafe(s.content || '')}","${csvSafe(s.translation || '')}","${csvSafe(s.ruby || '')}","${csvSafe(s.userQuestion || '')}","${csvSafe(s.tags || '')}",${s.isMastered ? '是' : ''}\n`;
  });
  return csv;
}

export function buildTxt(sentences) {
  let txt = `# OCAT 导出\n# 共 ${sentences.length} 条\n\n`;
  sentences.forEach((s, i) => {
    txt += `${i + 1}. [${s.collectionName}] ${s.content}\n`;
    if (s.translation) txt += `   ${s.translation}\n`;
    if (s.ruby) txt += `   [${s.ruby}]\n`;
    if (s.userQuestion) txt += `   提问: ${s.userQuestion}\n`;
    txt += '\n';
  });
  return txt;
}

export function buildConvAnkiCsv(conv, colName) {
  let csv = '正面,反面,标签\n';
  conv.sentences.filter(s => s.type !== 'section').forEach(s => {
    csv += `"${csvSafe(s.translation || '')}<br><br><small>${csvSafe(conv.userQuestion || '')}</small>","${csvSafe(s.content || '')}","${csvSafe(colName)}"\n`;
  });
  return csv;
}

export function downloadFile(content, filename, mimeType) {
  const blob = new Blob(['\uFEFF' + content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
