# kcptun 加速插件集成

把 kcptun **client** 作为 sidecar 内置进 clash-verge-rev，形成 `clash → kcptun → 真实代理` 的 KCP/UDP 加速链路。远端配套的 kcptun **server** 部署套件见 kcptun 仓库 `deploy/`。

## 1. 架构（单上游）

```
[本机 clash-verge-rev]                                  [远端 Linux VPS]
 应用流量 → mihomo(选中节点 server=127.0.0.1:LPORT)       kcptun-server(:QPORT/udp)
          → kcptun-client(sidecar, 监听 127.0.0.1:LPORT) ─KCP/UDP─→ → target=真实代理:PPORT
                                                                    → ss/vmess/trojan → 互联网
```

设计决策：
- **单上游**：一个 kcptun client → 一个远端 server，最简单可靠。
- **手动接线**：用户把要加速的 clash 节点 `server` 改为 `127.0.0.1:LPORT`；应用只负责拉起/守护 kcptun 与提供配置面板，不自动改写 mihomo 配置（健壮、透明、不随订阅更新失效）。
- **直接 args 传参**（非 `-c json`）：无临时文件、无清理、配置变更即重启 spawn。
- kcptun client **必须在 mihomo 之前启动**，退出时随应用一起 kill（避免孤儿进程）。
- 两端 `key/crypt/mode/datashard/parityshard` 必须一致。

## 2. 改动清单

后端（Rust，`src-tauri/`）：
- `src/core/kcptun.rs`（新增）— `KcptunManager` 单例，复刻 `CoreManager` 的 sidecar 拉起/守护/kill 模式。
- `src/core/mod.rs` — 注册 `pub mod kcptun` 并导出 `KcptunManager`。
- `src/config/verge.rs` — `IVerge` 增 `enable_kcptun / kcptun_local_port / kcptun_remote_addr / kcptun_key / kcptun_crypt / kcptun_mode / kcptun_conn / kcptun_extra_args`（struct + patch + template 默认值）。
- `src/cmd/kcptun.rs`（新增）+ `src/cmd/mod.rs` — IPC 命令 `restart_kcptun / stop_kcptun / get_kcptun_running`。
- `src/lib.rs` — 在 `generate_handlers` 注册上述命令。
- `src/utils/resolve/mod.rs` — 启动钩子 `init_kcptun()`，在 `init_core_manager()` 之前调用。
- `src/feat/window.rs` — 退出清理 `clean_async()` 增加 kcptun 停止任务。
- `tauri.conf.json` — `bundle.externalBin` 增 `sidecar/kcptun-client`。

前端（`src/`）：
- `types/global.d.ts` — `IVergeConfig` 增对应 kcptun 字段。
- `services/cmds.ts` — `restartKcptun / stopKcptun / getKcptunRunning` 封装。
- `components/setting/mods/kcptun-viewer.tsx`（新增）— 配置对话框。
- `components/setting/setting-kcptun.tsx`（新增）— 设置区（开关 + 配置入口 + 运行状态）。
- `pages/settings.tsx` — 挂载 `SettingKcptun`。

构建（`scripts/`）：
- `scripts/prebuild.mjs` — 新增 kcptun task：按目标 triple 从源码 `go build` 出 `sidecar/kcptun-client-<triple>[.exe]`（纯 Go 无 CGO）。源码默认在同级 `../kcptun`，可用环境变量 `KCPTUN_SRC` 覆盖。

## 3. 构建

前提：sidecar 源码 kcptun 仓库在同级目录（或设 `KCPTUN_SRC`）。

Linux 本机：
```bash
pnpm install
pnpm run prebuild              # 下载 mihomo + 从源码构建 kcptun-client sidecar
pnpm build                     # tauri build → deb/rpm
```

Windows 包有两条路径：

**A. CI（最省心，原生工具链出已签名分发包）**：工作流 `.github/workflows/windows-kcptun.yml`（手动触发，windows-latest）。

**B. Linux 本机交叉编译（已在本仓库验证可出 NSIS 安装包）**：
```bash
# 一次性工具链
rustup target add x86_64-pc-windows-msvc
cargo install --locked cargo-xwin           # 自动下载 Windows SDK/CRT
sudo apt-get install -y clang lld llvm nsis  # clang-cl / lld-link / llvm-lib / makensis
sudo ln -sf /usr/bin/clang /usr/local/bin/clang-cl   # cargo-xwin 需要 clang-cl 名
# NSIS 服务插件（tauri 模板用 SimpleSC 管理 clash-verge-service）
sudo cp Local/NSIS/SimpleSC.dll /usr/share/nsis/Plugins/x86-unicode/   # 由 prebuild 下载

# 构建
pnpm install
KCPTUN_SRC=/path/to/kcptun pnpm run prebuild x86_64-pc-windows-msvc    # 含 kcptun + 真实 mihomo
KCPTUN_SRC=/path/to/kcptun CARGO_BUILD_JOBS=$(nproc) \
  pnpm tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc -- --profile fast-release
# 产物：target/x86_64-pc-windows-msvc/fast-release/bundle/nsis/Clash Verge_*_x64-setup.exe
```
说明：① `fast-release` profile 编译快（codegen-units=64、无 LTO），出**未优化**包；分发请用默认 `release`（codegen-units=1+thinLTO）或 CI。② 末尾 updater 签名步骤会因缺 `TAURI_SIGNING_PRIVATE_KEY` 报错，但**安装包已在此之前生成**；个人构建可忽略，或设 `createUpdaterArtifacts:false`。③ `--no-bundle` 可只出 `clash-verge.exe` 不打包。

kcptun 的 Windows 二进制本身纯 Go，可在任意平台交叉编译：
```bash
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -o kcptun-client.exe ./client
```

## 4. 使用

1. 远端 VPS 部署 server：见 kcptun 仓库 `deploy/`（`KCPTUN_TARGET=真实代理 KCPTUN_KEY=密钥 sudo -E ./deploy/deploy-server.sh`）。
2. 应用「设置 → kcptun 加速」：开启开关；在「kcptun 配置」填远端地址 `VPS:QPORT`、相同 `key/crypt/mode`、本地端口 `LPORT`。
3. 把要加速的 clash 节点 `server` 改为 `127.0.0.1:LPORT`（端口/类型/加密与真实代理一致）。
4. 选中该节点即走 kcptun 加速。

## 5. 已知限制 / 后续

- `kcptun_key` 当前明文存于 `verge.yaml`（可后续接 `serialize_encrypted` 加密，参考 webdav 字段）。
- UI 文案为字面中文，未接入 i18n locale（后续可补 `t()` 键）。
- prebuild 的 kcptun 源码默认同级目录；CI 用 `KCPTUN_SRC` 指定。
