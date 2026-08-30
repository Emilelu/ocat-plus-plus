// 各类模态框内容（纯展示，确认/取消/复制等动作由 props 注入）
import { marked } from 'marked';
import { escHtml, stripMarkdown, preprocessLangBlocks } from '../lib/text.js';
import { dictLinks, dictLinksEn } from '../lib/lookup.js';
import { syncCmd } from '../lib/view.js';

export function ConvModal({ conv, onCopy }) {
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

export function LookupModal({ modal }) {
  return (
    <>
      <div style={{ font: 'var(--md-sys-typescale-label-small)', color: 'var(--md-sys-color-on-surface-variant)', marginBottom: 12 }}>
        点击单词跳转词典 · 也可以手动划选句子中的文字
      </div>
      {modal.words.map(({ word, base }, i) => {
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

export function ImportModal({ modal, onConfirm, onClose }) {
  return (
    <div style={{ padding: 0 }}>
      <div style={{ font: 'var(--md-sys-typescale-title-medium)', marginBottom: 12 }}>选择要导入的收藏夹</div>
      {modal.rows.map((r) => (
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

export function SyncHelpModal({ onCopy, onClose }) {
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

export function ConfirmModal({ message, onConfirm, onCancel }) {
  return (
    <div style={{ textAlign: 'center', padding: 8 }}>
      <div style={{ fontSize: 40, marginBottom: 12, color: 'var(--md-sys-color-error)' }}><span className="mi" style={{ fontSize: 40 }}>warning</span></div>
      <div style={{ font: 'var(--md-sys-typescale-body-medium)', marginBottom: 20, whiteSpace: 'pre-wrap' }}>{message}</div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
        <button className="md-btn md-btn-text" onClick={onCancel}>取消</button>
        <button className="md-btn md-btn-filled" style={{ background: 'var(--md-sys-color-error)' }} onClick={onConfirm}>删除</button>
      </div>
    </div>
  );
}
