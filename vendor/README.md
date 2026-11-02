# vendor — 本地化的前端依赖

让 OCAT++ 离线也能启动（首次打开不再依赖 CDN）。kuromoji 词典体积较大（约 17MB），
仍走 CDN 加载，加载失败时查词自动降级为 TinySegmenter（本地）。

| 文件 | 来源 | 许可 |
|---|---|---|
| sql-wasm.js / sql-wasm.wasm | https://sql.js.org/dist/ | MIT |
| marked.min.js | https://cdn.jsdelivr.net/npm/marked/ | MIT |
| tiny-segmenter.js | https://cdn.jsdelivr.net/npm/tiny-segmenter@0.2.0/dist/tiny-segmenter-0.2.0.js | MIT |
| kuromoji.min.js | https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/build/kuromoji.min.js | Apache-2.0 |
| material-icons.woff2 | https://fonts.gstatic.com/s/materialicons/ (v145) | Apache-2.0 |

> 注意：kuromoji 的词典 `dicPath` 仍指向 jsDelivr（见 index.html 启动代码）。
