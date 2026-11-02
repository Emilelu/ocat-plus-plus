// 纯视图辅助：不依赖 React 状态，可直接单测 / 复用
export const PAGE_SIZES = [25, 50, 100, 200];

export const MODAL_TITLES = {
  conv: '对话详情', lookup: '分词查词', import: '导入收藏夹', synchelp: '同步服务未启动',
  edit: '编辑句子', add: '添加到收藏夹', newcol: '新建收藏夹', confirm: '确认删除',
};

// 搜索命中判定（跨收藏夹搜索与当前收藏夹搜索共用）
export function matchSentence(s, conv, keyword, field) {
  if (field === 'all') return (s.content + s.translation + conv.userQuestion + conv.aiAnswer).toLowerCase().includes(keyword);
  if (field === 'content') return s.content.toLowerCase().includes(keyword);
  if (field === 'translation') return s.translation.toLowerCase().includes(keyword);
  if (field === 'question') return conv.userQuestion.toLowerCase().includes(keyword);
  if (field === 'answer') return conv.aiAnswer.toLowerCase().includes(keyword);
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
export function syncCmd() {
  const dir = decodeURIComponent(window.location.href.replace('/index.html', '').replace('file:///', ''));
  return `cmd /c "cd /d ${dir} && python sync_server.py"`;
}
