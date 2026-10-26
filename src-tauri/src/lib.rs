use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    hash::{DefaultHasher, Hash, Hasher},
    path::PathBuf,
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};
use tauri::{
    menu::{CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Position, Size, State,
    WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};
use tauri_plugin_autostart::ManagerExt;
use windows_sys::Win32::{
    Foundation::{POINT, RECT},
    Graphics::Gdi::{GetMonitorInfoW, MonitorFromPoint, MONITORINFO, MONITOR_DEFAULTTONEAREST},
    UI::WindowsAndMessaging::GetCursorPos,
};

const VALID_POSITIONS: [&str; 9] = [
    "top-left", "top-center", "top-right", "center-left", "center", "center-right",
    "bottom-left", "bottom-center", "bottom-right",
];

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Reminder {
    id: String,
    title: String,
    #[serde(default)]
    note: String,
    due_at: String,
    status: String,
    #[serde(default)]
    completed_at: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Settings {
    #[serde(default = "default_snooze")]
    default_snooze: i64,
    #[serde(default = "default_position")]
    popup_position: String,
    #[serde(default = "default_popup_size")]
    popup_size: u8,
    #[serde(default = "default_text_size")]
    text_size: u8,
    #[serde(default = "default_popup_font")]
    popup_font: String,
    #[serde(default)]
    popup_transparency: u8,
    #[serde(default = "default_search_scope")]
    search_scope: String,
    #[serde(default = "default_search_highlight_seconds")]
    search_highlight_seconds: u8,
    #[serde(default = "default_preview_seconds")]
    preview_seconds: u8,
}

impl Default for Settings {
    fn default() -> Self {
        Self { default_snooze: default_snooze(), popup_position: default_position(), popup_size: default_popup_size(), text_size: default_text_size(), popup_font: default_popup_font(), popup_transparency: 0, search_scope: default_search_scope(), search_highlight_seconds: default_search_highlight_seconds(), preview_seconds: default_preview_seconds() }
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
struct PersistedState {
    #[serde(default)]
    reminders: Vec<Reminder>,
    #[serde(default)]
    settings: Settings,
}

#[derive(Clone)]
struct ActivePopup {
    reminder: Reminder,
    slot: usize,
    moved_by_user: bool,
    anchor: String,
    area: [i32; 4],
    scale: f64,
    height: i32,
}

#[derive(Default)]
struct RuntimeState {
    active: Mutex<HashMap<String, ActivePopup>>,
    cooldowns: Mutex<HashMap<String, Instant>>,
}

fn default_snooze() -> i64 { 10 }
fn default_position() -> String { "bottom-right".into() }
fn default_popup_size() -> u8 { 3 }
fn default_text_size() -> u8 { 3 }
fn default_popup_font() -> String { "system".into() }
fn default_search_scope() -> String { "all".into() }
fn default_search_highlight_seconds() -> u8 { 3 }
fn default_preview_seconds() -> u8 { 5 }

fn sanitize(mut value: PersistedState) -> PersistedState {
    value.settings.default_snooze = value.settings.default_snooze.clamp(1, 525_600);
    value.settings.popup_size = value.settings.popup_size.clamp(1, 5);
    value.settings.text_size = value.settings.text_size.clamp(1, 5);
    value.settings.popup_transparency = value.settings.popup_transparency.min(40);
    if !["system", "yahei", "simsun", "pingfang"].contains(&value.settings.popup_font.as_str()) {
        value.settings.popup_font = default_popup_font();
    }
    if !["all", "title"].contains(&value.settings.search_scope.as_str()) {
        value.settings.search_scope = default_search_scope();
    }
    value.settings.search_highlight_seconds = value.settings.search_highlight_seconds.clamp(1, 10);
    value.settings.preview_seconds = value.settings.preview_seconds.clamp(1, 30);
    if !VALID_POSITIONS.contains(&value.settings.popup_position.as_str()) {
        value.settings.popup_position = default_position();
    }
    value
}

fn data_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map(|dir| dir.join("reminders.json")).map_err(|e| e.to_string())
}

fn load_from_disk(app: &AppHandle) -> PersistedState {
    let Some(primary) = data_path(app).ok() else { return PersistedState::default(); };
    let mut candidates = vec![primary.clone()];
    if let Some(roaming) = primary.parent().and_then(|path| path.parent()) {
        candidates.push(roaming.join("jishi-reminder-desktop").join("reminders.json"));
        candidates.push(roaming.join("及时提醒").join("reminders.json"));
    }
    candidates.into_iter()
        .find_map(|path| fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str::<PersistedState>(&text).ok())
        .map(sanitize)
        .unwrap_or_default()
}

fn save_to_disk(app: &AppHandle, value: PersistedState) -> Result<PersistedState, String> {
    let safe = sanitize(value);
    let path = data_path(app)?;
    if let Some(parent) = path.parent() { fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
    fs::write(&path, serde_json::to_vec_pretty(&safe).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    app.emit("state-changed", &safe).map_err(|e| e.to_string())?;
    Ok(safe)
}

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
    if let Ok(mut cooldowns) = app.state::<RuntimeState>().cooldowns.lock() {
        cooldowns.clear();
    }
    dispatch_due_reminders(app);
}

fn work_area() -> RECT {
    unsafe {
        let mut cursor = POINT { x: 0, y: 0 };
        let _ = GetCursorPos(&mut cursor);
        let monitor = MonitorFromPoint(cursor, MONITOR_DEFAULTTONEAREST);
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            rcMonitor: RECT { left: 0, top: 0, right: 1280, bottom: 720 },
            rcWork: RECT { left: 0, top: 0, right: 1280, bottom: 680 },
            dwFlags: 0,
        };
        if monitor != std::ptr::null_mut() { let _ = GetMonitorInfoW(monitor, &mut info); }
        info.rcWork
    }
}

fn popup_scale(size: u8) -> f64 {
    match size { 1 => 0.78, 2 => 0.9, 4 => 1.12, 5 => 1.25, _ => 1.0 }
}

fn popup_key(reminder: &Reminder) -> String { format!("{}|{}", reminder.id, reminder.due_at) }

fn popup_label(reminder: &Reminder) -> String {
    let mut hasher = DefaultHasher::new();
    popup_key(reminder).hash(&mut hasher);
    format!("reminder-popup-{:016x}", hasher.finish())
}

fn same_popup_group(item: &ActivePopup, anchor: &str, area: [i32; 4]) -> bool {
    !item.moved_by_user && item.anchor == anchor && item.area == area
}

fn next_popup_slot(active: &HashMap<String, ActivePopup>, anchor: &str, area: [i32; 4]) -> usize {
    active.values().filter(|item| same_popup_group(item, anchor, area))
        .map(|item| item.slot + 1).max().unwrap_or(0)
}

fn popup_origin(area: [i32; 4], position: &str, width: i32, height: i32, offset: i32) -> PhysicalPosition<i32> {
    let [left, top, right, bottom] = area;
    let margin = 20i32;
    let area_width = right - left;
    let area_height = bottom - top;
    let (vertical, horizontal) = if position == "center" {
        ("center", "center")
    } else {
        let mut parts = position.split('-');
        (parts.next().unwrap_or("bottom"), parts.next().unwrap_or("right"))
    };
    let x = match horizontal {
        "left" => left + margin,
        "right" => right - width - margin,
        _ => left + (area_width - width) / 2,
    };
    let base_y = match vertical {
        "top" => top + margin,
        "bottom" => bottom - height - margin,
        _ => top + (area_height - height) / 2,
    };
    let y = if vertical == "top" { base_y + offset } else { base_y - offset };
    PhysicalPosition::new(x.clamp(left + margin, (right - width - margin).max(left + margin)),
        y.clamp(top + margin, (bottom - height - margin).max(top + margin)))
}

fn reflow_popup_group(app: &AppHandle, anchor: &str, area: [i32; 4]) {
    // Snapshot first; never hold the runtime lock while calling window APIs.
    let mut group = app.state::<RuntimeState>().active.lock().map(|active| active.iter()
        .filter(|(_, item)| same_popup_group(item, anchor, area))
        .map(|(label, item)| (label.clone(), item.clone())).collect::<Vec<_>>()).unwrap_or_default();
    group.sort_by_key(|(_, item)| item.slot);
    let first_height = group.first().map(|(_, item)| item.height).unwrap_or(0);
    let mut offset = 0;
    for (label, item) in group {
        if let Some(window) = app.get_webview_window(&label) {
            let width = (396.0 * item.scale).round() as u32;
            let _ = window.set_size(Size::Physical(PhysicalSize::new(width, item.height as u32)));
            let position = popup_origin(area, anchor, width as i32, item.height,
                popup_stack_offset(anchor, offset, first_height, item.height));
            let _ = window.set_position(Position::Physical(position));
            offset += item.height + 12;
        }
    }
}

fn popup_stack_offset(anchor: &str, previous_heights: i32, first_height: i32, height: i32) -> i32 {
    if anchor.starts_with("center") { previous_heights + (height - first_height) / 2 }
    else { previous_heights }
}

fn show_popup(app: &AppHandle, reminder: Reminder) -> Result<(), String> {
    let label = popup_label(&reminder);
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.show();
        return Ok(());
    }
    let state = load_from_disk(app);
    let scale = popup_scale(state.settings.popup_size);
    let work = work_area();
    let area = [work.left, work.top, work.right, work.bottom];
    let anchor = state.settings.popup_position;
    {
        let runtime = app.state::<RuntimeState>();
        let mut active = runtime.active.lock().map_err(|e| e.to_string())?;
        let slot = next_popup_slot(&active, &anchor, area);
        active.insert(label.clone(), ActivePopup { reminder: reminder.clone(), slot, moved_by_user: false,
            anchor: anchor.clone(), area, scale, height: (280.0 * scale).round() as i32 });
    }
    let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("popup.html".into()))
        .title("及时提醒")
        .inner_size(396.0 * scale, 280.0 * scale)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .visible(false)
        .build()
        .map_err(|error| {
            if let Ok(mut active) = app.state::<RuntimeState>().active.lock() { active.remove(&label); }
            error.to_string()
        })?;
    let _ = window.set_zoom(scale);
    let _ = window.set_icon(tauri::image::Image::from_bytes(include_bytes!("../icons/icon.png")).map_err(|error| error.to_string())?);
    reflow_popup_group(app, &anchor, area);
    window.show().map_err(|e| e.to_string())?;
    Ok(())
}

fn hide_popup(app: &AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) { let _ = window.close(); }
    let removed = app.state::<RuntimeState>().active.lock().ok().and_then(|mut active| active.remove(label));
    if let Some(item) = removed { reflow_popup_group(app, &item.anchor, item.area); }
}

fn dismiss_popup(app: &AppHandle, label: &str) {
    let reminder = app.state::<RuntimeState>().active.lock().ok().and_then(|active| active.get(label).map(|item| item.reminder.clone()));
    if let Some(reminder) = reminder {
        let key = format!("{}|{}", reminder.id, reminder.due_at);
        if let Ok(mut cooldowns) = app.state::<RuntimeState>().cooldowns.lock() {
            cooldowns.insert(key, Instant::now() + Duration::from_secs(60));
        }
    }
    hide_popup(app, label);
}

fn update_reminder<F>(app: &AppHandle, id: &str, mutate: F) -> Result<PersistedState, String>
where F: FnOnce(&mut Reminder) {
    let mut state = load_from_disk(app);
    if let Some(item) = state.reminders.iter_mut().find(|item| item.id == id) { mutate(item); }
    save_to_disk(app, state)
}

#[tauri::command]
fn state_load(app: AppHandle) -> PersistedState { load_from_disk(&app) }

#[tauri::command]
fn state_save(app: AppHandle, state: PersistedState) -> Result<PersistedState, String> { save_to_disk(&app, state) }

#[tauri::command]
fn popup_get(window: WebviewWindow, runtime: State<'_, RuntimeState>) -> Option<Reminder> {
    runtime.active.lock().ok().and_then(|active| active.get(window.label()).map(|item| item.reminder.clone()))
}

#[tauri::command]
fn popup_close(app: AppHandle, window: WebviewWindow) { dismiss_popup(&app, window.label()); }

#[tauri::command]
fn popup_complete(app: AppHandle, window: WebviewWindow, id: String) -> Result<PersistedState, String> {
    let result = if id == "__test__" { load_from_disk(&app) } else {
        update_reminder(&app, &id, |item| {
            item.status = "done".into();
            item.completed_at = Some(Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true));
        })?
    };
    hide_popup(&app, window.label());
    Ok(result)
}

#[tauri::command]
fn popup_disable(app: AppHandle, window: WebviewWindow, id: String) -> Result<PersistedState, String> {
    let result = if id == "__test__" { load_from_disk(&app) } else {
        update_reminder(&app, &id, |item| {
            item.status = "done".into();
            item.completed_at = Some(Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true));
        })?
    };
    hide_popup(&app, window.label());
    Ok(result)
}

#[tauri::command]
fn popup_snooze(app: AppHandle, window: WebviewWindow, id: String, due_at: String) -> Result<PersistedState, String> {
    let result = if id == "__test__" { load_from_disk(&app) } else {
        update_reminder(&app, &id, |item| { item.status = "pending".into(); item.due_at = due_at; item.completed_at = None; })?
    };
    hide_popup(&app, window.label());
    Ok(result)
}

#[tauri::command]
fn popup_update(app: AppHandle, window: WebviewWindow, id: String, title: String, note: String) -> Result<PersistedState, String> {
    if let Ok(mut active) = app.state::<RuntimeState>().active.lock() {
        if let Some(item) = active.get_mut(window.label()) { item.reminder.title = title.clone(); item.reminder.note = note.clone(); }
    }
    if id == "__test__" { Ok(load_from_disk(&app)) } else { update_reminder(&app, &id, |item| { item.title = title; item.note = note; }) }
}

#[tauri::command]
fn window_show(app: AppHandle) { show_main(&app); }

#[tauri::command]
async fn popup_test(app: AppHandle) -> Result<(), String> {
    let reminder = Reminder {
        id: "__test__".into(), title: "这是一条测试提醒".into(),
        note: "提醒弹窗工作正常。你可以试试完成、未完成或修改备注。".into(),
        due_at: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true), status: "pending".into(), completed_at: None,
    };
    let handle = app.clone();
    app.run_on_main_thread(move || { let _ = show_popup(&handle, reminder); }).map_err(|e| e.to_string())
}

#[tauri::command]
async fn popup_preview(app: AppHandle) -> Result<(), String> {
    let preview_labels = app.state::<RuntimeState>().active.lock().map(|active| active.iter().filter(|(_, item)| item.reminder.id.starts_with("__preview__")).map(|(label, _)| label.clone()).collect::<Vec<_>>()).unwrap_or_default();
    for label in preview_labels { hide_popup(&app, &label); }
    let reminder = Reminder {
        id: format!("__preview__{}", Utc::now().timestamp_millis()),
        title: "提醒卡片预览".into(),
        note: "这里会展示当前设置的卡片大小、字体、文字大小和透明度。".into(),
        due_at: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
        status: "pending".into(),
        completed_at: None,
    };
    let handle = app.clone();
    app.run_on_main_thread(move || { let _ = show_popup(&handle, reminder); }).map_err(|e| e.to_string())
}

fn clamp_popup_position(position: PhysicalPosition<i32>, width: u32, height: u32, area: RECT) -> PhysicalPosition<i32> {
    let x = position.x.clamp(area.left + 20, (area.right - width as i32 - 20).max(area.left + 20));
    let y = position.y.clamp(area.top + 20, (area.bottom - height as i32 - 20).max(area.top + 20));
    PhysicalPosition::new(x, y)
}

#[cfg(test)]
mod popup_layout_tests {
    use super::*;

    fn fixture(anchor: &str, area: [i32; 4], slot: usize) -> ActivePopup {
        ActivePopup { reminder: Reminder { id: "layout-test".into(), title: "test".into(), note: String::new(),
            due_at: "2099-01-01T00:00:00Z".into(), status: "pending".into(), completed_at: None },
            slot, moved_by_user: false, anchor: anchor.into(), area, scale: 1.0, height: 260 }
    }

    #[test]
    fn each_anchor_and_monitor_has_its_own_queue() {
        let area = [0, 0, 2560, 1400];
        let mut active = HashMap::new();
        active.insert("existing".into(), fixture("bottom-right", area, 0));
        for anchor in VALID_POSITIONS {
            assert_eq!(next_popup_slot(&active, anchor, area), if anchor == "bottom-right" { 1 } else { 0 }, "{anchor}");
        }
        assert_eq!(next_popup_slot(&active, "bottom-right", [-1920, 0, 0, 1040]), 0);
        active.get_mut("existing").unwrap().moved_by_user = true;
        assert_eq!(next_popup_slot(&active, "bottom-right", area), 0);
    }

    #[test]
    fn all_nine_first_cards_use_their_own_anchor() {
        let area = [0, 0, 2560, 1400];
        for anchor in VALID_POSITIONS {
            let p = popup_origin(area, anchor, 396, 260, 0);
            let x = if anchor.ends_with("left") { 20 } else if anchor.ends_with("right") { 2144 } else { 1082 };
            let y = if anchor.starts_with("top") { 20 } else if anchor.starts_with("bottom") { 1120 } else { 570 };
            assert_eq!(p, PhysicalPosition::new(x, y), "{anchor}");
        }
    }

    #[test]
    fn same_group_uses_previous_actual_heights_and_gap() {
        let area = [0, 0, 2560, 1400];
        for anchor in VALID_POSITIONS {
            let first = popup_origin(area, anchor, 396, 260, 0);
            let second = popup_origin(area, anchor, 396, 330, popup_stack_offset(anchor, 260 + 12, 260, 330));
            if anchor.starts_with("top") {
                assert_eq!(second.y - (first.y + 260), 12);
            } else if anchor.starts_with("bottom") {
                assert_eq!(first.y - (second.y + 330), 12);
            } else {
                assert_eq!(first.y - (second.y + 330), 12);
            }
        }
    }

    #[test]
    fn dragged_popup_stays_put_unless_it_would_leave_work_area() {
        let area = RECT { left: 0, top: 0, right: 1920, bottom: 1040 };
        assert_eq!(clamp_popup_position(PhysicalPosition::new(100, 100), 396, 430, area), PhysicalPosition::new(100, 100));
        assert_eq!(clamp_popup_position(PhysicalPosition::new(1500, 800), 396, 430, area), PhysicalPosition::new(1500, 590));
    }

    #[test]
    fn negative_monitor_coordinates_and_small_work_areas_are_supported() {
        let left_monitor = RECT { left: -1920, top: -100, right: 0, bottom: 940 };
        assert_eq!(clamp_popup_position(PhysicalPosition::new(-1900, 100), 396, 430, left_monitor), PhysicalPosition::new(-1900, 100));
        let tiny = RECT { left: 0, top: 0, right: 300, bottom: 200 };
        assert_eq!(clamp_popup_position(PhysicalPosition::new(-10, -10), 500, 500, tiny), PhysicalPosition::new(20, 20));
    }
}

#[tauri::command]
fn popup_resize(app: AppHandle, window: WebviewWindow, height: f64) {
    let placement = app.state::<RuntimeState>().active.lock().ok()
        .and_then(|mut active| active.get_mut(window.label()).map(|item| {
            item.height = (height.clamp(220.0, 430.0) * item.scale).round() as i32;
            item.clone()
        }));
    let scale = placement.as_ref().map(|item| item.scale)
        .unwrap_or_else(|| popup_scale(load_from_disk(&app).settings.popup_size));
    let width = (396.0 * scale).round() as u32;
    let requested_height = height.clamp(220.0, 430.0);
    let physical_height = (requested_height * scale).round() as u32;
    if let Some(item) = placement.filter(|item| !item.moved_by_user) {
        reflow_popup_group(&app, &item.anchor, item.area);
    } else {
        let _ = window.set_size(Size::Physical(PhysicalSize::new(width, physical_height)));
        if let Ok(position) = window.outer_position() {
            let position = clamp_popup_position(position, width, physical_height, work_area());
            let _ = window.set_position(Position::Physical(position));
        }
    }
}

#[tauri::command]
fn popup_start_drag(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    window.start_dragging().map_err(|error| error.to_string())?;
    if let Ok(mut active) = app.state::<RuntimeState>().active.lock() {
        if let Some(item) = active.get_mut(window.label()) { item.moved_by_user = true; }
    }
    Ok(())
}

fn dispatch_due_reminders(app: &AppHandle) {
        let state = load_from_disk(app);
        let now = Utc::now();
        let now_instant = Instant::now();
        if let Ok(mut cooldowns) = app.state::<RuntimeState>().cooldowns.lock() {
            cooldowns.retain(|_, until| *until > now_instant);
        }
        let active_keys = app.state::<RuntimeState>().active.lock().map(|active| active.values().map(|item| popup_key(&item.reminder)).collect::<Vec<_>>()).unwrap_or_default();
        let mut due = state.reminders.into_iter().filter(|item| {
            if item.status == "done" || !DateTime::parse_from_rfc3339(&item.due_at).map(|due| due.with_timezone(&Utc) <= now).unwrap_or(false) {
                return false;
            }
            let key = format!("{}|{}", item.id, item.due_at);
            !active_keys.contains(&key) && app.state::<RuntimeState>().cooldowns.lock().map(|cooldowns| !cooldowns.contains_key(&key)).unwrap_or(false)
        }).collect::<Vec<_>>();
        due.sort_by_key(|item| item.due_at.clone());
        for reminder in due {
            let handle = app.clone();
            let _ = app.run_on_main_thread(move || {
                let label = popup_label(&reminder);
                if let Err(_error) = show_popup(&handle, reminder) { hide_popup(&handle, &label); }
            });
        }
}

fn start_scheduler(app: AppHandle) {
    thread::spawn(move || loop {
        dispatch_due_reminders(&app);
        thread::sleep(Duration::from_secs(1));
    });
}

pub fn run() {
    tauri::Builder::default()
        .manage(RuntimeState::default())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .invoke_handler(tauri::generate_handler![
            state_load, state_save, popup_get, popup_close, popup_complete, popup_disable, popup_snooze,
            popup_update, window_show, popup_test, popup_preview, popup_resize, popup_start_drag
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                window.set_icon(tauri::image::Image::from_bytes(include_bytes!("../icons/icon.png"))?)?;
            }
            let open_item = MenuItemBuilder::with_id("open", "打开及时提醒").build(app)?;
            let enabled = app.autolaunch().is_enabled().unwrap_or(false);
            let autostart_item = CheckMenuItemBuilder::with_id("autostart", "开机自动启动").checked(enabled).build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "退出").build(app)?;
            let menu = MenuBuilder::new(app).items(&[&open_item, &autostart_item, &quit_item]).build()?;
            let autostart_for_menu = autostart_item.clone();
            TrayIconBuilder::new()
                .icon(tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?)
                .tooltip("及时提醒 · 正在后台运行")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event| match event.id().as_ref() {
                    "open" => show_main(app),
                    "autostart" => {
                        if autostart_for_menu.is_checked().unwrap_or(false) { let _ = app.autolaunch().enable(); }
                        else { let _ = app.autolaunch().disable(); }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    match event {
                        TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. }
                        | TrayIconEvent::DoubleClick { button: MouseButton::Left, .. } => show_main(tray.app_handle()),
                        _ => {}
                    }
                })
                .build(app)?;
            start_scheduler(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to run 及时提醒");
}
