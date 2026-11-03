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
function startServer() {
  const p = spawn('node', [path.join(__dirname, '..', 'server', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), ICE_SERVERS: '[]', GRACE_MS: '3000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    p.stdout.on('data', (d) => { if (String(d).includes('no ar')) resolve(p); });
    p.stderr.on('data', (d) => process.stderr.write(d));
    p.on('exit', (c) => reject(new Error('servidor saiu: ' + c)));
    setTimeout(() => reject(new Error('servidor não subiu')), 5000);
  });
}

function raw(room, name, id) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
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

/* --------------------------------------------------------------- navegador */
function stubScreen() {
  // Simula o seletor de tela (que não existe sem interface): canvas animado + tom de áudio.
  navigator.mediaDevices.getDisplayMedia = async () => {
    const cv = document.createElement('canvas'); cv.width = 1280; cv.height = 720;
    const g = cv.getContext('2d'); let x = 0;
    setInterval(() => { g.fillStyle = '#123'; g.fillRect(0, 0, 1280, 720); g.fillStyle = '#fc4'; g.fillRect((x += 12) % 1200, 300, 80, 80); g.fillStyle = '#fff'; g.font = '48px sans-serif'; g.fillText('TELA COMPARTILHADA', 60, 120); }, 40);
    const vs = cv.captureStream(25);
    const ctx = new AudioContext(); const osc = ctx.createOscillator(); osc.frequency.value = 440;
    const dst = ctx.createMediaStreamDestination(); osc.connect(dst); osc.start();
    return new MediaStream([vs.getVideoTracks()[0], dst.stream.getAudioTracks()[0]]);
  };
}

async function openPeer(browser, name, code) {
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'], viewport: { width: 1100, height: 700 } });
  await ctx.addInitScript(stubScreen);
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
  await A.page.click('#bScr');
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

  // economia: Carla minimiza => os outros param de mandar vídeo para ela
  await C.page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  const paused = await until(A.page, (id) => { const p = window.__resenha.S.peers.get(id); return p.rxVideo === false && p.pc.getTransceivers()[2].sender.getParameters().encodings[0].active === false; }, C.id, 4000);
  check(paused, 'modo economia: a Ana para de enviar vídeo/tela para a Carla minimizada');
  const toB = await B.page.evaluate((id) => window.__resenha.S.peers.get(id).pc.getTransceivers()[1].sender.getParameters().encodings[0].active, A.id);
  check(toB === true, 'modo economia: o envio para quem está olhando não é afetado');
  await C.page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
  check(await until(A.page, (id) => window.__resenha.S.peers.get(id).rxVideo === true, C.id, 4000), 'ao voltar, o vídeo é retomado');
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

  // fim da transmissão
  await A.page.click('#bScr');
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

/* ---------------------------------------------------------------------- */
(async () => {
  const srv = await startServer();
  try {
    await serverTests();
    await browserTests();
  } catch (e) {
    fail++; failures.push('exceção: ' + e.message); console.error(e);
  } finally {
    srv.kill();
  }
  console.log(`\n${pass} ok, ${fail} falhas`);
  if (fail) { console.log('Falhas:\n - ' + failures.join('\n - ')); process.exit(1); }
})();
