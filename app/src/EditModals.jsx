import React, { useState, useRef, useEffect } from 'react';

const field = {
  width: '100%', border: '1px solid var(--md-sys-color-outline)', borderRadius: 8,
  padding: '8px 10px', font: 'inherit', background: 'var(--md-sys-color-surface)',
  color: 'var(--md-sys-color-on-surface)', boxSizing: 'border-box',
};

// 句子编辑 / 添加（add 模式多出类型选择）
// BUG-10：有未保存更改时按 Esc 不直接关闭，弹出行内确认，避免内容无提示丢失
export function SentenceEditModal({ base, add, onSave, onCancel }) {
  const [type, setType] = useState('sentence');
  const [content, setContent] = useState(add ? '' : base.content);
  const [translation, setTranslation] = useState(add ? '' : base.translation);
  const [tags, setTags] = useState(add ? '' : base.tags);
  const [ruby, setRuby] = useState(add ? '' : base.ruby);
  const [confirmClose, setConfirmClose] = useState(false);
  const isSection = add && type === 'section';
  const init = useRef({ content: add ? '' : base.content, translation: add ? '' : base.translation, tags: add ? '' : base.tags, ruby: add ? '' : base.ruby });

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      const dirty = content !== init.current.content || translation !== init.current.translation
        || tags !== init.current.tags || ruby !== init.current.ruby;
      if (dirty) {
        e.stopImmediatePropagation();   // 拦截 App 的「Esc 关闭模态框」，保留编辑状态
        setConfirmClose(true);
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [content, translation, tags, ruby]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {confirmClose && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8, background: 'var(--md-sys-color-error-container)', color: 'var(--md-sys-color-error)' }}>
          <span style={{ flex: 1 }}>有未保存的更改，关闭将丢失</span>
          <button className="md-btn md-btn-text md-btn-sm" onClick={onCancel}>放弃修改</button>
          <button className="md-btn md-btn-tonal md-btn-sm" onClick={() => setConfirmClose(false)}>继续编辑</button>
        </div>
      )}
      {add && (
        <div style={{ display: 'flex', gap: 8 }}>
          <div className={'md-chip' + (type === 'sentence' ? ' selected' : '')} onClick={() => setType('sentence')}>句子</div>
          <div className={'md-chip' + (type === 'section' ? ' selected' : '')} onClick={() => setType('section')}>分栏（标题）</div>
        </div>
      )}
      {isSection ? (
        <label>分栏标题<input style={field} value={content} onChange={e => setContent(e.target.value)} /></label>
      ) : (
        <>
          <label>内容（日语句子）<textarea rows={2} style={field} value={content} onChange={e => setContent(e.target.value)} /></label>
          <label>翻译<textarea rows={2} style={field} value={translation} onChange={e => setTranslation(e.target.value)} /></label>
          <label>注音（可选）<input style={field} value={ruby} onChange={e => setRuby(e.target.value)}
                 placeholder="完整句子 + 汉字读音，例：東京[とうきょう]へ行く" /></label>
          <div style={{ font: 'var(--md-sys-typescale-label-small)', color: 'var(--md-sys-color-on-surface-variant)', marginTop: -6 }}>
            注音需包含完整句子，在汉字后加 [读音]；留空则正文无注音。保存后正文以注音内容为准。
          </div>
        </>
      )}
      <label>标签（可选）<input style={field} value={tags} onChange={e => setTags(e.target.value)} /></label>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="md-btn md-btn-text" onClick={onCancel}>取消</button>
        <button className="md-btn md-btn-filled" disabled={!content.trim()}
                onClick={() => onSave(isSection
                  ? { content: content.trim(), translation: '', tags: '', ruby: '', type }
                  : { content: content.trim(), translation: translation.trim(), tags: tags.trim(), ruby: ruby.trim(), type })}>
          保存
        </button>
      </div>
    </div>
  );
}

export function NewCollectionModal({ onSave, onCancel }) {
  const [title, setTitle] = useState('');
  const [lang, setLang] = useState('ja');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <label>名称<input style={field} value={title} onChange={e => setTitle(e.target.value)} autoFocus /></label>
      <label>语言
        <select className="md-select" style={{ width: '100%' }} value={lang} onChange={e => setLang(e.target.value)}>
          <option value="ja">日语</option>
          <option value="en">英语</option>
          <option value="zh">中文</option>
        </select>
      </label>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="md-btn md-btn-text" onClick={onCancel}>取消</button>
        <button className="md-btn md-btn-filled" disabled={!title.trim()} onClick={() => onSave(title.trim(), lang)}>创建</button>
      </div>
    </div>
  );
}
