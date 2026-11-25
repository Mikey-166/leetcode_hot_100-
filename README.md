# AlgoForge · 力扣 Hot 100 四语言精讲 & 华为实习冲刺教学平台（网页版）

根据《大三备战华为实习：算法突围与面试通关全攻略》与《LeetCode 热题 100 全 100 题分类精讲手册》打造的跨端网页版教学平台。

---

## 一、 首次克隆后的环境准备

为保持仓库精简轻量，体积较大的编译工具链（`tools/`）与个人运行数据（`data/`）未纳入版本库。克隆本仓库后，请按需准备以下环境：

* **Python 环境（必需）**：需要 **Python 3.10+**。服务端仅依赖 Python 标准库，无需执行 `pip install`。
* **Java 判题环境（按需）**：如需运行 Java 题目判题，请安装 **JDK 17+**，并确保 `javac` 与 `java` 已加入系统 `PATH` 环境变量。
* **C / C++ 判题环境（可选）**：如需运行 C / C++ 题目判题，请从 [WinLibs](https://winlibs.com/) 下载 x86_64 架构的 MinGW-w64（UCRT 或 MSVCRT 均可），解压放置使目录结构为 `tools/mingw64/bin/g++.exe`。
* **公网跨网同步隧道（可选）**：如需在 4G/5G 异地网络下通过公网临时域名与手机同步，请从 [Cloudflare cloudflared Releases](https://github.com/cloudflare/cloudflared/releases) 下载 `cloudflared-windows-amd64.exe`，重命名为 `tools/cloudflared.exe`。
* **数据目录说明**：`data/` 目录会在首次启动服务时自动创建（包含本地 SQLite 数据库 `platform.db` 与 8 位访问口令 `sync_token.txt`），不会进入版本库。

---

## 二、 快速启动

1. 双击根目录下的 **[`启动网页版.bat`](./启动网页版.bat)**（或在终端运行 `python server.py`）；
2. 浏览器会自动打开 `http://127.0.0.1:8765`；
3. 您的所有打卡记录、学习计划、笔记与判题记录均实时保存在 `data/platform.db`。

---

## 三、 苹果 iOS / 安卓 Android 手机端下载与安装

已将手机端下载与安装功能直接内置在网页右上角 **「📲 下载手机版 (iOS / Android)」** 中：

* **🤖 安卓 Android**：支持在手机浏览器内一键安装为全屏桌面 App（自动离线缓存），或直接点击下载安卓离线单文件版（`.html`）。
* **🍎 苹果 iOS**：内置 Safari 三步「添加到主屏幕」引导，全屏沉浸运行，同样支持直接下载 iOS 离线单文件版（`.html`）。
* **📡 多设备实时同步**：支持局域网与公网隧道（`tools/cloudflared.exe`）记录级增量双向同步，手机打卡后电脑端自动同步更新。

---

## 四、 力扣式四语言在线判题（Python / C++ / Java / C）

每道题的 **「✍️ 15分钟白板手撕默写」** 面板均支持标准函数模板插入、公开样例运行、全量用例提交判题，AC 后自动标记掌握并同步至打卡进度。

---

## 五、 目录结构说明

* `web/`：网页版前端页面、样式、Hot 100 题库、日程与手机端下载安装模块
* `server.py`：网页版后端服务（静态托管、多端同步、AST 解析、判题接口与在线打包下载）
* `judge/`：100 道题的判题运行引擎与标准测试用例数据
* `tools/`：公网同步隧道（`cloudflared.exe`）与 C/C++ 判题编译器（`mingw64`）（需按第一节自行放置）
* `data/`：本地 SQLite 进度数据库与同步口令（首次运行自动生成）
* `启动网页版.bat`：Windows 一键启动脚本
