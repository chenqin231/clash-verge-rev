use super::CmdResult;
use crate::cmd::StringifyErr as _;
use crate::core::kcptun::KcptunManager;

/// 应用最新 kcptun 配置并重启 client（开关/参数变更后由前端调用）
#[tauri::command]
pub async fn restart_kcptun() -> CmdResult {
    KcptunManager::global().restart().await.stringify_err()
}

/// 停止 kcptun client
#[tauri::command]
pub async fn stop_kcptun() -> CmdResult {
    KcptunManager::global().stop().await;
    Ok(())
}

/// 查询 kcptun client 是否在运行
#[tauri::command]
pub async fn get_kcptun_running() -> CmdResult<bool> {
    Ok(KcptunManager::global().is_running())
}
