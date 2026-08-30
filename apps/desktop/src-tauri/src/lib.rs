mod bridge_host;

use bridge_host::BridgeState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .plugin(tauri_plugin_notification::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_process::init())
    .manage(BridgeState::default())
    .invoke_handler(tauri::generate_handler![
      bridge_host::session_open,
      bridge_host::session_restart,
      bridge_host::session_status,
      bridge_host::about_info,
      bridge_host::task_create,
      bridge_host::task_list,
      bridge_host::task_status,
      bridge_host::task_plan,
      bridge_host::task_report,
      bridge_host::task_rollback,
      bridge_host::doctor_run,
      bridge_host::config_show,
      bridge_host::config_write,
      bridge_host::workspace_status,
      bridge_host::model_list,
      bridge_host::task_pause,
      bridge_host::task_resume,
      bridge_host::task_cancel,
      bridge_host::permission_resolve,
      bridge_host::pty_open,
      bridge_host::pty_write,
      bridge_host::pty_resize,
      bridge_host::pty_close,
      bridge_host::fs_list_dir,
      bridge_host::fs_read_file,
      bridge_host::fs_search,
      bridge_host::git_status,
      bridge_host::git_log,
      bridge_host::git_diff,
      bridge_host::git_diff_file,
      bridge_host::git_show_head,
      bridge_host::git_branch,
      // CORE-INTERFACE gap closure (protocol 1.9.0)
      bridge_host::task_create_with_mode,
      bridge_host::permission_resolve_scoped,
      bridge_host::config_set,
      bridge_host::core_git_status,
      bridge_host::core_git_diff,
      bridge_host::core_git_log,
      bridge_host::core_git_branches,
      bridge_host::search_query,
      bridge_host::index_status,
      bridge_host::hardware_probe,
      bridge_host::model_recommend,
      bridge_host::model_install,
      bridge_host::model_remove,
      bridge_host::model_activate,
      bridge_host::model_inspect,
      bridge_host::ledger_changes,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
