# ROYU 文档工具箱

一个基于 Vue 3 与 Vite 的本地文件处理应用，包含以下功能：

- 统一页面编辑：PDF 与图片共用文字、涂抹、取色、印章、移动与缩放工具，不再按上传类型切换编辑器。
- 分页与导出：PDF 保留全部页面，图片视为单页；两类文件均可导出完整 PDF 或当前页 PNG，各页独立保留图层和撤销记录。
- 离线 OCR：图片/PDF 预览、整页与框选识别、中英文语言包、TXT 结果下载。
- 导出 Word：PDF 和图片均可选择“导出 Word”，包含当前编辑，支持原生文字提取与扫描内容识别，并提供进度、取消和 DOCX 下载。
- JSON 格式化：语法校验、缩进、压缩、导入、复制与下载，保留大整数、键顺序和原始转义。
- XML 格式化：语法校验、缩进与压缩，保留混合文本、CDATA、注释和 `xml:space` 内容。

文件处理、PDF 渲染、图片编辑和 OCR 都在浏览器本地完成。

## 工作流程

首页 `/` 提供 PDF 工具、JSON 格式化、XML 格式化三个独立入口，地址分别为 `/pdf`、`/json`、`/xml`。PDF 工具使用一个 `DocumentEditor.vue` 编辑器处理 PDF 和图片，工具栏及属性功能完全共用；文件类型仅决定读取方式、页数和默认导出格式。旧的 `/image_tool`、`/ocr`、`/?tool=ocr` 入口仍可使用。

- 支持多个文件标签，每份文件独立保留编辑记录；关闭标签前提示保存。返回工具箱再进入，文件和格式化内容仍保留在内存中。
- 文字识别使用当前编辑版本，包含图片标注及 PDF 印章；未修改文件时，切换工具保留识别结果。
- 桌面使用工具侧栏、页面/图层、中央画布和属性面板；手机使用底部工具导航、属性抽屉和撤销/重做，画布随窗口尺寸适应。
- 支持深浅主题，处理引擎按需加载。
- PDF 和图片均默认使用移动工具，双指缩放取消尚未完成的误画；支持单指平移，桌面普通滚轮滚动，Ctrl/⌘＋滚轮缩放。
- PDF 导出保留原始页面和文字层，将新增编辑作为透明图像叠加，支持旋转页和裁剪框。新增文字在 PDF 中属于图像标注；Word 导出通过 OCR 识别这些标注。
- OCR 预览默认可滚动，点击“框选区域”后拖动选区；手机属性面板支持 Escape 关闭并恢复焦点。
- JSON/XML 支持 2/4 空格缩进及 Ctrl/⌘＋Enter，手机可切换输入与结果面板。输入限 2 MB，XML 与格式化 JSON 的结构深度限 256 层；XML 压缩只移除结构间排版空白，下载统一为 UTF-8。
- 文件及编辑记录保存在当前浏览器会话内，刷新或关闭页面前请导出需要保留的结果。

## 开发

```sh
npm install
npm run dev
```

## 生产构建

```sh
npm run build
npm run preview
```

部署时需要保留 `public/ocr-assets`，其中包含离线 OCR Worker、WASM 核心和语言包。

OCR 像素预处理回归测试：`node --test tests/ocrPixels.test.mjs`。

Word 导出回归测试：`node --test tests/wordExport.test.mjs`。转换策略、保真范围和验证说明见 [PDF 转 Word](docs/pdf-to-word.md)。

格式化回归测试：`node --test tests/formatters.test.mjs`。XML 原生解析器测试需启动开发服务，在浏览器控制台运行 `await (await import('/tests/formatters.browser.js')).testXmlFormatter()`。

界面及触摸已通过 Chrome 桌面和移动模拟检查；移动端文件保存/分享及 Safari 行为仍需实机验证。
