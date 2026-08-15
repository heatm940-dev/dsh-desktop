# DeepSeek Harness Desktop

**DeepSeek Harness (`dsh`) 的一键安装桌面应用，Windows + macOS 双平台，带自动更新。**

DeepSeek 官方的 Harness 是一个开源、插件化的 Agent 框架（`npx @deepseek-ai/dsh web` 起一个本地浏览器 UI）。本项目把同样的体验打包成原生的桌面 App —— 用户装一次，从此跟着 release 通道自动升级。

> 主仓库：<https://github.com/deepseek-ai/deepseek-harness>
> 本项目是打包外壳，**所有 AI 能力均来自上游 dsh**。

---

## 架构

```
┌────────────────────────────────────────────────────────────┐
│  Electron 窗口（Chromium）                                  │
│  加载 http://127.0.0.1:<port>                              │
└───────────────▲────────────────────────────────────────────┘
                │ (HTTP, 127.0.0.1 only)
┌───────────────┴────────────────────────────────────────────┐
│  dsh web 服务（spawn 自 Electron 主进程）                  │
│  - 由内嵌标准 Node 22 启动，避免 Electron Node ABI 冲突     │
│  - 只绑回环地址（dsh 原生拒绝 0.0.0.0）                    │
│  - 配置/会话/Profile 全部落在 app userData 目录下          │
└───────────────▲────────────────────────────────────────────┘
                │ 来自 resources/dsh/node_modules
┌───────────────┴────────────────────────────────────────────┐
│  打包资源（resources/）                                     │
│  - node-runtime/{node|node.exe}   嵌入式标准 Node 22.22.2 │
│  - dsh/                            完整 @deepseek-ai/dsh │
│                                     + 其全部 dependencies │
└────────────────────────────────────────────────────────────┘
```

为什么不让 Electron 自己跑 dsh？dsh 依赖里含 N-API 原生模块（`node-addon-require-builtin`），它们的 ABI 与 Electron 内置的 Node 不一定兼容。把 dsh 放在独立的、官方编译的标准 Node 运行时里跑，是最稳的选择；Electron 只做"窗口 + 自动更新"两个职责。

---

## 项目结构

```
dsh-desktop/
├── electron/
│   ├── main.cjs          # 主进程：spawn dsh、窗口、菜单、单例锁
│   ├── updater.cjs       # electron-updater 封装
│   └── preload.cjs       # contextBridge，向页面暴露平台/版本
├── build/
│   ├── gen_icon.py       # 生成 1024x1024 PNG 图标
│   └── icon.png
├── resources/
│   ├── node-runtime/     # npm run fetch:node 拉入
│   └── dsh/              # cd resources/dsh && npm install @deepseek-ai/dsh
├── scripts/
│   └── fetch-node.mjs    # 跨平台下载 Node 22 运行时
├── electron-builder.yml  # 打包配置（NSIS + dmg/zip + GitHub Releases）
└── .github/workflows/
    ├── ci.yml            # PR 冒烟测试
    └── release.yml       # 打 tag 自动构建并发布
```

---

## 开发

### 一键环境准备（推荐）

```bash
git clone <your-fork>.git dsh-desktop && cd dsh-desktop
npm install
npm run setup
```

`npm run setup` 是一条命令搞定所有事：

1. 拉取内嵌 Node 22 运行时到 `resources/node-runtime/`
2. 在 `resources/dsh/` 装 `@deepseek-ai/dsh`（含完整依赖树，**约 130+ 包**——国内网络请耐心等 5-15 分钟，海外 1-2 分钟）
3. 跑 smoke test 验证 `dsh web` 能起、能访问

完成后再 `npm run dev` 即可起应用。

> 默认用 npmmirror 镜像。`--registry=https://registry.npmjs.org` 可切回官方源。

### 手动环境准备（分解版）

```bash
# 1. 装 Electron 壳
npm install

# 2. 拉内嵌 Node
npm run fetch:node

# 3. 装 dsh
cd resources/dsh
npm init -y
npm install @deepseek-ai/dsh@0.1.0-rc.6 --omit=dev
cd ../..

# 4. 验证
npm run verify:dsh
```

### 不装 dsh 跑壳（开发/CI 用）

如果只想验证 Electron 壳能跑、配置语法 OK，**不用**装 100+ 包的 dsh：

```bash
node scripts/mock-dsh.mjs   # 写入一个最小 mock dsh（含可工作的 web server）
npm run dev                 # 启动会显示提示：「请跑 npm run setup 装真 dsh」
```

mock 会起来一个真 HTTP server 在 127.0.0.1:3080，返回占位页；它只是用来打通打包流程和 UI smoke test。生产前请用 `npm run setup` 替换成真实 dsh。

### 本地开发模式

```bash
npm run dev
```

直接拉起 Electron 窗口，连接 `resources/dsh` 里的 dsh 进程。改 `electron/*.cjs` 后重启即生效；改 dsh 自身（更新版本）需要重新 `npm install`。

### 修改内嵌 dsh 版本

```bash
cd resources/dsh
npm install @deepseek-ai/dsh@<新版本> --omit=dev
# 同步更新 package.json 的 scripts（如有需要）
```

---

## 打包

```bash
# Windows 安装包
npm run dist:win
# → dist/DeepSeek Harness Desktop-0.1.0-windows-x64.exe

# macOS dmg + zip（必须 macOS 主机）
npm run dist:mac
# → dist/...-mac-x64.dmg / .zip
# → dist/...-mac-arm64.dmg / .zip
```

打包结果在 `dist/`，体积通常 100~150MB（主要是 dsh 自身依赖 + 内嵌 Node）。

---

## 自动更新

本项目使用 [`electron-updater`](https://www.electron.build/auto-update)，发布源配置为 **GitHub Releases**（在 `electron-builder.yml` 的 `publish` 段）。

### Windows

- 安装包：NSIS `.exe`（带 differential update，只下载差异）
- 启动时静默检查更新；发现新版本时下载完后弹窗「立即重启 / 稍后」
- Windows 下未签名也能跑自动更新，SmartScreen 仍会提示用户「未知发布者」，但更新机制本身可用

### macOS

- 安装器：dmg（首次安装）
- 更新包：zip（electron-updater 增量更新用 zip，dmg 不可增量）
- ⚠️ **macOS 自动更新需要 Developer ID 签名**。未签名的构建在用户机器上能装但自动更新会被 Gatekeeper 拦下。
- 签名所需 secrets（加到 GitHub repo Settings → Secrets）：
  - `CSC_LINK` — `.p12` 证书的 base64
  - `CSC_KEY_PASSWORD` — 证书密码
  - `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` — 用于公证

### 发新版本

```bash
# 在 main 分支：改 package.json -> version: 0.1.1
# 提交并推送
git commit -am "release: 0.1.1"
git push origin main

# 打 tag → 触发 release workflow → 三个 runner 并行构建 → 汇总到 GitHub Release
git tag v0.1.1
git push origin v0.1.1
```

`release.yml` 会：

1. 在 `windows-latest` 上产 `*-windows-x64.exe` + `latest.yml`
2. 在 `macos-13` 上产 `*-mac-x64.dmg/zip` + `latest-mac.yml`
3. 在 `macos-14` 上产 `*-mac-arm64.dmg/zip` + `latest-mac.yml`
4. 用软连接把它们 attach 到对应 tag 的 GitHub Release

> ⚠️ **Repository owner/repo**：`electron-builder.yml` 里用 `${env.GH_OWNER}` / `${env.GH_REPO}` 动态注入。CI 会用 `github.repository_owner` + repo name。如果你 fork 到自己名下，无需改文件，CI 会自动用你 fork 的 owner/repo 作为发布源。

---

## 用户使用

### 安装

- **Windows**：从 Release 下载 `DeepSeek Harness Desktop-x.y.z-windows-x64.exe`，双击安装（可选安装路径）。
- **macOS**：下载 `.dmg`，拖到 Applications。首次启动需在「系统设置 → 隐私与安全性」点击「仍要打开」（未公证时）。

### 首次配置

1. 启动后，UI 提示配置 API Key（Settings → Models → DeepSeek）。也可以接任何 OpenAI 兼容服务。
2. 在 UI 右上角「选择工作区」指定 Agent 操作的目录。
3. 派活。每次启动会检查更新，下载完成后弹窗询问「立即重启」。

### 数据位置

- Windows：`%APPDATA%\DeepSeek Harness Desktop\dsh-home\`（配置/会话/Profile）
- macOS：`~/Library/Application Support/DeepSeek Harness Desktop/dsh-home/`

（应用菜单「帮助 → 打开数据目录」可一键直达。）

---

## 故障排查

| 现象 | 处理 |
|---|---|
| 启动后白屏/一直转 | dsh 服务未就绪；查看终端 stdout（`./resources/dsh/.../lib/bin.js` 的输出会透传到主进程 console）。先手动 `node resources/node-runtime/node.exe resources/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js web --host 127.0.0.1 --port 3080` 验证。 |
| `Embedded Node runtime not found` | 跑 `npm run fetch:node`；或在 CI 触发 `.github/workflows/ci.yml` 前的 setup 步骤没跑。 |
| macOS 自动更新不工作 | 缺签名 secrets。`autoUpdater` 会静默 no-op，确认 GitHub Secrets 已配置 `CSC_LINK` 等。 |
| 端口 3080 冲突 | 应用启动时从 3080 开始向上扫描空闲端口（最多到 65535）。如果全占，杀掉本机 3080 附近占用即可。 |
| 想清空会话重新开始 | 删除「数据目录」（位置见上），重启应用。 |

---

## 许可

Electron 外壳代码：MIT。dsh 自身：MIT（© DeepSeek AI）。
图标为本项目原创，与 DeepSeek 官方 logo 区分。
