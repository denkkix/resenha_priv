// O app inteiro vive em ../app (HTML/CSS/JS). O Rust só abre a janela usando
// o motor web que já existe no sistema (WebView2 no Windows), por isso gasta pouca RAM.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("erro ao iniciar a Resenha");
}
