# 及时提醒

一个完全本地运行的 Windows 桌面提醒程序，使用 Tauri、Rust 和 Windows WebView2 构建。

当前版本：`2.2.0`

## 功能

- 单条或批量创建提醒
- 为提醒添加本地图片，支持选择、拖入或 Ctrl+V 粘贴
- 到点弹窗、延后提醒、完成与无需提醒
- 多条到期提醒纵向堆叠显示
- 托盘驻留与开机启动
- 提醒位置、卡片大小、文字大小、字体和透明度设置
- 设置效果预览与倒计时进度条
- 事项与备注搜索、定位高亮
- JSON 导入与导出
- 数据仅保存在本机，无需登录

## 项目结构

- `frontend/`：HTML、CSS 和 JavaScript 界面
- `src-tauri/`：Rust 桌面端、托盘和提醒调度逻辑

## 本地构建

需要 Windows、Rust 工具链、Cargo、Tauri 依赖和 WebView2 Runtime。

```powershell
cd src-tauri
cargo build --release
```

生成的程序位于 `src-tauri/target/release/jishi-reminder.exe`。

## 数据与隐私

提醒数据写入系统应用数据目录，不保存在仓库内，也不会自动上传或同步。

## Codex Cloud

仓库包含 [Codex Cloud 配置说明](docs/CODEX_CLOUD.md) 和可复用的环境准备脚本 `.codex/cloud-setup.sh`。Codex Cloud 可以进行源码修改、前端语法检查和跨平台静态检查；Windows EXE 的最终构建与实机托盘/弹窗验证仍需在 Windows 上完成。
