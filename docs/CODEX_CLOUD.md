# Codex Cloud 配置

本项目是 Windows 桌面应用。Codex Cloud 适合修改源码、检查 JavaScript、运行 Rust 静态检查和准备提交；Windows EXE、系统托盘、WebView2 弹窗、多显示器位置与图标缓存仍需在 Windows 实机验证。

## 创建环境

1. 在 Codex 中选择 **Work in → Cloud → Create environment**。
2. 选择私有仓库 `Ebenezer0921/jishi-reminder`。
3. 允许 **Package managers** 网络访问。Rust 依赖需要：
   - `crates.io`
   - `index.crates.io`
   - `static.crates.io`
   - `static.rust-lang.org`
4. 将安装脚本设置为：

```bash
bash .codex/cloud-setup.sh
```

5. 设置完成并测试后，保存并 **Publish**。

## 建议的 Start skill

```text
先阅读根目录 AGENTS.md 和 README.md。保留 Tauri 2、Rust、原生 HTML/CSS/JavaScript，不引入新 UI 框架。先运行 bash .codex/cloud-verify.sh；若 Linux 环境因 Windows 专用 API 无法完成 Rust 检查，至少运行所有 frontend JavaScript 的 node --check，并明确标注 Windows 实机构建尚未验证。不要创建或写入真实 reminders.json。
```

## 验证命令

```bash
bash .codex/cloud-verify.sh
```

Windows 发布构建仍使用：

```powershell
.\build.cmd
```

## 数据安全

Codex Cloud 环境不需要任何提醒数据或密钥。不要上传 `%APPDATA%/com.jishi.reminder/reminders.json`。若未来接入私有服务，使用环境变量或 Network secrets，不要把凭据写入仓库。
