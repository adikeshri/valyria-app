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
    .manage(BridgeState::default())
    .invoke_handler(tauri::generate_handler![
      bridge_host::session_open,
      bridge_host::session_status,
      bridge_host::task_create,
      bridge_host::task_list,
      bridge_host::task_status,
      bridge_host::task_plan,
      bridge_host::task_report,
      bridge_host::task_pause,
      bridge_host::task_resume,
      bridge_host::task_cancel,
      bridge_host::permission_resolve,
      bridge_host::fs_list_dir,
      bridge_host::fs_read_file,
      bridge_host::fs_search,
      bridge_host::git_status,
      bridge_host::git_log,
      bridge_host::git_diff,
      bridge_host::git_branch,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
