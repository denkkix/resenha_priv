// Esconde a janela preta do terminal no Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    resenha_lib::run()
}
