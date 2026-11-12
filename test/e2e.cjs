'use strict';
/*
 * Teste de ponta a ponta da Resenha.
 *  1) servidor: salas, repasse de sinais, sala cheia, mensagem grande, reconexão com e sem tempo de tolerância
 *  2) navegador: 3 pessoas em Chromium de verdade (câmera/microfone de teste) — voz, câmera, tela, chat, economia, reconexão
 * Uso: node test/e2e.cjs      (variável SHOTS=<pasta> salva capturas de tela)
 */
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const PORT = 8800 + Math.floor(Math.random() * 100);
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.SHOTS || '';
let pass = 0, fail = 0;
const failures = [];

function check(ok, msg, extra) {
  if (ok) { pass++; console.log(`  ok   ${msg}`); }
  else { fail++; failures.push(msg); console.log(`  FALHA ${msg}${extra ? ' -> ' + extra : ''}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------------------------------------- servidor */
function startServer(extraEnv = {}, port = PORT, quiet = false) {
  const p = spawn('node', [path.join(__dirname, '..', 'server', 'server.js')], {
    env: { ...process.env, PORT: String(port), ICE_SERVERS: '[]', GRACE_MS: '3000', ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  p.logs = '';
  return new Promise((resolve, reject) => {
    p.stdout.on('data', (d) => { p.logs += d; if (String(d).includes('no ar')) resolve(p); });
    p.stderr.on('data', (d) => { p.logs += d; if (!quiet) process.stderr.write(d); });
    p.on('exit', (c) => reject(new Error('servidor saiu: ' + c)));
    setTimeout(() => reject(new Error('servidor não subiu')), 5000);
  });
}

function raw(room, name, id, port = PORT) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const c = { ws, msgs: [], waiters: [], closed: false };
    ws.onmessage = (e) => { const m = JSON.parse(e.data); c.msgs.push(m); c.waiters = c.waiters.filter((w) => !w(m)); };
    ws.onclose = () => { c.closed = true; };
    c.next = (pred, ms = 2500) => new Promise((res, rej) => {
      const hit = c.msgs.find(pred); if (hit) return res(hit);
      const to = setTimeout(() => rej(new Error('timeout')), ms);
      c.waiters.push((m) => { if (pred(m)) { clearTimeout(to); res(m); return true; } return false; });
    });
    c.send = (o) => ws.send(JSON.stringify(o));
    ws.onopen = () => { c.send({ t: 'join', room, name, id }); resolve(c); };
  });
}

async function serverTests() {
  console.log('\n== Servidor ==');
  const a = await raw('sala-teste', 'Ana');
  const wa = await a.next((m) => m.t === 'welcome');
  check(wa.peers.length === 0 && /^[0-9a-f]{8}$/.test(wa.id), 'primeira pessoa recebe id e lista vazia');

  const b = await raw('SALA-TESTE', 'Bia'); // código não diferencia maiúsculas
  const wb = await b.next((m) => m.t === 'welcome');
  check(wb.peers.length === 1 && wb.peers[0].id === wa.id, 'segunda pessoa vê a primeira (código sem diferença de maiúsculas)');
  const pj = await a.next((m) => m.t === 'peer-join');
  check(pj.id === wb.id && pj.name === 'Bia', 'primeira pessoa é avisada de quem entrou');

  b.send({ t: 'signal', to: wa.id, data: { sdp: { type: 'offer', sdp: 'x' } } });
  const sg = await a.next((m) => m.t === 'signal');
  check(sg.from === wb.id && sg.data.sdp.type === 'offer', 'sinal chega ao destino com o remetente certo');

  b.send({ t: 'signal', to: 'inexistente', data: {} });
  b.send({ t: 'chat', text: 'oi'.repeat(400) });
  const ch = await a.next((m) => m.t === 'chat');
  check(ch.text.length === 500 && ch.name === 'Bia', 'chat chega a todos e é limitado a 500 caracteres');

  b.send({ t: 'state', state: { mic: false, cam: true, screen: true, extra: 'x' } });
  const st = await a.next((m) => m.t === 'state');
  check(st.state.mic === false && st.state.cam === true && !('extra' in st.state), 'estado (mic/câmera/tela) é repassado e limpo');

  // reconexão rápida mantém o lugar e ninguém é avisado de saída
  b.ws.close();
  await sleep(400);
  const b2 = await raw('sala-teste', 'Bia', wb.id);
  const wb2 = await b2.next((m) => m.t === 'welcome');
  check(wb2.id === wb.id, 'voltar dentro do prazo mantém o mesmo id');
  check(!a.msgs.some((m) => m.t === 'peer-leave'), 'quem ficou não vê saída durante a reconexão rápida');
  check(wb2.peers.some((p) => p.id === wa.id), 'ao voltar, recebe a lista atual da sala');

  // sair de vez
  b2.send({ t: 'leave' });
  const pl = await a.next((m) => m.t === 'peer-leave');
  check(pl.id === wb.id, 'sair avisa os outros na hora');

  // queda sem voltar: só avisa depois do prazo (3 s no teste)
  const c = await raw('sala-teste', 'Caio');
  const wc = await c.next((m) => m.t === 'welcome');
  await a.next((m) => m.t === 'peer-join' && m.id === wc.id);
  c.ws.close();
  const t0 = Date.now();
  const pl2 = await a.next((m) => m.t === 'peer-leave' && m.id === wc.id, 6000);
  const dt = Date.now() - t0;
  check(pl2 && dt >= 2500 && dt < 5000, `queda sem volta é avisada após o prazo (${dt} ms)`);

  // sala cheia (8)
  const fillers = [];
  for (let i = 0; i < 7; i++) { const f = await raw('sala-cheia', 'P' + i); await f.next((m) => m.t === 'welcome'); fillers.push(f); }
  const eighth = await raw('sala-cheia', 'Oitavo'); await eighth.next((m) => m.t === 'welcome');
  const ninth = await raw('sala-cheia', 'Nono');
  const er = await ninth.next((m) => m.t === 'error');
  check(er.code === 'sala-cheia', 'a 9ª pessoa é recusada com “sala-cheia”');

  // código inválido
  const bad = await raw('x', 'Zé');
  const eb = await bad.next((m) => m.t === 'error');
  check(eb.code === 'codigo-invalido', 'código curto demais é recusado');

  // mensagem enorme derruba só quem mandou
  const big = await raw('sala-grande', 'Gigante'); await big.next((m) => m.t === 'welcome');
  big.send({ t: 'chat', text: 'a'.repeat(70000) });
  await sleep(500);
  check(big.closed, 'mensagem acima de 64 KB derruba a conexão');
  check(!a.closed, 'os outros clientes não são afetados');

  // lixo no meio não derruba o servidor
  const junk = await raw('sala-lixo', 'Lixo'); await junk.next((m) => m.t === 'welcome');
  junk.ws.send('isso não é json'); junk.ws.send('{"t":123}'); junk.ws.send('null');
  await sleep(200);
  const ping = await fetch(`${BASE}/health`).then((r) => r.text());
  check(ping === 'ok' && !junk.closed, 'mensagens inválidas são ignoradas e o servidor continua de pé');

  for (const x of [a, ...fillers, eighth, junk]) try { x.ws.close(); } catch { /* ok */ }
}


/* ---------------------------------------------------- TURN (Cloudflare de mentira) */
const http = require('http');

function mockCloudflare() {
  const m = { reqs: [], mode: 'ok', user: 'u1', server: null, port: 0 };
  m.server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      m.reqs.push({ method: req.method, url: req.url, auth: req.headers.authorization || '', body });
      if (m.mode === 'fail') { res.writeHead(500); return res.end('erro'); }
      if (m.mode === 'empty') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ iceServers: [] })); }
      const turn = {
        urls: ['stun:stun.cloudflare.com:53', 'turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:53?transport=udp',
          'turns:turn.cloudflare.com:5349?transport=tcp'],
        username: m.user, credential: 'cred-' + m.user,
      };
      let out;
      if (req.url.startsWith('/v1/turn/')) out = { iceServers: m.mode === 'object' ? turn : [{ urls: ['stun:stun.cloudflare.com:3478'] }, turn] };
      else out = [{ urls: ['stun:stun.relay.example:3478'] }, turn]; // estilo Metered: lista direto
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(out));
    });
  });
  return new Promise((resolve) => m.server.listen(0, '127.0.0.1', () => { m.port = m.server.address().port; resolve(m); }));
}

async function iceOf(port, room = 'ice-' + Math.random().toString(36).slice(2, 8)) {
  const c = await raw(room, 'T', undefined, port);
  const w = await c.next((x) => x.t === 'welcome');
  c.ws.close();
  return w.ice;
}
const turnEntry = (ice) => ice.find((s) => (s.urls || []).some((u) => /^turns?:/.test(u)));

async function turnTests() {
  console.log('\n== TURN (Cloudflare simulada) ==');
  const cf = await mockCloudflare();
  const base = `http://127.0.0.1:${cf.port}`;
  const TOKEN = 'token-secreto-123';
  const staticIce = JSON.stringify([{ urls: ['stun:estatico.example:3478'] }]);
  const procs = [];
  try {
    // 1) caminho feliz: busca, formato do pedido, filtro da porta 53, sem vazar o token
    const p1 = PORT + 101;
    procs.push(await startServer({ CF_TURN_KEY_ID: 'chave123', CF_TURN_API_TOKEN: TOKEN, CF_API_BASE: base, ICE_SERVERS: staticIce, ICE_TTL_S: '3600', ICE_REFRESH_MS: '900', ICE_RETRY_MS: '300' }, p1, true));
    await sleep(300);
    const r0 = cf.reqs[0] || {};
    check(r0.method === 'POST' && r0.url === '/v1/turn/keys/chave123/credentials/generate-ice-servers', 'TURN: pede as credenciais no endereço certo da Cloudflare', `${r0.method} ${r0.url}`);
    check(r0.auth === `Bearer ${TOKEN}`, 'TURN: envia o token no cabeçalho Authorization');
    check(JSON.parse(r0.body || '{}').ttl === 3600, 'TURN: pede credenciais com validade (ttl) definida', r0.body);
    let ice = await iceOf(p1);
    check(ice[0] && ice[0].urls[0] === 'stun:estatico.example:3478', 'TURN: os servidores fixos continuam na frente da lista');
    const t1 = turnEntry(ice);
    check(!!t1 && t1.username === 'u1' && t1.credential === 'cred-u1', 'TURN: o cliente recebe usuário e senha temporários do relay');
    check(t1 && t1.urls.some((u) => u.startsWith('turns:')) && t1.urls.some((u) => u.includes(':3478?transport=udp')), 'TURN: mantém UDP 3478 e TURN sobre TLS');
    check(!ice.some((x) => (x.urls || []).some((u) => /:53(\?|$)/.test(u))), 'TURN: endereços da porta 53 (bloqueada nos navegadores) são removidos');
    check(!JSON.stringify(ice).includes(TOKEN) && !procs[0].logs.includes(TOKEN), 'TURN: o token da API nunca vai para os clientes nem para o log');

    // 2) renovação: credenciais novas passam a valer sozinhas
    cf.user = 'u2';
    await sleep(1300);
    ice = await iceOf(p1);
    check((turnEntry(ice) || {}).username === 'u2', 'TURN: as credenciais são renovadas sozinhas');

    // 3) a Cloudflare cai: continua com as últimas credenciais e volta quando ela volta
    cf.mode = 'fail';
    await sleep(1300);
    ice = await iceOf(p1);
    check((turnEntry(ice) || {}).username === 'u2', 'TURN: se a renovação falhar, segue com as credenciais anteriores');
    check(/não consegui buscar/.test(procs[0].logs), 'TURN: a falha aparece no log do servidor');
    cf.mode = 'ok'; cf.user = 'u3';
    await sleep(900);
    ice = await iceOf(p1);
    check((turnEntry(ice) || {}).username === 'u3', 'TURN: quando a Cloudflare volta, o servidor se recupera sozinho');

    // 4) já nasce com a Cloudflare fora do ar: sala funciona só com STUN e o relay entra depois
    cf.mode = 'fail';
    const p2 = PORT + 102;
    procs.push(await startServer({ CF_TURN_KEY_ID: 'chave123', CF_TURN_API_TOKEN: TOKEN, CF_API_BASE: base, ICE_SERVERS: staticIce, ICE_RETRY_MS: '300' }, p2, true));
    await sleep(300);
    ice = await iceOf(p2);
    check(!turnEntry(ice) && ice.length === 1, 'TURN: com a Cloudflare fora do ar na partida, a sala abre só com STUN');
    cf.mode = 'object'; cf.user = 'u4';
    await sleep(900);
    ice = await iceOf(p2);
    check((turnEntry(ice) || {}).username === 'u4', 'TURN: aceita a resposta da Cloudflare com um único objeto e entra depois');

    // 5) resposta vazia não apaga nada nem derruba o servidor
    cf.mode = 'empty';
    const p3 = PORT + 103;
    procs.push(await startServer({ CF_TURN_KEY_ID: 'chave123', CF_TURN_API_TOKEN: TOKEN, CF_API_BASE: base, ICE_SERVERS: staticIce, ICE_RETRY_MS: '300' }, p3, true));
    await sleep(300);
    ice = await iceOf(p3);
    check(ice.length === 1 && /nenhum servidor utilizável/.test(procs[2].logs), 'TURN: resposta sem servidores é registrada e ignorada');

    // 6) outro serviço (ICE_URL, ex.: Metered): GET numa lista pronta
    cf.mode = 'ok'; cf.user = 'm1'; cf.reqs.length = 0;
    const p4 = PORT + 104;
    procs.push(await startServer({ ICE_URL: `${base}/api/ice?apiKey=abc`, ICE_SERVERS: staticIce }, p4, true));
    await sleep(300);
    ice = await iceOf(p4);
    const g = cf.reqs.find((r) => r.url.startsWith('/api/ice'));
    check(g && g.method === 'GET' && g.url === '/api/ice?apiKey=abc', 'TURN: ICE_URL é buscado por GET', g ? `${g.method} ${g.url}` : 'nenhum pedido');
    check((turnEntry(ice) || {}).username === 'm1' && ice.some((s) => s.urls.includes('stun:stun.relay.example:3478')), 'TURN: lista no formato do Metered é aceita');

    // 7) coturn próprio com segredo compartilhado (sem nenhum serviço externo)
    const p5 = PORT + 105, SECRET = 'segredo-do-coturn-xyz';
    procs.push(await startServer({ TURN_URL: 'turn:203.0.113.7:3478?transport=udp, turn:203.0.113.7:3478?transport=tcp', TURN_SECRET: SECRET, ICE_SERVERS: staticIce, ICE_TTL_S: '7200' }, p5, true));
    ice = await iceOf(p5);
    const own = turnEntry(ice);
    const expiry = own ? Number(own.username.split(':')[0]) : 0, nowS = Math.floor(Date.now() / 1000);
    check(!!own && /^\d+:resenha$/.test(own.username) && Math.abs(expiry - (nowS + 7200)) < 30, 'coturn próprio: usuário temporário "<validade>:resenha" com a validade pedida', own && own.username);
    const want = own ? require('crypto').createHmac('sha1', SECRET).update(own.username).digest('base64') : '';
    check(!!own && own.credential === want, 'coturn próprio: senha = base64(HMAC-SHA1(segredo, usuário)), o formato que o coturn confere');
    check(own && own.urls.length === 2 && own.urls[1] === 'turn:203.0.113.7:3478?transport=tcp', 'coturn próprio: aceita lista de endereços (UDP e TCP) e limpa espaços');
    check(!JSON.stringify(ice).includes(SECRET) && !procs[4].logs.includes(SECRET), 'coturn próprio: o segredo nunca vai para os clientes nem para o log');
    check(ice[0].urls[0] === 'stun:estatico.example:3478', 'coturn próprio: os servidores fixos continuam na frente');
  } finally {
    for (const p of procs) try { p.kill(); } catch { /* ok */ }
    cf.server.close();
  }
}

/* --------------------------------------------------------------- navegador */
function stubScreen() {
  // Simula o seletor de tela (que não existe sem interface): canvas animado + tom de áudio.
  navigator.mediaDevices.getDisplayMedia = async (opts) => {
    window.__asked = JSON.stringify(opts);
    if (window.__reject) { const [n, m] = window.__reject; throw new DOMException(m, n); } // simula falhas do sistema
    const cv = document.createElement('canvas'); cv.width = 1280; cv.height = 720;
    const g = cv.getContext('2d'); let x = 0;
    setInterval(() => { g.fillStyle = '#123'; g.fillRect(0, 0, 1280, 720); g.fillStyle = '#fc4'; g.fillRect((x += 12) % 1200, 300, 80, 80); g.fillStyle = '#fff'; g.font = '48px sans-serif'; g.fillText('TELA COMPARTILHADA', 60, 120); }, 40);
    const vs = cv.captureStream(25);
    const ctx = new AudioContext(); const osc = ctx.createOscillator(); osc.frequency.value = 440;
    const dst = ctx.createMediaStreamDestination(); osc.connect(dst); osc.start();
    const vt = vs.getVideoTracks()[0];
    if (window.__muted) Object.defineProperty(vt, 'muted', { get: () => true });
    // Mesmo que o navegador mostrasse a tela inteira, janela ou aba: window.__surface escolhe (padrão: janela)
    if (window.__surface !== null) { const surf = window.__surface === undefined ? 'window' : window.__surface; const gs = vt.getSettings.bind(vt); vt.getSettings = () => ({ ...gs(), displaySurface: surf }); }
    return new MediaStream(opts && opts.audio === false ? [vt] : [vt, dst.stream.getAudioTracks()[0]]); // sem áudio pedido, o navegador não entrega
  };
}

// Liga/desliga a transmissão como a pessoa faria: botão -> janela de escolha -> "Transmitir".
async function toggleShare(p) {
  await p.click('#bScr');
  if (await p.evaluate(() => document.getElementById('shareDlg').open)) await p.click('#btnShareGo');
}
// Sem 'manual', o amigo assiste sozinho (preferência "assistir automaticamente"); com 'manual', só ao clicar em "Assistir".
const seedAuto = () => () => { try { const k = 'resenha.prefs'; const v = JSON.parse(localStorage.getItem(k) || '{}'); if (v.autoWatch === undefined) { v.autoWatch = true; localStorage.setItem(k, JSON.stringify(v)); } } catch { /* ok */ } };

async function openPeer(browser, name, code, manual = false, extra = null) {
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone', 'clipboard-read', 'clipboard-write'], viewport: { width: 1100, height: 700 } });
  await ctx.addInitScript(stubScreen);
  if (!manual) await ctx.addInitScript(seedAuto());
  if (extra) await ctx.addInitScript((e) => { try { const k = 'resenha.prefs'; const v = JSON.parse(localStorage.getItem(k) || '{}'); localStorage.setItem(k, JSON.stringify({ ...v, ...e })); } catch { /* ok */ } }, extra);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(BASE + '/');
  await page.fill('#name', name);
  await page.fill('#code', code);
  await page.click('#joinBtn');
  await page.waitForSelector('#room:not([hidden])');
  const id = await page.waitForFunction(() => window.__resenha.S.id, null, { timeout: 8000 }).then((h) => h.jsonValue());
  return { page, ctx, errors, name, id };
}

const bytes = (page, peerId, role) => page.evaluate(async ([pid, r]) => {
  const p = window.__resenha.S.peers.get(pid); if (!p || !p.pc) return -1;
  const tr = p.pc.getTransceivers()[r]; if (!tr) return -1;
  let n = 0; (await p.pc.getStats(tr.receiver.track)).forEach((s) => { if (s.type === 'inbound-rtp') n += s.bytesReceived; });
  return n;
}, [peerId, role]);

async function growing(page, peerId, role, ms = 1500) {
  const a = await bytes(page, peerId, role); await sleep(ms); const b = await bytes(page, peerId, role);
  return { a, b, ok: b > a && a >= 0 };
}
const until = (page, fn, arg, timeout = 15000) => page.waitForFunction(fn, arg, { timeout }).then(() => true).catch(() => false);
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') }); };

async function browserTests() {
  console.log('\n== Navegador (3 pessoas) ==');
  let chromium;
  try { ({ chromium } = require('playwright')); } catch { console.log('  playwright não encontrado; pulando'); return; }
  const browser = await chromium.launch({
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--disable-features=WebRtcHideLocalIpsWithMdns',
      '--autoplay-policy=no-user-gesture-required'],
  });
  const code = 'teste-' + Math.floor(Math.random() * 9000 + 1000);
  const A = await openPeer(browser, 'Ana', code);
  const B = await openPeer(browser, 'Bruno', code);
  const C = await openPeer(browser, 'Carla', code);
  const all = [A, B, C];

  if (SHOTS) {
    const lp = await browser.newPage({ viewport: { width: 1100, height: 700 } });
    await lp.goto(BASE + '/'); await shot(lp, '1-entrada'); await lp.setViewportSize({ width: 390, height: 780 }); await shot(lp, '1b-entrada-celular'); await lp.close();
  }

  const connected = (n) => { const ps = [...window.__resenha.S.peers.values()]; return ps.length === n && ps.every((p) => p.pc && p.pc.connectionState === 'connected') && window.__resenha.tiles.size === n + 1; };
  for (const p of all) check(await until(p.page, connected, 2), `${p.name}: conectado às outras 2 pessoas`);

  // voz
  for (const p of all) for (const q of all) if (p !== q) {
    const g = await growing(p.page, q.id, 0, 800);
    check(g.ok, `${p.name} recebe a voz de ${q.name}`, JSON.stringify(g));
  }

  // câmera do Bruno
  await B.page.click('#bCam');
  for (const p of [A, C]) {
    const ok = await until(p.page, (id) => { const t = window.__resenha.tiles.get(id); return t && !t.el.classList.contains('novideo') && t.video.videoWidth > 0; }, B.id);
    check(ok, `${p.name} vê a câmera do Bruno`);
  }

  // tela da Ana, com a câmera do Bruno ligada ao mesmo tempo
  await toggleShare(A.page);
  for (const p of [B, C]) {
    const ok = await until(p.page, (id) => { const t = window.__resenha.tiles.get(id + ':s'); return t && t.video.videoWidth > 0; }, A.id);
    check(ok, `${p.name} vê a tela da Ana`);
    check(await until(p.page, (id) => window.__resenha.tiles.get(id + ':s').el.classList.contains('focused'), A.id, 3000), `${p.name}: a tela da Ana vira o destaque`);
    const g = await growing(p.page, A.id, 3, 1200);
    check(g.ok, `${p.name} recebe o som da tela da Ana`, JSON.stringify(g));
  }
  const camWhileShare = await growing(C.page, B.id, 1, 1500);
  check(camWhileShare.ok, 'câmera do Bruno segue chegando na Carla enquanto a Ana compartilha a tela');
  const voiceWhileShare = await growing(C.page, A.id, 0, 1000);
  check(voiceWhileShare.ok, 'voz da Ana segue chegando na Carla durante a transmissão');
  check(await A.page.evaluate(() => !document.getElementById('live').hidden), 'Ana vê o aviso “você está transmitindo”');
  await sleep(600);
  await shot(B.page, '2-sala-tela-em-destaque');

  // silenciar
  await A.page.click('#bMic');
  check(await until(B.page, (id) => window.__resenha.S.peers.get(id).state.mic === false, A.id, 4000), 'silenciar a Ana aparece para os outros');

  // regra do som: só o da janela; nunca o do computador inteiro
  const asked = JSON.parse(await A.page.evaluate(() => window.__asked));
  check(asked.windowAudio === 'window' && asked.systemAudio === 'exclude' && asked.video.displaySurface === 'window', 'a tela pede ao navegador só o áudio da janela (windowAudio) e nenhum som do sistema (systemAudio)', JSON.stringify(asked));
  check(await A.page.evaluate(() => !!window.__resenha.L.scrA && window.__resenha.L.scrV.getSettings().displaySurface === 'window'), 'janela escolhida: o som dela é mantido');
  await toggleShare(A.page); await sleep(500);
  for (const [surface, aud, txt] of [['monitor', false, /tela inteira.*não é compartilhado/], ['browser', true, null], [undefined, false, /não consegui confirmar/]]) {
    await A.page.evaluate((s) => { window.__surface = s === undefined ? null : s; document.getElementById('toast').hidden = true; }, surface === undefined ? null : surface);
    await toggleShare(A.page); await sleep(600);
    const r = await A.page.evaluate(() => ({ live: !!window.__resenha.L.scrV, audio: !!window.__resenha.L.scrA, tx: !!window.__resenha.S.peers.values().next().value.pc.getTransceivers()[3].sender.track, toast: document.getElementById('toast').hidden ? '' : document.getElementById('toast').textContent }));
    const nome = surface === undefined ? 'sem informar o que foi escolhido' : surface === 'monitor' ? 'tela inteira' : 'aba do navegador';
    check(r.live && r.audio === aud && r.tx === aud, `${nome}: ${aud ? 'o som é mantido' : 'o som NÃO é compartilhado (descartado e nada sai para os amigos)'}`, JSON.stringify(r));
    if (txt) check(txt.test(r.toast), `${nome}: o app explica por que está sem som`, r.toast);
    await toggleShare(A.page); await sleep(400);
  }
  await A.page.evaluate(() => { window.__surface = undefined; });
  await toggleShare(A.page);
  check(await until(A.page, () => !!window.__resenha.L.scrA, null, 5000), 'voltando a escolher uma janela, o som volta');
  check((await growing(B.page, A.id, 2, 1500)).ok, 'o vídeo da tela volta a chegar nos amigos');

  // estatísticas da conexão (desligadas por padrão; Ana e Bruno ligam)
  check(await C.page.evaluate(() => [...window.__resenha.tiles.values()].every((t) => t.stats.hidden)), 'estatísticas vêm desligadas por padrão');
  for (const p of [A, B]) {
    await p.page.click('#bSet'); await sleep(200);
    await p.page.click('#chkStats'); await p.page.keyboard.press('Escape');
  }
  check(await until(A.page, (id) => { const t = window.__resenha.tiles.get(id); return t && !t.stats.hidden && /recebendo \d+×\d+ · \d+ fps/.test(t.stats.textContent) && /ligação direta/.test(t.stats.textContent); }, B.id, 6000),
    'Ana vê no vídeo do Bruno: resolução, quadros por segundo e que a ligação é direta');
  check(await until(B.page, () => /enviando \d+×\d+ · \d+ fps.*limite:/.test(window.__resenha.tiles.get('me').stats.textContent), null, 6000),
    'Bruno vê o que ele mesmo está enviando (fps, limite) na sua câmera');
  check(await until(B.page, (id) => { const t = window.__resenha.tiles.get(id + ':s'); return t && /recebendo/.test(t.stats.textContent); }, A.id, 6000), 'a tela da Ana também mostra estatísticas');
  check(await until(A.page, async () => /sua tela \(enviando\).*alvo \d+ kbps.*codificador VP8/.test(await window.__resenha.buildDiag()), null, 10000), 'quem transmite vê alvo de envio e o codificador usado (para achar a causa de um fps baixo)', await A.page.evaluate(async () => (await window.__resenha.buildDiag()).split('\n').filter((l) => /sua tela/.test(l)).join(' | ')));
  check(await until(B.page, (id) => /recebendo.*decodificador/.test(window.__resenha.tiles.get(id + ':s').stats.textContent), A.id, 8000), 'quem assiste vê o decodificador');
  check(await A.page.evaluate(async () => /codificador/.test(await window.__resenha.buildDiag())), 'o diagnóstico copiado inclui o codificador');
  check(await until(B.page, () => /prévia \d+×\d+ · \d+ fps · \d+ ms da captura à tela/.test(window.__resenha.tiles.get('me').stats.textContent), null, 8000),
    'a prévia da própria câmera mostra resolução, fps e o atraso da captura até a tela', await B.page.evaluate(() => window.__resenha.tiles.get('me').stats.textContent));
  const prevLat = await B.page.evaluate(() => Number((window.__resenha.tiles.get('me').stats.textContent.match(/(\d+) ms da captura/) || [])[1]));
  check(prevLat >= 0 && prevLat < 300, 'o atraso da prévia no app é pequeno (< 300 ms) no teste', String(prevLat));
  await shot(B.page, '2b-estatisticas');
  await B.page.click('#bSet'); await sleep(200);
  await B.page.click('#btnDiag');
  check(await until(B.page, () => /Diagnóstico copiado/.test(document.getElementById('toast').textContent), null, 8000), 'botão “Copiar diagnóstico” avisa que copiou');
  const diag = await B.page.evaluate(() => navigator.clipboard.readText()).catch((e) => String(e));
  check(/Resenha · diagnóstico/.test(diag) && /servidor TURN: NÃO/.test(diag) && /ligação com Ana: connected/.test(diag) && /ligação direta/.test(diag) && /tela de Ana/.test(diag),
    'o diagnóstico copiado traz TURN sim/não, estado de cada ligação, tipo de ligação e estatísticas', diag.slice(0, 300));
  check(!/[0-9a-f]{8}:s|undefined|NaN/.test(diag), 'o diagnóstico não mostra ids internos, undefined nem NaN', diag);
  await B.page.keyboard.press('Escape');
  for (const p of [A, B]) { await p.page.click('#bSet'); await sleep(200); await p.page.click('#chkStats'); await p.page.keyboard.press('Escape'); }
  check(await A.page.evaluate(() => [...window.__resenha.tiles.values()].every((t) => t.stats.hidden && t.stats.textContent === '')), 'desligar as estatísticas limpa o texto dos vídeos');

  // chat
  await B.page.click('#bChat');
  await B.page.fill('#chatInput', 'olá, pessoal <b>teste</b>');
  await B.page.press('#chatInput', 'Enter');
  for (const p of [A, C, B]) {
    const ok = await until(p.page, () => [...document.querySelectorAll('#msgs li')].some((li) => li.textContent.includes('olá, pessoal <b>teste</b>')), null, 4000);
    check(ok, `${p.name} recebe a mensagem (e o HTML aparece como texto)`);
  }
  check(await until(A.page, () => document.getElementById('bChat').dataset.badge === '1', null, 3000), 'Ana vê 1 mensagem não lida no botão do chat');
  check(await B.page.evaluate(() => document.querySelectorAll('#msgs b').length > 0 && !document.querySelector('#msgs li b b')), 'mensagem não injeta HTML');

  // economia: Carla minimiza => os outros param de mandar vídeo para ela (só depois de 6 s escondida)
  const hideC = () => C.page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  const showC = () => C.page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
  const rxFlag = (page) => page.evaluate((id) => { const p = window.__resenha.S.peers.get(id); return [p.rxVideo, p.pc.getTransceivers()[2].sender.getParameters().encodings[0].active]; }, C.id);
  await hideC(); await sleep(2000);
  check(JSON.stringify(await rxFlag(A.page)) === '[true,true]', 'modo economia: esconder a janela por pouco tempo (alt-tab) não corta o vídeo');
  await showC(); await sleep(5000); // o prazo de 6 s já teria vencido se o cronômetro não fosse cancelado
  check(JSON.stringify(await rxFlag(A.page)) === '[true,true]', 'modo economia: voltar antes de 6 s cancela o pedido para parar');
  await hideC();
  const paused = await until(A.page, (id) => { const p = window.__resenha.S.peers.get(id); return p.rxVideo === false && p.pc.getTransceivers()[2].sender.getParameters().encodings[0].active === false; }, C.id, 10000);
  check(paused, 'modo economia: depois de 6 s minimizada, a Ana para de enviar vídeo/tela para a Carla');
  const toB = await B.page.evaluate((id) => window.__resenha.S.peers.get(id).pc.getTransceivers()[1].sender.getParameters().encodings[0].active, A.id);
  check(toB === true, 'modo economia: o envio para quem está olhando não é afetado');
  await showC();
  check(await until(A.page, (id) => window.__resenha.S.peers.get(id).rxVideo === true, C.id, 4000), 'ao voltar, o vídeo é retomado na hora');
  const resumed = await growing(C.page, A.id, 2, 1500);
  check(resumed.ok, 'a tela da Ana volta a chegar na Carla');

  // queda do servidor de sinalização: ligações já abertas continuam e o lugar é mantido
  const idBefore = C.id;
  await C.page.evaluate(() => window.__resenha.S.ws.close());
  const back = await until(C.page, () => window.__resenha.S.ws && window.__resenha.S.ws.readyState === 1 && window.__resenha.S.retry === 0 && window.__resenha.S.welcomed, null, 8000);
  check(back, 'Carla reconecta sozinha ao servidor');
  check(await C.page.evaluate(() => window.__resenha.S.id) === idBefore, 'Carla mantém o mesmo lugar na sala');
  await sleep(500);
  check(await A.page.evaluate((id) => window.__resenha.S.peers.has(id) && window.__resenha.S.peers.get(id).pc.connectionState === 'connected', C.id), 'a chamada com a Carla não caiu para a Ana');
  check((await growing(C.page, B.id, 1, 1200)).ok, 'câmera do Bruno continua chegando na Carla depois da reconexão');

  // quadros por segundo da tela: fixo em 60, em qualquer qualidade (sem opção para mudar)
  const encOf = (page, pid) => page.evaluate((id) => { const e = window.__resenha.S.peers.get(id).pc.getTransceivers()[2].sender.getParameters().encodings[0]; return [e.maxFramerate, e.maxBitrate]; }, pid);
  const setQ = async (v) => { await A.page.click('#bSet'); await sleep(200); await A.page.selectOption('#selScrQ', v); await A.page.keyboard.press('Escape'); await sleep(300); };
  check(await A.page.evaluate(() => !document.getElementById('selScrFps')), 'não existe mais opção de quadros por segundo (120/144 removidos)');
  const brs = {};
  for (const q of ['leve', 'equilibrado', 'alta']) {
    await setQ(q);
    const [f, br] = await encOf(A.page, B.id); brs[q] = br;
    check(f === 60 && (await encOf(A.page, C.id))[0] === 60, `tela: qualidade “${q}” envia sempre 60 quadros por segundo`, String(f));
  }
  check(brs.leve < brs.equilibrado && brs.equilibrado <= brs.alta, 'tela: qualidade maior libera mais banda', JSON.stringify(brs));
  await setQ('equilibrado');
  check((await A.page.evaluate(() => window.__resenha.L.scrV.readyState)) === 'live', 'tela: trocar a qualidade no meio não derruba a transmissão');
  check((await growing(B.page, A.id, 2, 1200)).ok, 'tela: o vídeo continua chegando depois de trocar a qualidade');
  check(await A.page.evaluate(() => window.__resenha.S.maxScreens === 0), 'servidor sem relay com cota: sem limite de transmissões de tela');

  // fim da transmissão
  await toggleShare(A.page);
  for (const p of [B, C]) check(await until(p.page, (id) => !window.__resenha.tiles.has(id + ':s'), A.id, 5000), `${p.name}: tela da Ana some ao parar`);
  await sleep(500);
  await shot(A.page, '3-sala-grade');

  // ajustes
  await A.page.click('#bSet'); await sleep(300); await shot(A.page, '4-ajustes');
  const opts = await A.page.evaluate(() => ({ mic: document.getElementById('selMic').options.length, cam: document.getElementById('selCam').options.length }));
  check(opts.mic >= 1 && opts.cam >= 1, 'ajustes listam microfones e câmeras', JSON.stringify(opts));
  await A.page.keyboard.press('Escape');

  // celular
  await C.page.setViewportSize({ width: 390, height: 780 }); await sleep(400);
  await shot(C.page, '5-sala-celular');
  await C.page.setViewportSize({ width: 1100, height: 700 });

  // memória (aproximada: todos os Chromium juntos, 3 pessoas, câmera + chamada ativas)
  try {
    const rss = execSync("ps -eo rss,args | grep -E 'chrom' | grep -v grep | awk '{s+=$1} END {print int(s/1024)}'").toString().trim();
    const heaps = [];
    for (const p of all) heaps.push(Math.round(await p.page.evaluate(() => performance.memory.usedJSHeapSize / 1048576)));
    console.log(`  info  RAM total dos 3 navegadores de teste (com o motor completo do Chrome): ~${rss} MB; memória JS de cada página da Resenha: ${heaps.join(' / ')} MB`);
  } catch { /* sem ps */ }

  // sair
  await B.page.click('#bLeave');
  check(await until(B.page, () => !document.getElementById('lobby').hidden), 'Bruno volta à tela de entrada ao sair');
  check(await B.page.evaluate(() => window.__resenha.S.peers.size === 0 && window.__resenha.tiles.size === 0 && !window.__resenha.L.mic && !window.__resenha.L.cam), 'ao sair, câmera, microfone e ligações são liberados');
  for (const p of [A, C]) check(await until(p.page, () => window.__resenha.S.peers.size === 1 && window.__resenha.tiles.size === 2, null, 5000), `${p.name} vê que o Bruno saiu`);

  // sala cheia pelo navegador
  const extra = [];
  const fcode = 'cheia-' + Math.floor(Math.random() * 9000 + 1000);
  for (let i = 0; i < 8; i++) { const w = await raw(fcode, 'F' + i); await w.next((m) => m.t === 'welcome'); extra.push(w); }
  const D = await browser.newContext({ permissions: ['camera', 'microphone'] }).then((c) => c.newPage());
  await D.goto(BASE + '/'); await D.fill('#name', 'Dani'); await D.fill('#code', fcode); await D.click('#joinBtn');
  check(await until(D, () => !document.getElementById('lobby').hidden && /cheia/.test(document.getElementById('lobbyErr').textContent), null, 6000), 'sala cheia: a interface volta à entrada com aviso claro');
  extra.forEach((w) => w.ws.close());

  for (const p of all) check(p.errors.length === 0, `${p.name}: nenhum erro no console`, p.errors.slice(0, 3).join(' | '));
  await browser.close();
}



async function limitServerTests() {
  console.log('\n== Limite de transmissões de tela (servidor) ==');
  const port = PORT + 110;
  const srv = await startServer({ MAX_SCREENS: '2' }, port, true);
  try {
    const cs = [];
    for (const n of ['A', 'B', 'C', 'D']) { const c = await raw('limite-sala', n, undefined, port); const w = await c.next((m) => m.t === 'welcome'); c.id = w.id; c.welcome = w; cs.push(c); }
    const [a, b, c, d] = cs;
    check(a.welcome.limits && a.welcome.limits.screens === 2, 'boas-vindas informam o limite de 2 transmissões');
    a.send({ t: 'state', state: { mic: true, cam: false, screen: true } });
    await b.next((m) => m.t === 'state' && m.id === a.id && m.state.screen === true);
    b.send({ t: 'state', state: { mic: true, cam: false, screen: true } });
    await a.next((m) => m.t === 'state' && m.id === b.id && m.state.screen === true);
    check(true, 'duas pessoas conseguem transmitir a tela ao mesmo tempo');
    c.send({ t: 'state', state: { mic: true, cam: true, screen: true } });
    const lim = await c.next((m) => m.t === 'limit');
    check(lim.what === 'screen' && lim.max === 2, 'a terceira transmissão é recusada com aviso ao pedinte');
    await sleep(300);
    const seen = d.msgs.filter((m) => m.t === 'state' && m.id === c.id);
    check(seen.length === 1 && seen[0].state.screen === false && seen[0].state.cam === true, 'os outros não veem a terceira tela; a câmera dela segue valendo', JSON.stringify(seen));
    a.send({ t: 'state', state: { mic: false, cam: false, screen: true } });
    await sleep(300);
    check(!a.msgs.some((m) => m.t === 'limit'), 'quem já está transmitindo não é barrado ao mudar câmera/microfone');
    a.send({ t: 'state', state: { mic: true, cam: false, screen: false } });
    await c.next((m) => m.t === 'state' && m.id === a.id && m.state.screen === false);
    c.msgs.length = 0;
    c.send({ t: 'state', state: { mic: true, cam: false, screen: true } });
    await d.next((m) => m.t === 'state' && m.id === c.id && m.state.screen === true);
    check(!c.msgs.some((m) => m.t === 'limit'), 'quando uma tela para, a próxima pessoa consegue transmitir');
    // simultâneo: duas tentativas ao mesmo tempo para a última vaga
    b.send({ t: 'state', state: { mic: true, cam: false, screen: false } });
    await c.next((m) => m.t === 'state' && m.id === b.id && m.state.screen === false);
    a.msgs.length = 0; d.msgs.length = 0;
    a.send({ t: 'state', state: { mic: true, cam: false, screen: true } });
    d.send({ t: 'state', state: { mic: true, cam: false, screen: true } });
    await sleep(500);
    const denied = [a, d].filter((x) => x.msgs.some((m) => m.t === 'limit')).length;
    check(denied === 1, 'duas tentativas ao mesmo tempo para a última vaga: só uma passa', String(denied));
    cs.forEach((x) => x.ws.close());
  } finally { srv.kill(); }

  // limite automático conforme o tipo de relay
  const lim = async (env, off) => { const p = await startServer({ ...env }, PORT + off, true); try { const c = await raw('auto-' + off, 'T', undefined, PORT + off); const w = await c.next((m) => m.t === 'welcome'); c.ws.close(); return { screens: w.limits.screens, log: p.logs }; } finally { p.kill(); } };
  const dead = { CF_API_BASE: 'http://127.0.0.1:1', ICE_RETRY_MS: '60000' };
  const cf = await lim({ CF_TURN_KEY_ID: 'k', CF_TURN_API_TOKEN: 't', ...dead }, 111);
  check(cf.screens === 2 && /no máximo 2 pessoas/.test(cf.log), 'com Cloudflare configurada, o limite automático é 2 transmissões');
  const mt = await lim({ ICE_URL: 'http://127.0.0.1:1/x', ICE_RETRY_MS: '60000' }, 112);
  check(mt.screens === 2, 'com ICE_URL (serviço com cota) o limite automático também é 2');
  const own = await lim({ TURN_URL: 'turn:203.0.113.7:3478', TURN_SECRET: 'x' }, 113);
  check(own.screens === 0 && /nenhum/.test(own.log), 'com coturn próprio (sem cota) não há limite');
  const none = await lim({}, 114);
  check(none.screens === 0, 'sem TURN nenhum, não há limite');
  const off = await lim({ CF_TURN_KEY_ID: 'k', CF_TURN_API_TOKEN: 't', MAX_SCREENS: '0', ...dead }, 115);
  check(off.screens === 0, 'MAX_SCREENS=0 tira o limite mesmo com Cloudflare');
  const five = await lim({ MAX_SCREENS: '5' }, 116);
  check(five.screens === 5, 'MAX_SCREENS=5 define o limite manualmente');
  const bad = await lim({ CF_TURN_KEY_ID: 'k', CF_TURN_API_TOKEN: 't', MAX_SCREENS: 'dois', ...dead }, 117);
  check(bad.screens === 2 && /não é um número/.test(bad.log), 'MAX_SCREENS inválido é avisado e mantém o limite automático');
}

/* --------------------------------------------- limite de telas no navegador */
async function limitBrowserTests() {
  console.log('\n== Limite de transmissões de tela (navegador) ==');
  let chromium;
  try { ({ chromium } = require('playwright')); } catch { console.log('  playwright não encontrado; pulando'); return; }
  const port = PORT + 120;
  const srv = await startServer({ MAX_SCREENS: '2' }, port, true);
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--disable-features=WebRtcHideLocalIpsWithMdns'] });
  try {
    const code = 'lim-' + Math.floor(Math.random() * 9000 + 1000);
    const open = async (name) => {
      const ctx = await browser.newContext({ permissions: ['camera', 'microphone'], viewport: { width: 1100, height: 700 } });
      await ctx.addInitScript(stubScreen); await ctx.addInitScript(seedAuto());
      const page = await ctx.newPage(); page.on('pageerror', (e) => console.log('  erro de página:', e));
      await page.goto(`http://127.0.0.1:${port}/`); await page.fill('#name', name); await page.fill('#code', code); await page.click('#joinBtn');
      await page.waitForSelector('#room:not([hidden])'); await page.waitForFunction(() => window.__resenha.S.id, null, { timeout: 8000 });
      return page;
    };
    const A = await open('Ana'), B = await open('Bruno'), C = await open('Carla');
    for (const p of [A, B, C]) await p.waitForFunction(() => window.__resenha.S.peers.size === 2, null, { timeout: 15000 });
    check(await C.evaluate(() => window.__resenha.S.maxScreens) === 2, 'o app recebe o limite de transmissões do servidor');
    await toggleShare(A); await toggleShare(B);
    check(await until(C, () => [...window.__resenha.S.peers.values()].filter((p) => p.state.screen).length === 2, null, 8000), 'Ana e Bruno transmitem a tela ao mesmo tempo');
    await toggleShare(C); await sleep(400);
    const msg = await C.evaluate(() => ({ live: !!window.__resenha.L.scrV, toast: document.getElementById('toast').textContent, hidden: document.getElementById('toast').hidden }));
    check(!msg.live && !msg.hidden && /Já há 2 pessoas transmitindo a tela/.test(msg.toast), 'Carla é avisada antes mesmo de abrir o seletor de tela', JSON.stringify(msg));
    // contorna a checagem do app para provar que o servidor também barra
    await C.evaluate(() => { window.__resenha.S.maxScreens = 0; document.getElementById('toast').hidden = true; });
    await toggleShare(C);
    check(await until(C, () => !window.__resenha.L.scrV && /Já há 2 pessoas/.test(document.getElementById('toast').textContent), null, 6000), 'se o app deixar passar, o servidor recusa e o app desliga a transmissão da Carla');
    check(await A.evaluate(() => { const ps = [...window.__resenha.S.peers.values()]; const c = ps.find((p) => p.name === 'Carla'); return c && !c.state.screen; }), 'Carla não aparece como transmitindo para os outros');
    await toggleShare(B);
    check(await until(C, () => [...window.__resenha.S.peers.values()].filter((p) => p.state.screen).length === 1, null, 5000), 'Bruno para de transmitir');
    await C.evaluate(() => { window.__resenha.S.maxScreens = 2; });
    await toggleShare(C);
    check(await until(C, () => !!window.__resenha.L.scrV, null, 5000), 'com uma vaga livre, a Carla consegue transmitir');
    check(await until(A, () => [...window.__resenha.S.peers.values()].filter((p) => p.state.screen).length === 1 && window.__resenha.S.peers.size === 2, null, 5000), 'a tela da Carla aparece para a Ana');
  } finally { await browser.close(); srv.kill(); }
}


/* ------------------------------------------------ atualização automática do app */
async function updateTests() {
  console.log('\n== Atualização automática ==');
  const os = require('os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'resenha-upd-'));
  const srcApp = path.join(__dirname, '..', 'app');
  const copyApp = (name) => { const d = path.join(tmp, name); fs.cpSync(srcApp, d, { recursive: true }); return d; };
  const getJson = async (port, p) => { const r = await fetch(`http://127.0.0.1:${port}${p}`); return { r, j: await r.json().catch(() => null) }; };
  const servers = [];
  try {
    // --- servidor: versão da interface
    const dirA = copyApp('servidor');
    const p1 = PORT + 130;
    servers.push(await startServer({ APP_DIR: dirA }, p1, true));
    const v1 = await getJson(p1, '/version.json');
    check(v1.j && v1.j.app === 'resenha' && /^[0-9a-f]{8}$/.test(v1.j.build), '/version.json informa app e versão da interface (8 caracteres)', JSON.stringify(v1.j));
    check(v1.r.headers.get('access-control-allow-origin') === '*' && /no-store/.test(v1.r.headers.get('cache-control')), '/version.json libera o app instalado (CORS) e nunca é guardado em cache');
    const c = await raw('upd-sala', 'Ana', undefined, p1); const w = await c.next((m) => m.t === 'welcome'); c.ws.close();
    check(w.build === v1.j.build, 'as boas-vindas trazem a mesma versão');
    const css = await fetch(`http://127.0.0.1:${p1}/style.css`); const et = css.headers.get('etag');
    const again = await fetch(`http://127.0.0.1:${p1}/style.css`, { headers: { 'if-none-match': et } });
    check(!!et && again.status === 304, 'arquivos da interface usam ETag: segunda abertura responde 304 (rápida)');
    servers[0].kill(); await sleep(300);
    servers.push(await startServer({ APP_DIR: dirA }, p1 + 1, true));
    check((await getJson(p1 + 1, '/version.json')).j.build === v1.j.build, 'mesma interface => mesma versão, mesmo após reiniciar');
    servers[1].kill(); await sleep(300);
    fs.appendFileSync(path.join(dirA, 'app.js'), '\n// mudança\n');
    servers.push(await startServer({ APP_DIR: dirA }, p1 + 2, true));
    const v2 = await getJson(p1 + 2, '/version.json');
    check(v2.j.build !== v1.j.build, 'qualquer mudança nos arquivos muda a versão', `${v1.j.build} -> ${v2.j.build}`);

    // --- app instalado (file://): passa a mostrar a interface do servidor
    let chromium;
    try { ({ chromium } = require('playwright')); } catch { console.log('  playwright não encontrado; pulando a parte do navegador'); return; }
    const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
    try {
      const srvPort = p1 + 3;
      servers.push(await startServer({}, srvPort, true));
      const installed = (name, serverHost) => {
        const d = copyApp(name);
        fs.writeFileSync(path.join(d, 'config.js'), `window.RESENHA_CONFIG = { server: ${JSON.stringify(serverHost)} };\n`);
        fs.writeFileSync(path.join(d, 'index.html'), fs.readFileSync(path.join(d, 'index.html'), 'utf8').replace('<title>Resenha</title>', '<title>Resenha INSTALADA ANTIGA</title>'));
        return d;
      };
      const open = async (dir, seed) => {
        const ctx = await browser.newContext({ permissions: ['camera', 'microphone'] });
        if (seed) await ctx.addInitScript((sd) => { if (location.protocol === 'file:') localStorage.setItem('resenha.prefs', JSON.stringify(sd)); }, seed);
        const page = await ctx.newPage();
        await page.goto('file://' + path.join(dir, 'index.html'));
        return { page, ctx };
      };

      let t = await open(installed('inst-ok', `127.0.0.1:${srvPort}`), { name: 'Zé da Silva', scrQ: 'alta', cam: 'id-que-nao-deve-ir' });
      check(await until(t.page, () => location.protocol === 'http:', null, 8000), 'app instalado com servidor configurado passa a abrir a interface do servidor');
      await t.page.waitForFunction(() => window.__resenha, null, { timeout: 8000 });
      check(await t.page.evaluate(() => document.title === 'Resenha'), 'a interface mostrada é a do servidor (não a cópia antiga instalada)');
      const pr = await t.page.evaluate(() => ({ name: window.__resenha.prefs.name, q: window.__resenha.prefs.scrQ, cam: window.__resenha.prefs.cam, url: location.search }));
      check(pr.name === 'Zé da Silva' && pr.q === 'alta' && pr.cam === '' && pr.url === '', 'nome e qualidade vão junto; dispositivos não; o endereço fica limpo', JSON.stringify(pr));
      const ver = await t.page.evaluate(() => fetch('/version.json').then((r) => r.json()));
      check(await until(t.page, (b) => document.getElementById('verInfo').textContent.includes(b), ver.build, 4000), 'ajustes mostram a versão da interface', ver.build);
      await t.ctx.close();

      t = await open(installed('inst-morto', '127.0.0.1:1'));
      const t0 = Date.now();
      check(await until(t.page, () => getComputedStyle(document.documentElement).visibility === 'visible' && !document.getElementById('lobby').hidden, null, 6000), 'servidor fora do ar: o app volta a mostrar a cópia local');
      const waited = Date.now() - t0;
      check(await t.page.evaluate(() => location.protocol === 'file:' && document.title.includes('ANTIGA') && /local/.test(document.getElementById('verInfo').textContent)), 'servidor fora do ar: continua na cópia local e avisa que não há atualização', `${waited} ms`);
      await t.ctx.close();

      const other = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end('{"app":"outro"}'); });
      await new Promise((r) => other.listen(0, '127.0.0.1', r));
      t = await open(installed('inst-outro', `127.0.0.1:${other.address().port}`));
      await sleep(1500);
      check(await t.page.evaluate(() => location.protocol === 'file:' && getComputedStyle(document.documentElement).visibility === 'visible'), 'endereço que não é um servidor da Resenha: não troca de interface');
      await t.ctx.close(); other.close();

      t = await open(installed('inst-vazio', ''));
      await sleep(600);
      check(await t.page.evaluate(() => location.protocol === 'file:' && getComputedStyle(document.documentElement).visibility === 'visible' && document.getElementById('adv').open), 'sem servidor configurado: mostra a tela local pedindo o endereço, sem espera');
      await t.ctx.close();

      // --- aviso de versão nova com a janela aberta
      const ctx = await browser.newContext({ permissions: ['camera', 'microphone'] });
      const pg = await ctx.newPage();
      await pg.goto(`http://127.0.0.1:${srvPort}/`); await pg.fill('#name', 'Rui'); await pg.fill('#code', 'versao-' + Math.floor(Math.random() * 9000 + 1000)); await pg.click('#joinBtn');
      await pg.waitForFunction(() => window.__resenha.S.id && window.__resenha.S.build, null, { timeout: 8000 });
      check(await pg.evaluate(() => !document.getElementById('toast').textContent.includes('versão nova') || document.getElementById('toast').hidden), 'versão igual: nenhum aviso');
      await pg.evaluate(() => { window.__resenha.S.build = 'antiga00'; window.__resenha.S.ws.close(); });
      check(await until(pg, () => /Saiu uma versão nova/.test(document.getElementById('toast').textContent) && !document.getElementById('toast').hidden, null, 9000), 'servidor atualizado com a janela aberta: avisa para reabrir, sem derrubar a chamada');
      check(await pg.evaluate(() => window.__resenha.S.welcomed && !document.getElementById('room').hidden), 'a pessoa continua na sala depois do aviso');
      await ctx.close();
    } finally { await browser.close(); }
  } finally { servers.forEach((x) => { try { x.kill(); } catch { /* ok */ } }); fs.rmSync(tmp, { recursive: true, force: true }); }
}


/* ------------------------------------------------ "Assistir" e janela de escolha */
async function watchTests() {
  console.log('\n== Transmissão estilo Discord (Assistir, escolha antes de transmitir) ==');
  let chromium;
  try { ({ chromium } = require('playwright')); } catch { console.log('  playwright não encontrado; pulando'); return; }
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--disable-features=WebRtcHideLocalIpsWithMdns'] });
  try {
    const code = 'watch-' + Math.floor(Math.random() * 9000 + 1000);
    const A = await openPeer(browser, 'Ana', code, true);   // quem transmite
    const B = await openPeer(browser, 'Bruno', code, true); // só assiste se clicar
    const C = await openPeer(browser, 'Carla', code);       // assiste sozinha (preferência ligada)
    for (const p of [A, B, C]) await p.page.waitForFunction(() => window.__resenha.S.peers.size === 2, null, { timeout: 15000 });
    const asked = () => A.page.evaluate(() => JSON.parse(window.__asked));
    const dlg = (page) => page.evaluate(() => document.getElementById('shareDlg').open);

    // janela de escolha: abre, tem as 3 opções, cancelar não transmite
    await A.page.click('#bScr');
    check(await dlg(A.page), 'ao clicar em compartilhar, abre a janela de escolha em vez de já capturar');
    check(await A.page.evaluate(() => [...document.getElementById('selShareType').options].map((o) => o.value).join()) === 'window,window-silent,browser,monitor', 'a janela oferece: janela, janela sem som, aba e tela inteira');
    check(await A.page.evaluate(() => document.getElementById('shareHint').textContent.length > 10), 'a janela explica como fica o som da opção escolhida');
    await shot(A.page, '7b-janela-transmitir');
    await A.page.click('#btnShareCancel');
    check(!(await dlg(A.page)) && await A.page.evaluate(() => !window.__resenha.L.scrV), 'cancelar não começa a transmitir');

    // falhas do seletor nunca ficam em silêncio
    for (const [n, m, re] of [['AbortError', 'Could not start video source', /não conseguiu começar a captura.*AbortError/], ['NotAllowedError', 'Permission denied by system', /Windows bloqueou a captura/], ['NotAllowedError', 'Permission denied', /Compartilhamento cancelado/], ['TypeError', 'algo estranho', /TypeError: algo estranho/]]) {
      await A.page.evaluate((r) => { window.__reject = r; document.getElementById('toast').hidden = true; }, [n, m]);
      await toggleShare(A.page);
      check(await until(A.page, (src) => { const t = document.getElementById('toast'); return !t.hidden && new RegExp(src).test(t.textContent); }, re.source, 3000), `falha ${n} (“${m}”) mostra um aviso claro`, await A.page.evaluate(() => document.getElementById('toast').textContent));
      check(await A.page.evaluate(() => !window.__resenha.L.scrV), `falha ${n}: não fica "transmitindo" sem transmitir`);
    }
    // seletor que nunca responde: avisa; captura sem quadros: avisa
    await A.page.evaluate(() => { window.RESENHA_CONFIG.pickerWaitMs = 1200; window.__reject = null; const orig = navigator.mediaDevices.getDisplayMedia; window.__orig = orig; navigator.mediaDevices.getDisplayMedia = () => new Promise(() => {}); document.getElementById('toast').hidden = true; });
    await A.page.click('#bScr'); await A.page.click('#btnShareGo');
    check(await until(A.page, () => /ainda não respondeu/.test(document.getElementById('toast').textContent) && !document.getElementById('toast').hidden, null, 4000), 'seletor que nunca responde: o app avisa');
    // com o pedido pendurado, nova tentativa não abre outro pedido: explica o que fazer
    await A.page.evaluate(() => { document.getElementById('toast').hidden = true; });
    await A.page.click('#bScr');
    check(await until(A.page, () => /Ainda há um pedido de captura em andamento/.test(document.getElementById('toast').textContent) && !document.getElementById('toast').hidden, null, 3000), 'pedido pendurado: nova tentativa explica o que fazer (F5)');
    check(await A.page.evaluate(() => !document.getElementById('shareDlg').open), 'pedido pendurado: não abre outra janela de escolha');
    await A.page.evaluate(() => { window.__resenha.S.sharePending = false; });
    await A.page.evaluate(() => { navigator.mediaDevices.getDisplayMedia = window.__orig; window.__muted = true; document.getElementById('toast').hidden = true; });
    await toggleShare(A.page);
    check(await until(A.page, () => /nenhuma imagem está chegando/.test(document.getElementById('toast').textContent) && !document.getElementById('toast').hidden, null, 8000), 'captura que não entrega quadros: o app avisa');
    check(await A.page.evaluate(async () => /passos da transmissão: .*captura recebida em \d+ ms: window.*transmissão no ar.*não entregou quadros/.test(await window.__resenha.buildDiag())), 'o diagnóstico mostra os passos da transmissão');
    check(await A.page.evaluate(async () => /aplicativo: navegador · captura de tela permitida/.test(await window.__resenha.buildDiag())), 'o diagnóstico diz se é o app instalado ou o navegador');
    await A.page.evaluate(() => { window.__muted = false; }); await toggleShare(A.page); await sleep(300);
    check(await A.page.evaluate(async () => /último erro: .*TypeError · algo estranho/.test(await window.__resenha.buildDiag())), 'o último erro de transmissão vai no diagnóstico');
    await A.page.evaluate(() => { window.__reject = null; });

    // tela inteira: sem pedir som, e o app lembra a escolha
    await A.page.click('#bScr'); await A.page.selectOption('#selShareType', 'monitor'); await A.page.selectOption('#selShareQ', 'alta'); await A.page.click('#btnShareGo');
    check(await until(A.page, () => !!window.__resenha.L.scrV, null, 5000), 'tela inteira: transmissão começa');
    let o = await asked();
    check(o.audio === false && o.video.displaySurface === 'monitor' && o.video.frameRate.max === 60, 'tela inteira: não pede som e pede 60 fps', JSON.stringify(o));
    check(await A.page.evaluate(() => window.__resenha.prefs.scrQ === 'alta' && window.__resenha.prefs.shareType === 'monitor'), 'o app lembra o tipo e a qualidade escolhidos');
    check(await A.page.evaluate(() => !document.getElementById('toast') || document.getElementById('toast').hidden || !/sem som/.test(document.getElementById('toast').textContent)), 'tela inteira escolhida de propósito: sem aviso de erro');
    await toggleShare(A.page); await sleep(300);

    // janela sem som: não pede áudio algum (evita a trava de áudio em janelas de navegador)
    await A.page.click('#bScr'); await A.page.selectOption('#selShareType', 'window-silent'); await A.page.click('#btnShareGo');
    check(await until(A.page, () => !!window.__resenha.L.scrV, null, 5000), 'janela sem som: transmissão começa');
    o = await asked();
    check(o.audio === false && o.windowAudio === undefined && o.video.displaySurface === 'window' && o.monitorTypeSurfaces === 'exclude', 'janela sem som: pede janela e nenhum áudio', JSON.stringify(o));
    check(await A.page.evaluate(() => !window.__resenha.L.scrA), 'janela sem som: nenhum áudio é enviado');
    await toggleShare(A.page); await sleep(300);

    // aba: não oferece a própria aba e mantém o som; janela: exclui telas inteiras
    await A.page.click('#bScr'); await A.page.selectOption('#selShareType', 'browser'); await A.page.click('#btnShareGo');
    await until(A.page, () => !!window.__resenha.L.scrV, null, 5000);
    o = await asked();
    check(o.video.displaySurface === 'browser' && o.selfBrowserSurface === 'exclude' && o.windowAudio === 'window', 'aba: pede a aba, sem a própria Resenha, com o som dela', JSON.stringify(o));
    await toggleShare(A.page); await sleep(300);
    await A.page.click('#bScr'); await A.page.selectOption('#selShareType', 'window'); await A.page.selectOption('#selShareQ', 'equilibrado'); await A.page.click('#btnShareGo');
    await until(A.page, () => !!window.__resenha.L.scrV, null, 5000);
    o = await asked();
    check(o.video.displaySurface === 'window' && o.monitorTypeSurfaces === 'exclude' && o.windowAudio === 'window' && o.systemAudio === 'exclude', 'janela: pede janela, esconde telas inteiras e só o som dela', JSON.stringify(o));

    // bloco "Assistir"
    for (const p of [B, C]) check(await until(p.page, (id) => { const q = window.__resenha.S.peers.get(id); return q && q.state.screen; }, A.id, 5000), `${p.name} vê que a Ana está transmitindo`);
    check(await until(C.page, (id) => window.__resenha.tiles.get(id + ':s').video.videoWidth > 0, A.id, 8000), 'Carla (assistir automático) recebe a tela');
    const blockB = await B.page.evaluate((id) => { const t = window.__resenha.tiles.get(id + ':s'); const cs = (e) => getComputedStyle(e).display; return { locked: t.el.classList.contains('locked'), cta: cs(t.cta), leave: cs(t.leave), text: t.cta.textContent, hasStream: !!t.video.srcObject }; }, A.id);
    check(blockB.locked && blockB.cta !== 'none' && blockB.leave === 'none' && !blockB.hasStream && /Ana está transmitindo a tela/.test(blockB.text) && /Assistir/.test(blockB.text), 'Bruno vê o bloco “Ana está transmitindo a tela” com o botão Assistir, sem vídeo', JSON.stringify(blockB));
    const idle = await growing(B.page, A.id, 2, 1500);
    const idleA = await growing(B.page, A.id, 3, 800);
    check(!idle.ok && !idleA.ok, 'sem clicar em Assistir, nenhum vídeo nem som da tela chega ao Bruno', JSON.stringify([idle, idleA]));
    check((await growing(C.page, A.id, 2, 1500)).ok && (await growing(C.page, A.id, 3, 1200)).ok, 'a Carla, que assiste, recebe vídeo e som da tela');
    check(await until(B.page, (id) => window.__resenha.S.peers.get(id).state.viewers === 1, A.id, 5000), 'o contador mostra 1 pessoa assistindo (Bruno vê)');
    check(await A.page.evaluate(() => /1 pessoa assistindo/.test(document.getElementById('live').textContent)), 'Ana vê “1 pessoa assistindo” no aviso de transmissão');
    check(await B.page.evaluate((id) => /1 pessoa assistindo/.test(window.__resenha.tiles.get(id + ':s').cta.textContent), A.id), 'o bloco mostra quantas pessoas estão assistindo');

    await shot(B.page, '7a-bloco-assistir');
    // Bruno clica em Assistir
    await B.page.click('.tile.screen .cta button');
    check(await until(B.page, (id) => window.__resenha.tiles.get(id + ':s').video.videoWidth > 0, A.id, 8000), 'clicou em Assistir: o vídeo chega');
    check((await growing(B.page, A.id, 2, 1500)).ok && (await growing(B.page, A.id, 3, 1200)).ok, 'Bruno passa a receber vídeo e som da tela');
    check(await until(A.page, () => /2 pessoas assistindo/.test(document.getElementById('live').textContent), null, 5000), 'Ana vê “2 pessoas assistindo”');
    check(await B.page.evaluate((id) => { const t = window.__resenha.tiles.get(id + ':s'); return getComputedStyle(t.cta).display === 'none' && getComputedStyle(t.leave).display !== 'none'; }, A.id), 'assistindo: some o botão Assistir e aparece “Sair da transmissão”');

    check(await A.page.evaluate(() => [...window.__resenha.S.peers.values()].every((p) => p.pc.getTransceivers()[2].sender.getParameters().encodings[0].maxBitrate === 4500000)), 'com 2 assistindo em Equilibrada, cada um tem teto de 4,5 Mbps (e 60 fps)');
    check(await until(A.page, async () => /histórico, enviando a sua tela, app na frente, \d+ s: quadros por segundo min \d+ \/ média \d+ \/ máx \d+.*captura entrega em média \d+ fps.*limite: internet \d+%/.test(await window.__resenha.buildDiag()), null, 20000), 'o diagnóstico de quem transmite traz o histórico (fps mín/média/máx, captura, limite)');
    check(await until(B.page, async () => /histórico, assistindo Ana, app na frente, \d+ s: quadros por segundo min .*perda média \d+%.*travadas \+\d+/.test(await window.__resenha.buildDiag()), null, 20000), 'o diagnóstico de quem assiste traz o histórico (fps, perda, travadas)');
    // simula o jogo na frente (app escondido): as amostras continuam sendo gravadas, separadas das de "app na frente"
    await A.page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); });
    check(await until(A.page, async () => /histórico, enviando a sua tela, app escondido \(ex\.: jogo na frente\), \d+ s:/.test((await window.__resenha.buildDiag())), null, 20000), 'com o app escondido o gravador continua medindo e separa essas amostras');
    await A.page.evaluate(() => { delete document.hidden; });
    // Bruno sai
    await B.page.click('.tile.screen .leave-stream');
    check(await until(A.page, () => /1 pessoa assistindo/.test(document.getElementById('live').textContent), null, 5000), 'Bruno saiu: volta a 1 pessoa assistindo');
    await sleep(800);
    check(!(await growing(B.page, A.id, 2, 1500)).ok, 'depois de sair, o vídeo para de chegar ao Bruno');
    check((await growing(C.page, A.id, 2, 1200)).ok, 'a Carla continua assistindo normalmente');

    // preferência "assistir automaticamente" ligada na hora
    await B.page.evaluate(() => { document.getElementById('bSet').click(); });
    await B.page.check('#chkAuto');
    check(await until(B.page, (id) => window.__resenha.S.peers.get(id).watching === true, A.id, 3000), 'ligar “assistir automaticamente” já começa a assistir a transmissão em andamento');
    await B.page.evaluate(() => document.getElementById('settings').close());

    // a Ana para: tudo zera
    await toggleShare(A.page);
    check(await until(B.page, (id) => { const q = window.__resenha.S.peers.get(id); return q && !q.state.screen && !q.watching && !window.__resenha.tiles.has(id + ':s'); }, A.id, 5000), 'ao parar, o bloco some e ninguém fica “assistindo”');
    check(await A.page.evaluate(() => [...window.__resenha.S.peers.values()].every((p) => !p.wantsScreen)), 'a Ana zera os espectadores');

    // transmite de novo: Bruno (agora automático) assiste sem clicar; Carla também
    await A.page.click('#bScr'); await A.page.click('#btnShareGo');
    check(await until(B.page, (id) => { const t = window.__resenha.tiles.get(id + ':s'); return t && t.video.videoWidth > 0; }, A.id, 8000), 'nova transmissão: Bruno, com “automático”, recebe sem clicar');
    check(await until(A.page, () => /2 pessoas assistindo/.test(document.getElementById('live').textContent), null, 6000), 'nova transmissão: 2 pessoas assistindo');

    // servidor: contador de espectadores vem limitado (0..99, inteiro)
    check(await A.page.evaluate(() => { const v = window.__resenha.S.peers.values().next().value.state.viewers; return Number.isInteger(v) && v >= 0 && v <= 99; }), 'o servidor repassa o contador como inteiro entre 0 e 99');

    for (const p of [A, B, C]) check(p.errors.length === 0, `${p.name}: sem erros no console`, p.errors.join(' | '));
    await shot(B.page, '7-assistir');
  } finally { await browser.close(); }
}


/* ------------------------------------------------ codificador H.264 (experimental) */
async function codecTests() {
  console.log('\n== Codificador da tela (H.264 opcional) ==');
  let chromium;
  try { ({ chromium } = require('playwright')); } catch { console.log('  playwright não encontrado; pulando'); return; }
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--disable-features=WebRtcHideLocalIpsWithMdns'] });
  try {
    for (const [label, pa, pb, want] of [['os dois escolhem H.264', 'h264', 'h264', 'H264'], ['só um escolhe H.264', 'h264', 'auto', null], ['padrão (nenhum escolhe)', 'auto', 'auto', 'VP8']]) {
      const code = 'cod-' + Math.floor(Math.random() * 90000);
      const A = await openPeer(browser, 'Ana', code, false, { scrCodec: pa });
      const B = await openPeer(browser, 'Bruno', code, false, { scrCodec: pb });
      for (const p of [A, B]) await p.page.waitForFunction(() => window.__resenha.S.peers.size === 1, null, { timeout: 15000 });
      await toggleShare(A.page);
      check(await until(B.page, (id) => window.__resenha.tiles.get(id + ':s') && window.__resenha.tiles.get(id + ':s').video.videoWidth > 0, A.id, 10000), `${label}: a tela chega ao amigo`);
      check((await growing(B.page, A.id, 2, 1500)).ok, `${label}: o vídeo da tela está fluindo`);
      const diag = await A.page.evaluate(async () => (await window.__resenha.buildDiag()).split('\n').filter((l) => /sua tela/.test(l)).join(' '));
      if (want) check(new RegExp(`codificador ${want}`).test(diag), `${label}: a tela usa ${want}`, diag);
      else check(/codificador (VP8|H264)/.test(diag), `${label}: ligação funciona com codec ${(diag.match(/codificador (\w+)/) || [])[1]}`, diag);
      check(A.errors.length === 0 && B.errors.length === 0, `${label}: sem erros no console`, [...A.errors, ...B.errors].join(' | '));
      await A.page.context().close(); await B.page.context().close();
    }
  } finally { await browser.close(); }
}

/* ------------------------------------------- rede que bloqueia a ligação direta */
async function blockedTests() {
  console.log('\n== Rede sem ligação direta (simulada) ==');
  let chromium;
  try { ({ chromium } = require('playwright')); } catch { console.log('  playwright não encontrado; pulando'); return; }
  // Esta opção impede o WebRTC de usar UDP: é o que acontece com internet que só deixa passar HTTPS.
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'] });
  const code = 'bloq-' + Math.floor(Math.random() * 9000 + 1000);
  const A = await openPeer(browser, 'Ana', code);
  const B = await openPeer(browser, 'Bruno', code);
  const peerState = (page) => page.evaluate(() => { const p = [...window.__resenha.S.peers.values()][0]; return p ? { stuck: p.stuck, st: p.pc && p.pc.connectionState, label: [...window.__resenha.tiles.values()].map((t) => t.el.textContent).join(' | ') } : null; });
  await sleep(2000);
  const early = await peerState(B.page);
  check(early && early.stuck === false && /conectando/.test(early.label), 'sem ligação ainda: o vídeo do amigo diz “conectando…”', JSON.stringify(early));
  check(await until(B.page, () => [...window.__resenha.S.peers.values()].some((p) => p.stuck), null, 25000), 'passados ~15 s sem conectar, o app marca a ligação como travada');
  const late = await peerState(B.page);
  check(late && /sem conexão/.test(late.label), 'o vídeo do amigo passa a dizer “sem conexão”', JSON.stringify(late));
  check(await B.page.evaluate(() => { const t = document.getElementById('toast'); return !t.hidden && /bloqueia a ligação direta.*TURN/.test(t.textContent); }), 'aparece um aviso dizendo que falta o servidor TURN');
  const hasTurn = await B.page.evaluate(() => window.__resenha.S.hasTurn);
  check(hasTurn === false, 'sem TURN configurado, o app sabe que não há relay');
  await shot(B.page, '6-sem-conexao');
  await browser.close();
}

/* ---------------------------------------------------------------------- */
(async () => {
  const srv = await startServer();
  try {
    const only = process.env.ONLY || '';
    if (!only || only === 'server') await serverTests();
    if (!only || only === 'turn') await turnTests();
    if (!only || only === 'browser') await browserTests();
    if (!only || only === 'blocked') await blockedTests();
    if (!only || only === 'watch') await watchTests();
    if (!only || only === 'codec') await codecTests();
    if (!only || only === 'update') await updateTests();
    if (!only || only === 'limit') { await limitServerTests(); await limitBrowserTests(); }
  } catch (e) {
    fail++; failures.push('exceção: ' + e.message); console.error(e);
  } finally {
    srv.kill();
  }
  console.log(`\n${pass} ok, ${fail} falhas`);
  if (fail) { console.log('Falhas:\n - ' + failures.join('\n - ')); process.exit(1); }
})();
