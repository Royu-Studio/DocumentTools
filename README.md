# ROYU 文档工具箱

一个基于 Vue 3 与 Vite 的本地文件处理应用，包含以下功能：

- 统一页面编辑：PDF 与图片共用文字、涂抹、取色、印章、移动与缩放工具，不再按上传类型切换编辑器。
- 分页与导出：PDF 保留全部页面，图片视为单页；两类文件均可导出完整 PDF 或当前页 PNG，各页独立保留图层和撤销记录。
- 离线 OCR：图片/PDF 预览、整页与框选识别、中英文语言包、TXT 结果下载。
- 导出 Word：PDF 和图片均可选择“导出 Word”，包含当前编辑，支持原生文字提取与扫描内容识别，并提供进度、取消和 DOCX 下载。
- JSON 格式化：语法校验、缩进、压缩、导入、复制与下载，保留大整数、键顺序和原始转义；新增可展开的对象/数组检查器。
- XML 格式化：语法校验、缩进与压缩，保留混合文本、CDATA、注释和 `xml:space` 内容；结构树显示属性、重复元素、文本及命名空间。

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
- JSON/XML 支持 2/4 空格缩进及 Ctrl/⌘＋Enter，手机可切换输入与结果面板。输入限 2 MB，XML 与 JSON 的结构深度限 256 层；XML 压缩只移除结构间排版空白，下载统一为 UTF-8。
- 格式化后可切换“树视图 / 文本”；选中节点后复制值、原始子树或定位路径，支持全部展开/折叠及方向键。字符串值解码，数字保持原始拼写，重复 JSON 键按 `#1/#2` 区分。XML 元素“复制值”补齐继承命名空间，“复制子树”保留原文。路径为检查器定位表示，不承诺是通用 JSONPath/XPath 表达式。
- 树模型最多 100,000 节点，树列表每页最多 300 行；超过树限制时保留文本结果并显示原因。排版后文本最多 16 MB，可改用压缩。输入修改、导入、校验失败或清空时立即移除旧树。剪贴板不可用时提供选中的手动复制内容。
- XML 不请求外部资源：外部 DTD、外部实体、参数实体、嵌套实体被拒绝；简单内部字面量实体仍可格式化为文本，但树视图不支持自定义实体，会明确提示。
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

全量 Node 回归测试：`npm test`。格式化与树模型测试也可单独运行：`node --test tests/formatters.test.mjs tests/formatterTree.test.mjs`。

原生浏览器解析器与界面回归：启动开发服务，在浏览器控制台分别运行：

```js
await (await import('/tests/formatters.browser.js')).testXmlFormatter()
await (await import('/tests/formatterTree.browser.js')).testFormatterTree()
await (await import('/tests/formatterInspector.browser.js')).testFormatterInspector()
await (await import('/tests/formatterInspector.browser.js')).testXmlInspector()
```

界面测试使用隔离的 Vue 挂载点，并临时模拟剪贴板的成功/失败响应；最终会恢复剪贴板属性。实际系统剪贴板、桌面/移动布局仍需浏览器交互检查。

界面及触摸已通过 Chrome 桌面和移动模拟检查；移动端文件保存/分享及 Safari 行为仍需实机验证。

## 多工作区标签

顶部标签栏可新建多个独立 JSON、XML、PDF / 图片工作区；同一工具可同时处理不同数据。单击切换，双击标题或按 F2 重命名，左右方向键 / Home / End 导航，Delete 关闭当前标签。手机标签栏可横向滚动，右侧“＋”打开工具选择器。

- 工作区保留各自的输入、格式化结果、树节点选择、文件、图层和撤销记录；切换不会重建组件。PDF / 图片工作区内部仍可打开多个文件。
- 有文本、文件或处理任务时，关闭前提示先下载；取消关闭不改变工作区。关闭最后一个标签返回工具箱。刷新或关闭网页会丢失会话内容，不自动将文档写入 localStorage、IndexedDB 或服务器。
- 每个工作区有独立 `?workspace=` 标识；后退 / 前进切换已有工作区。已关闭标签在本次会话的历史记录中不会复活；新浏览器会话打开旧链接会创建空工作区，不会恢复文件。
- 同时最多 12 个工作区，达到上限会提示，绝不自动淘汰旧工作区。大 PDF / OCR 仍可能占用较多内存，请导出并关闭不用的文件。导出 Word 弹窗打开时，先取消 / 完成并关闭弹窗再切换工作区。

### 为新工具接入工作区

在 `src/workspaces/registry.js` 添加唯一 `id`、`path`、异步 `load` 与展示信息，即自动加入主页、路由和新建菜单。组件接收 `workspaceId`、`active` 和 `initialMode`；数据必须留在自己的组件 / 实例作用域内。不要使用跨实例单例存储文档内容。

通过 `defineExpose({ hasContent: () => ... })` 告知关闭 / 刷新提示；未实现时保守提示。可选 `canDeactivate()` 只用于需先关闭的模态窗口。所有全局键盘、粘贴、拖拽监听均检查 `active`；DOM ID 包含 `workspaceId`；卸载取消异步任务、销毁 worker / PDF task 并回收 object URL。切换仅隐藏实例，关闭才卸载；不要借路由路径判断工具是否激活。

真实 Vue 组件回归（启动 Vite 后在浏览器控制台运行）：

```js
await (await import('/tests/workspaces.browser.js')).testWorkspaces()
```

该测试临时模拟关闭确认，不替代桌面 / 手机视觉检查或真实 PDF、OCR 引擎测试。

工作区生命周期回归：`await (await import('/tests/workspaceLifecycle.browser.js')).testWorkspaceLifecycle()`。额外的延迟 PDF / OCR 引擎竞态测试可在安装可选开发测试依赖 `jsdom` 后运行 `node tests/run-workspace-lifecycle.mjs`；也可通过 `JSDOM_MODULE` 指向已有 jsdom 模块。此模拟测试验证资源释放、事件隔离和组件状态，不验证真实 PDF 渲染或 OCR 准确度。
