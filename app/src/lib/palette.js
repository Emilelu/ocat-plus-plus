// 随机配色：随机色相 → Material You 风格的强调色 token
// 只替换 primary 系 4 组 token（明暗各一套），中性色保持不变
import { store } from './store.js';

const VARS = (h) => ({
  // 浅色
  '--pal-primary-l': `hsl(${h} 45% 40%)`,
  '--pal-on-primary-l': '#ffffff',
  '--pal-primary-container-l': `hsl(${h} 70% 88%)`,
  '--pal-on-primary-container-l': `hsl(${h} 75% 20%)`,
  // 深色
  '--pal-primary-d': `hsl(${h} 65% 72%)`,
  '--pal-on-primary-d': `hsl(${h} 80% 14%)`,
  '--pal-primary-container-d': `hsl(${h} 45% 32%)`,
  '--pal-on-primary-container-d': `hsl(${h} 70% 88%)`,
});

export function getHue() {
  const v = store.get('hue', '');
  return v === '' ? null : parseInt(v, 10);
}

export function applyPalette(hue) {
  const root = document.documentElement;
  if (hue === null || hue === undefined || isNaN(hue)) {
    root.removeAttribute('data-pal');
    store.del('hue');
    for (const k of Object.keys(VARS(0))) root.style.removeProperty(k);
    return null;
  }
  root.setAttribute('data-pal', String(hue));
  store.set('hue', hue);
  const vars = VARS(hue);
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  return hue;
}

export function randomHue() {
  return Math.floor(Math.random() * 360);
}
