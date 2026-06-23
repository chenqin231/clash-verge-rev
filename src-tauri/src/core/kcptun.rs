//! kcptun client sidecar 进程管理（单上游加速）。
//!
//! 拉起一个 kcptun client：本地监听 `127.0.0.1:<port>`，经 KCP/UDP 隧道连到远端
//! kcptun server。把 mihomo 中要加速的节点 `server` 指向该本地端口即可生效。
//!
//! 设计与 `core::manager::CoreManager` 的 sidecar 管理同构：
//! `Handle::app_handle()` → `.shell().sidecar().args().spawn()` → 异步消费事件 →
//! `ArcSwapOption<CommandChild>` 持有 → `child.kill()` 停止。

use crate::config::Config;
use crate::core::handle::Handle;
use crate::process::AsyncHandler;
use crate::singleton;
use anyhow::{Result, bail};
use arc_swap::ArcSwapOption;
use std::sync::Arc;
use tauri_plugin_shell::ShellExt as _;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};

/// sidecar 名称，必须与 tauri.conf.json 的 `bundle.externalBin` 登记名一致
const KCPTUN_SIDECAR: &str = "kcptun-client";
const DEFAULT_LOCAL_PORT: u16 = 12948;
const DEFAULT_CRYPT: &str = "aes";
const DEFAULT_MODE: &str = "fast";

#[derive(Default)]
pub struct KcptunManager {
    child: ArcSwapOption<CommandChild>,
}

impl KcptunManager {
    fn new() -> Self {
        Self::default()
    }

    /// 应用启动钩子：开启则拉起，失败只告警不阻断主流程
    pub async fn init(&self) -> Result<()> {
        if let Err(e) = self.start().await {
            log::warn!(target: "app", "[kcptun] 启动失败: {e}");
        }
        Ok(())
    }

    /// 当前是否在运行
    pub fn is_running(&self) -> bool {
        self.child.load().is_some()
    }

    /// 读取最新配置并（按需）拉起 kcptun client。幂等：先停旧进程。
    /// `enable_kcptun != Some(true)` 时跳过且不算错误。
    pub async fn start(&self) -> Result<()> {
        self.stop().await;

        let verge = Config::verge().await.data_arc();
        if verge.enable_kcptun != Some(true) {
            log::info!(target: "app", "[kcptun] 未开启，跳过启动");
            return Ok(());
        }

        let remote = verge
            .kcptun_remote_addr
            .clone()
            .map(|s| s.to_string())
            .unwrap_or_default();
        let key = verge.kcptun_key.clone().map(|s| s.to_string()).unwrap_or_default();
        if remote.trim().is_empty() {
            bail!("kcptun 已开启但未配置远端地址 (kcptun_remote_addr)");
        }
        if key.trim().is_empty() {
            bail!("kcptun 已开启但未配置密钥 (kcptun_key)");
        }

        let local_port = verge.kcptun_local_port.unwrap_or(DEFAULT_LOCAL_PORT);
        let crypt = verge
            .kcptun_crypt
            .clone()
            .map(|s| s.to_string())
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| DEFAULT_CRYPT.to_string());
        let mode = verge
            .kcptun_mode
            .clone()
            .map(|s| s.to_string())
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| DEFAULT_MODE.to_string());

        // 仅监听本地回环，避免对外暴露
        let local_addr = format!("127.0.0.1:{local_port}");
        let mut args: Vec<String> = vec![
            "-l".into(),
            local_addr.clone(),
            "-r".into(),
            remote.clone(),
            "-key".into(),
            key,
            "-crypt".into(),
            crypt,
            "-mode".into(),
            mode,
        ];
        if let Some(conn) = verge.kcptun_conn
            && conn > 0
        {
            args.push("-conn".into());
            args.push(conn.to_string());
        }
        // 高级参数透传（空格分隔）
        if let Some(extra) = verge.kcptun_extra_args.as_ref() {
            for tok in extra.split_whitespace() {
                args.push(tok.to_string());
            }
        }

        let app = Handle::app_handle();
        let (mut rx, child) = app.shell().sidecar(KCPTUN_SIDECAR)?.args(args).spawn()?;
        let pid = child.pid();
        log::info!(target: "app", "[kcptun] 已启动 pid={pid} 本地={local_addr} 远端={remote}");
        self.child.store(Some(Arc::new(child)));

        AsyncHandler::spawn(move || async move {
            while let Some(ev) = rx.recv().await {
                match ev {
                    CommandEvent::Stdout(line) | CommandEvent::Stderr(line) => {
                        let text = String::from_utf8_lossy(&line);
                        let text = text.trim_end();
                        if !text.is_empty() {
                            log::info!(target: "app", "[kcptun] {text}");
                        }
                    }
                    CommandEvent::Terminated(payload) => {
                        log::warn!(
                            target: "app",
                            "[kcptun] 进程退出 code={:?} signal={:?}",
                            payload.code,
                            payload.signal
                        );
                        break;
                    }
                    _ => {}
                }
            }
        });

        Ok(())
    }

    /// 停止 kcptun client（幂等）
    pub async fn stop(&self) {
        if let Some(child) = self.child.swap(None).and_then(|arc| Arc::try_unwrap(arc).ok()) {
            let pid = child.pid();
            match child.kill() {
                Ok(()) => log::info!(target: "app", "[kcptun] 已停止 pid={pid}"),
                Err(e) => log::warn!(target: "app", "[kcptun] 停止失败 pid={pid}: {e}"),
            }
        }
    }

    /// 重启（配置变更后调用）
    pub async fn restart(&self) -> Result<()> {
        self.start().await
    }
}

singleton!(KcptunManager, KCPTUN_MANAGER);
