// 划选查词弹框（自带状态机：关闭后抑制同文本复现，滚动即关闭）
import React, { useState, useRef, useEffect } from 'react';
import { escHtml } from '../lib/text.js';
import { dictLinks, dictLinksEn } from '../lib/lookup.js';

export function SelectionPopup({ onLookUp }) {
  const [popup, setPopup] = useState(null);   // {text, jp, x, y, fixed}
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
  const links = popup.jp
    ? dictLinks(popup.text).map(l => ({ ...l, label: l.label === 'Jisho' ? 'Jisho 词典' : 'OJAD 音调' }))
    : dictLinksEn(popup.text);
  return (
    <div className="pitch-popup" style={{ position: popup.fixed ? 'fixed' : 'absolute', top: popup.y, left: popup.x }}>
      <div className="popup-word">{escHtml(popup.text)}</div>
      {links.map(l => (
        <a key={l.label} href={l.href} target="_blank" rel="noopener"><span className="mi" style={{ fontSize: 16 }}>{l.icon}</span>{l.label}</a>
      ))}
    </div>
  );
}
