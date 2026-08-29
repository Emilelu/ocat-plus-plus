// 构建后把单文件产物复制到项目根目录，保持「双击根目录 index.html」的使用习惯
import { copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
copyFileSync(join(root, 'app', 'dist', 'index.html'), join(root, 'index.html'));
console.log('✅ 已生成单文件 index.html ->', join(root, 'index.html'));
