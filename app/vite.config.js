import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// 全部资源内联进单个 index.html，双击即用
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    // 关闭自动清空 outDir：本机 safe-delete 拦截 rmSync 会导致构建失败，改由构建前手动 rm -rf dist
    emptyOutDir: false,
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 100000000,
    cssCodeSplit: false
  }
});
