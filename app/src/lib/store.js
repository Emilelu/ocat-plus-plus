// localStorage 封装
export const store = {
  get(k, d) {
    try { const v = localStorage.getItem('ocat_' + k); return v === null ? d : v; } catch { return d; }
  },
  set(k, v) {
    try { localStorage.setItem('ocat_' + k, String(v)); } catch {}
  },
  del(k) {
    try { localStorage.removeItem('ocat_' + k); } catch {}
  },
};
