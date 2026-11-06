/*
 * Atualização automática do app instalado.
 * A janela do app abre esta página (a que veio dentro do instalador). Se já souber o endereço do servidor da Resenha,
 * confere se ele responde e, se sim, passa a mostrar a interface DO SERVIDOR. Assim, atualizar o servidor atualiza o app
 * de todo mundo, sem mandar instalador novo. Se o servidor não responder, segue com esta cópia local.
 * No navegador (página aberta pelo próprio servidor) este arquivo não faz nada.
 */
(function () {
  var isApp = location.protocol === 'tauri:' || location.protocol === 'file:' || location.hostname === 'tauri.localhost';
  if (!isApp) return;

  var cfg = window.RESENHA_CONFIG || {};
  var prefs = {};
  try { prefs = JSON.parse(localStorage.getItem('resenha.prefs') || '{}') || {}; } catch (e) { prefs = {}; }
  var s = String(prefs.server || cfg.server || '').trim();
  if (!s) return; // ainda sem servidor: mostra a tela local, onde a pessoa digita o endereço

  var base;
  if (/^https?:\/\//i.test(s)) base = s;
  else base = (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\])/.test(s) ? 'http://' : 'https://') + s;
  base = base.replace(/\/+$/, '');

  // Leva as preferências (nome, qualidade...) para a interface do servidor, que guarda as dela em outro lugar.
  // Os dispositivos (câmera/microfone) não vão: o número deles muda de uma origem para outra.
  var carry = {};
  ['name', 'camQ', 'scrQ', 'eco', 'preview', 'stats', 'autoWatch', 'shareType'].forEach(function (k) { if (prefs[k] !== undefined) carry[k] = prefs[k]; });
  var q = '';
  try { q = '?p=' + encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(carry))))); } catch (e) { q = ''; }

  // Esconde a tela local por instantes para não piscar; se algo falhar, ela volta.
  var root = document.documentElement, shown = false;
  function show() { if (!shown) { shown = true; root.style.visibility = ''; } }
  root.style.visibility = 'hidden';
  setTimeout(show, 3500);

  var ctl = typeof AbortController === 'function' ? new AbortController() : null;
  var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 3000);
  fetch(base + '/version.json?t=' + Date.now(), ctl ? { signal: ctl.signal } : {})
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) {
      clearTimeout(timer);
      if (j && j.app === 'resenha') location.replace(base + '/' + q + (location.hash || ''));
      else show();
    })
    .catch(function () { clearTimeout(timer); show(); });
})();
