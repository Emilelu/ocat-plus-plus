// 纯视图辅助：不依赖 React 状态，可直接单测 / 复用
export const PAGE_SIZES = [25, 50, 100, 200];

export const MODAL_TITLES = {
  conv: '对话详情', lookup: '分词查词', import: '导入收藏夹', synchelp: '同步服务未启动',
  edit: '编辑句子', add: '添加到收藏夹', newcol: '新建收藏夹', confirm: '确认删除',
};

// 搜索命中判定（跨收藏夹搜索与当前收藏夹搜索共用）
// 注意：translation / userQuestion / aiAnswer 在库里可能为 NULL，必须空值兜底，
// 否则 'all' 字段拼接后 .toLowerCase() 抛 TypeError，导致搜索崩溃。
export function matchSentence(s, conv, keyword, field) {
  const S = (s && s.content) || '';
  const T = (s && s.translation) || '';
  const Q = (conv && conv.userQuestion) || '';
  const A = (conv && conv.aiAnswer) || '';
  if (field === 'all') return (S + T + Q + A).toLowerCase().includes(keyword);
  if (field === 'content') return S.toLowerCase().includes(keyword);
  if (field === 'translation') return T.toLowerCase().includes(keyword);
  if (field === 'question') return Q.toLowerCase().includes(keyword);
  if (field === 'answer') return A.toLowerCase().includes(keyword);
  return false;
}

// 工具栏计数文案
export function toolbarCount(view, sectioned) {
  if (view.cross) return `${view.convs.length} 个对话`;
  if (sectioned) return `${sectioned.length} 分栏 · ${view.convs.reduce((s, c) => s + c.sentences.length, 0)} 句`;
  return `${view.convs.length} 对话 · ${view.convs.reduce((s, c) => s + c.sentences.length, 0)} 句`;
}

// B 站风格分页：当前页居中、前后翻页箭头、超长时折叠为省略号
export function pageRange(page, total) {
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

// 手机同步服务的启动命令（供复制）
// file:// 下解析出项目目录；http 等其他环境无法得知本地路径，给出占位符（待确认6）
export function syncCmd() {
  let dir = '<项目目录>';
  try {
    const u = new URL(window.location.href);
    if (u.protocol === 'file:') {
      let p = u.pathname;
      try { p = decodeURIComponent(p); } catch { /* 保留原路径 */ }
      p = p.replace(/\/[^/]*$/, '');            // 去掉文件名（含目录 URL、带查询/哈希等情况）
      dir = p.replace(/^\/+/, '').replace(/\//g, '\\');
      if (!dir) dir = '<项目目录>';
    }
  } catch { /* URL 解析失败时保留占位符 */ }
  return `cmd /c "cd /d ${dir} && python sync_server.py"`;
}
