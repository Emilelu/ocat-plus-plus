// 对话卡片 + 句子行（纯展示，行为全部通过 state 回调注入）
import { escHtml, stripMarkdown, renderContentWithRuby } from '../lib/text.js';

export function ConvCard({ conv, colTitle, state }) {
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
          <button className="md-btn md-btn-text md-btn-sm" onClick={e => { e.stopPropagation(); state.onDeleteConv(conv.messageId); }} title="删除该对话"><span className="mi">delete_outline</span></button>
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

export function SentenceRow({ s, state }) {
  const isPlaying = state.playingSid != null && String(state.playingSid) === String(s.id);
  return (
    <div className={'sentence-row' + (isPlaying ? ' playing' : '')} data-sid={s.id}
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
      <span className="sen-lookup" title="编辑句子" onClick={e => { e.stopPropagation(); state.onEdit(s); }}><span className="mi">edit_note</span></span>
      <span className="sen-lookup" title="删除句子" onClick={e => { e.stopPropagation(); state.onDeleteSentence(s.id); }}><span className="mi">delete_outline</span></span>
    </div>
  );
}
