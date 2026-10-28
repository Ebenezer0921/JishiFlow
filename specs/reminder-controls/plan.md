# 实施计划

- 第一批：共享 `time-controls.js/css`。用原生小输入框形成明确时间分段，仍保留原 datetime-local/time 控件作为值与系统选择器；避免依赖不可读取的 WebView2 内部选中段。设置数字框统一非被动 wheel 处理，边界也消费事件。
- 第二批：Settings 新增 `tomorrowReminderTime`、`popupGap`、`popupMargin`，均有 serde 默认值与校验。延后页新增并排快捷项和本次时间展开区；复用 popup_snooze，不改调度任务。
- 第三批：定位函数读取新的间距参数，保存布局设置后仅重排自动分组；不强制归位拖动过的卡片。共享样式保持 MD3。
- 检查：Node 日期/控件事件与动作派发测试、Rust 旧数据/设置/几何测试、语法与差异检查，release 构建，Windows 代表场景验证。版本 2.3.0。
- 发布：保护原 EXE、真实数据和 Git 基线；不上传真实数据、截图或构建缓存；验证后将源码、问题编号与报告同步 GitHub。

设计依据：已实际读取 ykk648/design-intent 的 README、SKILL、references/visual-cases.md、references/source-notes.md。主要采用 C01 阅读顺序、C02 分组、C06 密度、C09 原生控件仍需整理及 C10 主动作顺序，不把“AI味”当作可测试缺陷。
