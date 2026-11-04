'use strict';
/*
 * Resenha — cliente.
 * Cada pessoa liga direto em cada outra (malha WebRTC). Cada ligação tem 4 "faixas" fixas:
 *   0 microfone · 1 câmera · 2 tela (vídeo) · 3 tela (áudio)
 * Como as faixas já existem desde o começo, ligar/desligar câmera ou tela é só trocar a faixa:
 * nunca há renegociação, e câmera + tela + voz funcionam ao mesmo tempo.
 */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const CFG = window.RESENHA_CONFIG || {};
  const isApp = location.protocol === 'tauri:' || location.protocol === 'file:' || location.hostname === 'tauri.localhost';

  /* ------------------------------------------------------------ preferências */
  const store = {
    get(k, d) { try { const v = localStorage.getItem('resenha.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('resenha.' + k, JSON.stringify(v)); } catch { /* sem armazenamento */ } },
  };
  const prefs = Object.assign(
    { name: '', server: '', mic: '', cam: '', spk: '', camQ: 'leve', scrQ: 'equilibrado', eco: true, preview: false, stats: false },
    store.get('prefs', {})
  );
  const savePrefs = () => store.set('prefs', prefs);
  // Vindo do app instalado (boot.js): traz nome e qualidade na primeira vez e limpa o endereço.
  try {
    const q = new URLSearchParams(location.search).get('p');
    if (q) {
      const carry = JSON.parse(decodeURIComponent(escape(atob(q))));
      if (!store.get('prefs', null)) for (const k of ['name', 'camQ', 'scrQ', 'eco', 'preview', 'stats']) if (carry[k] !== undefined && typeof carry[k] === typeof prefs[k]) prefs[k] = carry[k];
      savePrefs();
      history.replaceState(null, '', location.pathname + location.hash);
    }
  } catch { /* ignora */ }

  // kbps é só o teto: o WebRTC mede a internet e desce sozinho se não der.
  const CAM_Q = { leve: { w: 640, h: 360, fps: 30, kbps: 800 }, normal: { w: 1280, h: 720, fps: 30, kbps: 1800 } };
  // A tela sai sempre a 60 quadros por segundo (fixo). A qualidade muda só a resolução e o teto de banda.
  const SCR_FPS = 60;
  const SCR_Q = {
    leve: { w: 1280, h: 720, fps: SCR_FPS, kbps: 1500, hint: 'motion' },
    equilibrado: { w: 1280, h: 720, fps: SCR_FPS, kbps: 2500, hint: 'motion' },
    alta: { w: 1920, h: 1080, fps: SCR_FPS, kbps: 4500, hint: 'motion' },
  };
  const scrSpec = () => ({ ...(SCR_Q[prefs.scrQ] || SCR_Q.equilibrado), pool: 8000 }); // pool: teto total de envio da tela, dividido entre os amigos
  const ROLE_MIC = 0, ROLE_CAM = 1, ROLE_SCR = 2, ROLE_SCRA = 3;

  /* ------------------------------------------------------------------ estado */
  const S = {
    ws: null, id: null, name: '', room: '', max: 8,
    ice: [{ urls: ['stun:stun.l.google.com:19302'] }],
    peers: new Map(), leaving: false, welcomed: false, retry: 0, retryTimer: 0,
    focus: null, unread: 0, chatOpen: false, maxScreens: 0, build: '', staleWarned: false,
  };
  const L = { mic: null, cam: null, scrV: null, scrA: null, micOn: true }; // mídia local

  const el = {};
  for (const id of ['lobby', 'room', 'joinForm', 'name', 'code', 'server', 'adv', 'lobbyErr', 'joinBtn', 'createBtn',
    'stage', 'empty', 'roomCode', 'count', 'net', 'live', 'copyInvite', 'chat', 'msgs', 'chatForm', 'chatInput',
    'bMic', 'bCam', 'bScr', 'bChat', 'bSet', 'bLeave', 'settings', 'selMic', 'selCam', 'selSpk', 'spkRow',
    'selCamQ', 'selScrQ', 'verInfo', 'chkEco', 'chkPreview', 'chkStats', 'btnDiag', 'toast']) el[id] = document.getElementById(id);

  /* ------------------------------------------------------------------- utils */
  let toastTimer = 0;
  function toast(msg, ms = 4500) {
    el.toast.textContent = msg; el.toast.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.toast.hidden = true; }, ms);
  }

  function mediaMsg(e, what) {
    if (!navigator.mediaDevices) return 'O sistema bloqueou o acesso à câmera e ao microfone. Abra a Resenha por https:// ou localhost.';
    switch (e && e.name) {
      case 'NotAllowedError': case 'SecurityError': return `Sem permissão para usar ${what}. Libere nas configurações do sistema.`;
      case 'NotFoundError': case 'OverconstrainedError': return `Não encontrei ${what}. Conecte um dispositivo e tente de novo.`;
      case 'NotReadableError': return `${what[0].toUpperCase()}${what.slice(1)} está em uso por outro programa.`;
      default: return `Não consegui abrir ${what}.`;
    }
  }

  const WORDS = ['lua', 'sol', 'mar', 'rio', 'vento', 'fogo', 'pedra', 'nuvem', 'folha', 'onda', 'trem', 'gato', 'lobo', 'pipa',
    'cacau', 'milho', 'coco', 'jade', 'ouro', 'neve', 'brisa', 'tigre', 'sapo', 'rosa', 'pixel', 'cometa', 'farol', 'ponte',
    'trigo', 'mel', 'cravo', 'areia'];
  function rand(n) { return crypto.getRandomValues(new Uint32Array(1))[0] % n; }
  function newCode() { return `${WORDS[rand(WORDS.length)]}-${WORDS[rand(WORDS.length)]}-${1000 + rand(9000)}`; }
  function cleanCode(s) { return String(s || '').toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 40); }

  function wsURL() {
    let s = (prefs.server || CFG.server || '').trim();
    if (!s) {
      if (isApp) return '';
      return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    }
    if (/^https?:\/\//i.test(s)) s = s.replace(/^http/i, 'ws');
    if (!/^wss?:\/\//i.test(s)) {
      const local = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\])/.test(s);
      s = `${local ? 'ws' : 'wss'}://${s}`;
    }
    return `${s.replace(/\/+$/, '')}/ws`;
  }

  const PALETTE = ['#ffb84d', '#34d1b0', '#ff7aa8', '#9b8cff', '#5cc8ff'];
  function colorFor(name) { let h = 0; for (const c of name) h = (h * 31 + c.codePointAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; }
  function initial(name) { return (Array.from(name.trim())[0] || '?').toUpperCase(); }

  /* ---------------------------------------------------------- sinalização (ws) */
  function wsSend(obj) { if (S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify(obj)); }
  const sig = (to, data) => wsSend({ t: 'signal', to, data });

  function setNet(state) {
    el.net.dataset.state = state === 'ok' ? 'ok' : 'wait';
    el.net.textContent = state === 'ok' ? 'Conectado' : 'Reconectando…';
  }

  function connectWS() {
    const url = wsURL();
    let ws;
    try { ws = new WebSocket(url); } catch { return leave('Endereço do servidor inválido.'); }
    S.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ t: 'join', room: S.room, name: S.name, id: S.id || undefined }));
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } onServer(m); };
    ws.onerror = () => { /* o onclose cuida */ };
    ws.onclose = () => {
      if (S.leaving || S.ws !== ws) return;
      if (!S.welcomed && !S.id) return leave('Não consegui falar com o servidor. Confira o endereço em “Servidor”.');
      setNet('wait');
      const wait = Math.min(1000 * 2 ** S.retry++, 10000);
      clearTimeout(S.retryTimer);
      S.retryTimer = setTimeout(() => { if (!S.leaving) connectWS(); }, wait);
    };
  }

  function onServer(m) {
    switch (m.t) {
      case 'welcome': {
        if (S.id && m.id !== S.id) { for (const id of [...S.peers.keys()]) removePeer(id); } // perdemos o lugar: recomeça
        S.id = m.id; S.ice = m.ice && m.ice.length ? m.ice : S.ice; S.max = m.max || S.max;
        S.maxScreens = (m.limits && Number(m.limits.screens)) || 0;
        // O servidor foi atualizado enquanto esta janela estava aberta: avisa sem derrubar a chamada.
        if (S.build && m.build && m.build !== S.build && !S.staleWarned) {
          S.staleWarned = true;
          toast('Saiu uma versão nova da Resenha. Quando terminar a chamada, feche e abra o app (ou aperte F5 no navegador) para atualizar.', 12000);
        }
        S.hasTurn = S.ice.some((s) => [].concat(s.urls || []).some((u) => /^turns?:/i.test(u)));
        S.welcomed = true; S.retry = 0; setNet('ok');
        const present = new Set(m.peers.map((p) => p.id));
        for (const id of [...S.peers.keys()]) if (!present.has(id)) removePeer(id);
        for (const p of m.peers) {
          const known = S.peers.has(p.id);
          const peer = addPeer(p);
          if (!known || !peer.pc) peer.q = peer.q.then(() => offerTo(peer)).catch(warn);
        }
        sendState(); syncTiles();
        break;
      }
      case 'peer-join': addPeer(m); syncTiles(); tuneAll(); break;
      case 'peer-leave': removePeer(m.id); break;
      case 'signal': {
        const peer = S.peers.get(m.from) || addPeer({ id: m.from, name: 'Amigo' });
        peer.q = peer.q.then(() => handleSignal(peer, m.data)).catch(warn);
        break;
      }
      case 'limit': {
        // O servidor recusou a transmissão: já há gente demais com a tela no ar.
        if (m.what === 'screen') { stopShare(); toast(limitMsg(m.max)); }
        break;
      }
      case 'state': {
        const p = S.peers.get(m.id); if (!p) break;
        if (m.state.screen && !p.state.screen) { p.screenSince = Date.now(); S.focus = null; }
        p.state = m.state; syncTiles();
        break;
      }
      case 'chat': onChat(m); break;
      case 'error': {
        const text = { 'sala-cheia': `A sala está cheia (máximo de ${S.max} pessoas).`, 'codigo-invalido': 'Esse código de sala não é válido.', 'servidor-cheio': 'O servidor está lotado agora. Tente de novo em instantes.' }[m.code] || 'Não foi possível entrar na sala.';
        leave(text);
        break;
      }
    }
  }
  const warn = (e) => console.warn('[resenha]', e);

  function sendState() {
    wsSend({ t: 'state', state: { mic: !!L.mic && L.micOn, cam: !!L.cam, screen: !!L.scrV } });
  }

  /* ------------------------------------------------------------- pessoas / WebRTC */
  function addPeer(p) {
    let peer = S.peers.get(p.id);
    if (peer) { if (p.name) peer.name = p.name; if (p.state) peer.state = p.state; return peer; }
    peer = {
      id: p.id, name: p.name || 'Amigo', state: Object.assign({ mic: true, cam: false, screen: false }, p.state),
      pc: null, camStream: new MediaStream(), scrStream: new MediaStream(),
      offerer: false, q: Promise.resolve(), pending: [], rxVideo: true, tries: 0, rt: 0, screenSince: 0, watch: 0, stuck: false,
    };
    if (peer.state.screen) peer.screenSince = Date.now();
    S.peers.set(p.id, peer);
    return peer;
  }

  function removePeer(id) {
    const p = S.peers.get(id); if (!p) return;
    S.peers.delete(id);
    clearTimeout(p.rt); clearTimeout(p.watch);
    if (p.pc) { p.pc.onicecandidate = p.pc.ontrack = p.pc.onconnectionstatechange = null; try { p.pc.close(); } catch { /* já fechada */ } }
    for (const s of [p.camStream, p.scrStream]) s.getTracks().forEach((t) => s.removeTrack(t));
    if (S.focus && S.focus.startsWith(id)) S.focus = null;
    syncTiles(); tuneAll();
  }

  function makePC(peer) {
    const pc = new RTCPeerConnection({ iceServers: S.ice, bundlePolicy: 'max-bundle' });
    peer.pc = pc;
    // Se em 15 s a ligação com este amigo não fechou, avisa em vez de ficar "conectando…" para sempre.
    clearTimeout(peer.watch); peer.stuck = false;
    peer.watch = setTimeout(() => {
      if (peer.pc !== pc || pc.connectionState === 'connected') return;
      peer.stuck = true; syncTiles();
      toast(S.hasTurn
        ? `Ainda não consegui ligar com ${peer.name}. A internet de vocês está bem fechada; vou continuar tentando.`
        : `Não consegui ligar com ${peer.name}: a internet de um de vocês bloqueia a ligação direta. Falta ligar o servidor TURN (veja o guia).`, 10000);
    }, 15000);
    pc.onicecandidate = (e) => { if (e.candidate) sig(peer.id, { candidate: e.candidate.toJSON() }); };
    pc.ontrack = (e) => onTrack(peer, e);
    pc.onconnectionstatechange = () => onConn(peer);
    return pc;
  }

  async function attachLocal(peer) {
    const ts = peer.pc.getTransceivers();
    const tracks = [L.mic, L.cam, L.scrV, L.scrA];
    await Promise.all(ts.slice(0, 4).map((t, i) => t.sender.replaceTrack(tracks[i] || null).catch(warn)));
  }

  async function offerTo(peer) {
    if (peer.pc) return;
    peer.offerer = true;
    const pc = makePC(peer);
    for (const kind of ['audio', 'video', 'video', 'audio']) pc.addTransceiver(kind, { direction: 'sendrecv' });
    await attachLocal(peer);
    await pc.setLocalDescription(await pc.createOffer());
    sig(peer.id, { sdp: pc.localDescription.toJSON() });
  }

  async function handleSignal(peer, d) {
    if (!d) return;
    if (d.ctl === 'rx') { peer.rxVideo = !!d.on; tune(peer); return; }
    if (d.sdp) {
      if (d.sdp.type === 'offer') {
        const first = !peer.pc;
        const pc = peer.pc || makePC(peer);
        await pc.setRemoteDescription(d.sdp);
        if (first) {
          pc.getTransceivers().forEach((t) => { t.direction = 'sendrecv'; });
          await attachLocal(peer);
        }
        await pc.setLocalDescription(await pc.createAnswer());
        sig(peer.id, { sdp: pc.localDescription.toJSON() });
        await flushPending(peer);
      } else if (d.sdp.type === 'answer' && peer.pc) {
        await peer.pc.setRemoteDescription(d.sdp);
        await flushPending(peer);
      }
    } else if (d.candidate) {
      if (peer.pc && peer.pc.remoteDescription) { try { await peer.pc.addIceCandidate(d.candidate); } catch { /* candidato antigo */ } }
      else peer.pending.push(d.candidate);
    }
  }

  async function flushPending(peer) {
    const list = peer.pending.splice(0);
    for (const c of list) { try { await peer.pc.addIceCandidate(c); } catch { /* ignora */ } }
  }

  function onTrack(peer, e) {
    const idx = peer.pc.getTransceivers().indexOf(e.transceiver);
    const role = idx >= 0 ? idx : (e.track.kind === 'audio' ? ROLE_MIC : ROLE_CAM);
    const stream = role < ROLE_SCR ? peer.camStream : peer.scrStream;
    stream.addTrack(e.track);
    syncTiles();
  }

  function onConn(peer) {
    const st = peer.pc && peer.pc.connectionState;
    if (st === 'connected') {
      clearTimeout(peer.rt); clearTimeout(peer.watch); peer.tries = 0; peer.stuck = false;
      tune(peer);
      if (document.hidden && prefs.eco) sig(peer.id, { ctl: 'rx', on: false });
    } else if ((st === 'disconnected' || st === 'failed') && peer.offerer) {
      clearTimeout(peer.rt);
      if (peer.tries < 4) peer.rt = setTimeout(() => restartIce(peer), st === 'failed' ? 300 : 4000);
    }
    syncTiles();
  }

  async function restartIce(peer) {
    const pc = peer.pc;
    if (!pc || pc.connectionState === 'connected' || pc.signalingState !== 'stable') return;
    peer.tries++;
    peer.q = peer.q.then(async () => {
      await pc.setLocalDescription(await pc.createOffer({ iceRestart: true }));
      sig(peer.id, { sdp: pc.localDescription.toJSON() });
    }).catch(warn);
  }

  /* Ajusta taxa de envio conforme o número de pessoas (cada uma recebe um fluxo seu) e o modo economia. */
  function tune(peer) {
    const pc = peer.pc; if (!pc) return;
    const ts = pc.getTransceivers();
    const n = Math.max(1, S.peers.size);
    const camQ = CAM_Q[prefs.camQ] || CAM_Q.leve, scrQ = scrSpec();
    const camMax = Math.max(250, Math.min(camQ.kbps, Math.floor(5000 / n))) * 1000;
    const scrMax = Math.max(400, Math.min(scrQ.kbps, Math.floor(scrQ.pool / n))) * 1000;
    const set = (i, fn) => {
      const s = ts[i] && ts[i].sender; if (!s) return;
      try {
        const p = s.getParameters();
        if (!p.encodings || !p.encodings.length) return;
        fn(p.encodings[0]);
        s.setParameters(p).catch(() => {});
      } catch { /* ainda negociando */ }
    };
    set(ROLE_MIC, (e) => { e.maxBitrate = 40000; });
    set(ROLE_CAM, (e) => { e.maxBitrate = camMax; e.maxFramerate = camQ.fps; e.active = peer.rxVideo; });
    set(ROLE_SCR, (e) => { e.maxBitrate = scrMax; e.maxFramerate = scrQ.fps; e.active = peer.rxVideo; });
  }
  const tuneAll = () => S.peers.forEach(tune);

  const pushTrack = (role, track) => Promise.all([...S.peers.values()].map((p) => {
    const t = p.pc && p.pc.getTransceivers()[role];
    return t ? t.sender.replaceTrack(track || null).catch(warn) : null;
  }));

  /* ---------------------------------------------------------------- mídia local */
  async function getMic() {
    const base = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: prefs.mic ? { ...base, deviceId: { exact: prefs.mic } } : base });
    } catch (e) {
      if (e && e.name === 'OverconstrainedError' && prefs.mic) { prefs.mic = ''; savePrefs(); return getMic(); }
      throw e;
    }
  }

  async function initMic() {
    try { L.mic = (await getMic()).getAudioTracks()[0]; L.micOn = true; }
    catch (e) { L.mic = null; L.micOn = false; toast(mediaMsg(e, 'o microfone')); }
  }

  async function toggleMic() {
    if (!L.mic) { await initMic(); if (L.mic) await pushTrack(ROLE_MIC, L.mic); }
    else { L.micOn = !L.micOn; L.mic.enabled = L.micOn; }
    sendState(); renderControls(); syncTiles();
  }

  async function setCam(on) {
    if (on) {
      const q = CAM_Q[prefs.camQ] || CAM_Q.leve;
      const video = { width: { ideal: q.w }, height: { ideal: q.h }, frameRate: { ideal: q.fps, max: q.fps } };
      if (prefs.cam) video.deviceId = { exact: prefs.cam };
      try {
        L.cam = (await navigator.mediaDevices.getUserMedia({ video })).getVideoTracks()[0];
        if ('contentHint' in L.cam) L.cam.contentHint = 'motion'; // prefere manter os quadros por segundo a nitidez
      }
      catch (e) {
        if (e && e.name === 'OverconstrainedError' && prefs.cam) { prefs.cam = ''; savePrefs(); return setCam(true); }
        toast(mediaMsg(e, 'a câmera')); return;
      }
    } else if (L.cam) { L.cam.stop(); L.cam = null; }
    await pushTrack(ROLE_CAM, L.cam);
    tuneAll(); sendState(); syncTiles(); renderControls();
  }

  const limitMsg = (n) => `Já há ${n} ${n === 1 ? 'pessoa transmitindo' : 'pessoas transmitindo'} a tela. Quando uma parar, você pode transmitir.`;
  const sharingNow = () => [...S.peers.values()].filter((p) => p.state.screen).length;

  async function startShare() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) return toast('Este sistema não deixa compartilhar a tela.');
    if (S.maxScreens && sharingNow() >= S.maxScreens) return toast(limitMsg(S.maxScreens)); // o servidor também confere
    const q = scrSpec();
    let s;
    try {
      s = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { ideal: q.w }, height: { ideal: q.h }, frameRate: { ideal: q.fps, max: q.fps } },
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch (e) { if (e && e.name !== 'NotAllowedError' && e.name !== 'AbortError') toast('Não consegui compartilhar a tela.'); return; }
    L.scrV = s.getVideoTracks()[0]; L.scrA = s.getAudioTracks()[0] || null;
    if ('contentHint' in L.scrV) L.scrV.contentHint = q.hint;
    L.scrV.addEventListener('ended', stopShare);
    await pushTrack(ROLE_SCR, L.scrV); await pushTrack(ROLE_SCRA, L.scrA);
    tuneAll(); sendState(); syncTiles(); renderControls();
    if (!L.scrA) toast('Sua tela está no ar, mas sem o som do computador.');
  }

  function stopShare() {
    if (!L.scrV) return;
    for (const t of [L.scrV, L.scrA]) if (t) t.stop();
    L.scrV = L.scrA = null;
    pushTrack(ROLE_SCR, null); pushTrack(ROLE_SCRA, null);
    sendState(); syncTiles(); renderControls();
  }

  /* ----------------------------------------------------------------- medidor de voz */
  let actx = null;
  const meters = new Map();
  function audioCtx() {
    if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'playback' }); } catch { return null; } }
    if (actx.state === 'suspended') actx.resume().catch(() => {});
    return actx;
  }
  function ensureMeter(key, track) {
    const m = meters.get(key);
    if (m && m.trackId === (track && track.id)) return;
    if (m) { try { m.src.disconnect(); } catch { /* ok */ } meters.delete(key); }
    const ctx = track && audioCtx(); if (!ctx) return;
    try {
      const src = ctx.createMediaStreamSource(new MediaStream([track]));
      const an = ctx.createAnalyser(); an.fftSize = 256; an.smoothingTimeConstant = 0.3;
      src.connect(an);
      meters.set(key, { src, an, buf: new Uint8Array(an.fftSize), trackId: track.id, until: 0, on: false });
    } catch { /* sem medidor */ }
  }
  setInterval(() => {
    if (document.hidden || !meters.size) return;
    const now = performance.now();
    for (const [key, m] of meters) {
      m.an.getByteTimeDomainData(m.buf);
      let sum = 0;
      for (let i = 0; i < m.buf.length; i++) { const v = m.buf[i] - 128; sum += v * v; }
      if (Math.sqrt(sum / m.buf.length) > 4) m.until = now + 350;
      const on = now < m.until;
      if (on !== m.on) { m.on = on; const t = tiles.get(key); if (t) t.el.classList.toggle('speaking', on); }
    }
  }, 140);

  /* -------------------------------------------------------------------- telas (tiles) */
  const tiles = new Map();

  function makeTile(key, kind) {
    const root = document.createElement('div');
    root.className = `tile ${kind} novideo`;
    const video = document.createElement('video');
    video.autoplay = true; video.playsInline = true;
    const avatar = document.createElement('div'); avatar.className = 'avatar';
    const tag = document.createElement('div'); tag.className = 'tag';
    const mic = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    mic.setAttribute('class', 'ic');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use'); use.setAttribute('href', '#i-mic-off');
    mic.appendChild(use);
    const label = document.createElement('span');
    tag.append(mic, label);
    const stats = document.createElement('div'); stats.className = 'stats'; stats.hidden = !prefs.stats;
    root.append(video, avatar, tag, stats);
    root.addEventListener('click', () => { S.focus = (focusKey() === key) ? '-' : key; layout(); });
    root.addEventListener('dblclick', () => { if (document.fullscreenElement) document.exitFullscreen(); else root.requestFullscreen && root.requestFullscreen().catch(() => {}); });
    el.stage.appendChild(root);
    const t = { key, kind, el: root, video, avatar, label, mic, stats, src: null };
    tiles.set(key, t);
    if (prefs.spk && video.setSinkId) video.setSinkId(prefs.spk).catch(() => {});
    return t;
  }

  function dropTile(key) {
    const t = tiles.get(key); if (!t) return;
    t.video.srcObject = null; t.el.remove(); tiles.delete(key);
    const m = meters.get(key); if (m) { try { m.src.disconnect(); } catch { /* ok */ } meters.delete(key); }
    statText.delete(key); last.delete(key);
  }

  function setSrc(t, stream, sig) {
    if (t.sig === sig) return;
    t.sig = sig; t.video.srcObject = stream;
    if (stream) t.video.play().catch(() => {});
  }

  function syncTiles() {
    const want = [{ key: 'me', kind: 'cam' }];
    for (const p of S.peers.values()) want.push({ key: p.id, kind: 'cam', peer: p });
    if (L.scrV && prefs.preview) want.push({ key: 'me:s', kind: 'screen' });
    for (const p of S.peers.values()) {
      if (p.state.screen && p.scrStream.getVideoTracks().length) want.push({ key: `${p.id}:s`, kind: 'screen', peer: p });
    }
    const keys = new Set(want.map((w) => w.key));
    for (const k of [...tiles.keys()]) if (!keys.has(k)) dropTile(k);

    for (const w of want) {
      const t = tiles.get(w.key) || makeTile(w.key, w.kind);
      const p = w.peer;
      if (w.key === 'me') {
        const name = S.name || 'Você';
        t.label.textContent = `${name} (você)`;
        t.avatar.textContent = initial(name); t.avatar.style.background = colorFor(name);
        t.video.muted = true;
        setSrc(t, L.cam ? new MediaStream([L.cam]) : null, L.cam ? L.cam.id : '');
        t.el.classList.toggle('novideo', !L.cam);
        t.mic.style.display = (!L.mic || !L.micOn) ? '' : 'none';
        ensureMeter('me', L.mic && L.micOn ? L.mic : null);
      } else if (w.key === 'me:s') {
        t.label.textContent = 'Sua tela'; t.video.muted = true;
        setSrc(t, new MediaStream([L.scrV]), L.scrV.id);
        t.el.classList.remove('novideo'); t.mic.style.display = 'none';
      } else if (w.kind === 'cam') {
        const connecting = !p.pc || p.pc.connectionState !== 'connected';
        t.label.textContent = !connecting ? p.name : `${p.name} · ${p.stuck ? 'sem conexão' : 'conectando…'}`;
        t.avatar.textContent = initial(p.name); t.avatar.style.background = colorFor(p.name);
        t.video.muted = false;
        setSrc(t, p.camStream, p.id);
        const hasVideo = p.state.cam && p.camStream.getVideoTracks().length > 0;
        t.el.classList.toggle('novideo', !hasVideo);
        t.mic.style.display = p.state.mic === false ? '' : 'none';
        ensureMeter(p.id, p.camStream.getAudioTracks()[0]);
      } else {
        t.label.textContent = `Tela de ${p.name}`;
        t.video.muted = false;
        setSrc(t, p.scrStream, `${p.id}:s`);
        t.el.classList.remove('novideo'); t.mic.style.display = 'none';
      }
    }

    const n = S.peers.size + 1;
    el.count.textContent = `${n} ${n === 1 ? 'pessoa' : 'pessoas'}`;
    el.empty.hidden = S.peers.size > 0;
    layout();
  }

  function focusKey() {
    if (S.focus === '-') return null;
    if (S.focus && tiles.has(S.focus)) return S.focus;
    S.focus = null;
    let best = null;
    for (const p of S.peers.values()) {
      if (tiles.has(`${p.id}:s`) && (!best || p.screenSince > best.screenSince)) best = p;
    }
    return best ? `${best.id}:s` : null;
  }

  function place(t, x, y, w, h) {
    t.el.style.width = `${Math.floor(w)}px`; t.el.style.height = `${Math.floor(h)}px`;
    t.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  function layout() {
    const W = el.stage.clientWidth, H = el.stage.clientHeight;
    const all = [...tiles.values()];
    if (!W || !H || !all.length) return;
    const gap = 10, fk = focusKey();
    all.forEach((t) => t.el.classList.remove('focused'));

    if (fk && all.length > 1) {
      const main = tiles.get(fk), rest = all.filter((t) => t !== main), k = rest.length;
      main.el.classList.add('focused');
      if (W >= 760) {
        let sw = 220, sh = sw * 9 / 16;
        if (k * sh + (k - 1) * gap > H) { sh = (H - (k - 1) * gap) / k; sw = sh * 16 / 9; }
        const mw = W - sw - gap;
        place(main, 0, 0, mw, H);
        rest.forEach((t, i) => place(t, mw + gap, i * (sh + gap), sw, sh));
      } else {
        let sh = 96, sw = sh * 16 / 9;
        if (k * sw + (k - 1) * gap > W) { sw = (W - (k - 1) * gap) / k; sh = sw * 9 / 16; }
        const mh = H - sh - gap;
        place(main, 0, 0, W, mh);
        rest.forEach((t, i) => place(t, i * (sw + gap), mh + gap, sw, sh));
      }
      return;
    }

    // grade: escolhe o número de colunas que dá o maior bloco 16:9
    const n = all.length;
    let best = null;
    for (let cols = 1; cols <= n; cols++) {
      const rows = Math.ceil(n / cols);
      let w = (W - gap * (cols - 1)) / cols, h = w * 9 / 16;
      if (h * rows + gap * (rows - 1) > H) { h = (H - gap * (rows - 1)) / rows; w = h * 16 / 9; }
      if (!best || w > best.w) best = { cols, rows, w, h };
    }
    const { cols, rows, w, h } = best;
    const oy = (H - (rows * h + (rows - 1) * gap)) / 2;
    all.forEach((t, i) => {
      const r = Math.floor(i / cols), c = i % cols;
      const inRow = r === rows - 1 ? n - r * cols : cols;
      const ox = (W - (inRow * w + (inRow - 1) * gap)) / 2;
      place(t, ox + c * (w + gap), oy + r * (h + gap), w, h);
    });
  }
  new ResizeObserver(layout).observe(el.stage);

  /* ------------------------------------------------- diagnóstico da conexão */
  const last = new Map();      // amostra anterior de cada vídeo, para calcular taxas por segundo
  const statText = new Map();  // chave do tile -> texto mostrado
  let statsTimer = 0;
  const LIMITS = { none: 'nenhum', cpu: 'processador', bandwidth: 'internet', other: 'outro' };

  // Como a ligação com um amigo está de fato chegando: direta ou passando por um servidor relay (TURN).
  async function connType(pc) {
    try {
      const rep = await pc.getStats();
      const byId = new Map();
      rep.forEach((s) => byId.set(s.id, s));
      let pair = null;
      rep.forEach((s) => { if (s.type === 'transport' && s.selectedCandidatePairId) pair = byId.get(s.selectedCandidatePairId); });
      if (!pair) rep.forEach((s) => { if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') pair = s; });
      if (!pair) return null;
      const lt = (byId.get(pair.localCandidateId) || {}).candidateType;
      const rt = (byId.get(pair.remoteCandidateId) || {}).candidateType;
      return {
        via: lt === 'relay' || rt === 'relay' ? 'por relay (TURN)' : 'direta',
        rtt: typeof pair.currentRoundTripTime === 'number' ? Math.round(pair.currentRoundTripTime * 1000) : null,
      };
    } catch { return null; }
  }

  async function readVideo(pc, role, dir, key, now) {
    const t = pc.getTransceivers()[role];
    const track = t && (dir === 'rx' ? t.receiver.track : t.sender.track);
    if (!track) return null;
    let r = null, src = null;
    (await pc.getStats(track)).forEach((s) => {
      if (s.kind === 'video' && s.type === (dir === 'rx' ? 'inbound-rtp' : 'outbound-rtp')) r = s;
      if (s.type === 'media-source' && s.kind === 'video') src = s;
    });
    if (!r) return null;
    const prev = last.get(key);
    last.set(key, { t: now, r });
    const o = { w: r.frameWidth || 0, h: r.frameHeight || 0, fps: Math.round(r.framesPerSecond || 0) };
    if (src && src.framesPerSecond) o.cap = Math.round(src.framesPerSecond);
    if (dir === 'tx') o.limit = r.qualityLimitationReason || 'none';
    if (prev) {
      const dt = (now - prev.t) / 1000 || 1;
      const b = dir === 'rx' ? 'bytesReceived' : 'bytesSent';
      o.kbps = Math.max(0, Math.round(((r[b] - prev.r[b]) * 8) / 1000 / dt));
      if (dir === 'rx') {
        const lost = Math.max(0, r.packetsLost - prev.r.packetsLost), got = r.packetsReceived - prev.r.packetsReceived;
        o.loss = lost + got > 0 ? Math.round((100 * lost) / (lost + got)) : 0;
        const n = r.jitterBufferEmittedCount - prev.r.jitterBufferEmittedCount;
        if (n > 0) o.delay = Math.round((1000 * (r.jitterBufferDelay - prev.r.jitterBufferDelay)) / n);
      }
    }
    return o;
  }

  function fmt(o, dir, role) {
    const parts = [`${o.w}×${o.h}`, `${o.fps} fps`];
    if (o.kbps !== undefined) parts.push(`${o.kbps} kbps`);
    if (dir === 'rx') {
      if (o.loss !== undefined) parts.push(`perda ${o.loss}%`);
      if (o.delay !== undefined) parts.push(`atraso ${o.delay} ms`);
    } else {
      if (o.cap) parts.push(`${role === ROLE_SCR ? 'captura' : 'webcam'} entrega ${o.cap} fps`);
      parts.push(`limite: ${LIMITS[o.limit] || o.limit}`);
    }
    return `${dir === 'rx' ? 'recebendo' : 'enviando'} ${parts.join(' · ')}`;
  }

  async function pollStats() {
    if (document.hidden || el.room.hidden) return;
    const now = performance.now();
    const live = [];
    for (const p of S.peers.values()) {
      if (p.pc && p.pc.connectionState === 'connected') live.push(p);
      else statText.set(p.id, p.stuck ? 'sem conexão direta' : 'conectando…');
    }
    await Promise.all(live.map(async (p) => {
      try {
        const c = await connType(p.pc);
        const via = c ? `ligação ${c.via}${c.rtt !== null ? ` · ping ${c.rtt} ms` : ''}` : '';
        const join = (a) => [a, via].filter(Boolean).join(' · ');
        const cam = p.state.cam ? await readVideo(p.pc, ROLE_CAM, 'rx', p.id, now) : null;
        statText.set(p.id, join(p.state.cam ? (cam ? fmt(cam, 'rx', ROLE_CAM) : 'sem imagem') : 'câmera desligada'));
        if (p.state.screen) {
          const scr = await readVideo(p.pc, ROLE_SCR, 'rx', `${p.id}:s`, now);
          statText.set(`${p.id}:s`, join(scr ? fmt(scr, 'rx', ROLE_SCR) : 'sem imagem'));
        }
      } catch { /* a ligação estava mudando */ }
    }));
    if (L.cam && live[0]) {
      try { const tx = await readVideo(live[0].pc, ROLE_CAM, 'tx', 'me', now); statText.set('me', tx ? fmt(tx, 'tx', ROLE_CAM) : ''); } catch { /* ok */ }
    } else statText.set('me', L.cam ? 'sem ninguém para receber' : '');
    if (L.scrV && live[0]) {
      try { const tx = await readVideo(live[0].pc, ROLE_SCR, 'tx', 'me:s', now); statText.set('me:s', tx ? fmt(tx, 'tx', ROLE_SCR) : ''); } catch { /* ok */ }
    } else statText.delete('me:s');
    if (prefs.stats) tiles.forEach((t) => { t.stats.textContent = statText.get(t.key) || ''; });
  }

  function setStatsOn(on) {
    prefs.stats = on; savePrefs();
    clearInterval(statsTimer); statsTimer = 0;
    if (on) { statsTimer = setInterval(pollStats, 1000); pollStats(); }
    else { last.clear(); statText.clear(); }
    tiles.forEach((t) => { t.stats.hidden = !on; if (!on) t.stats.textContent = ''; });
  }

  // Texto para colar na conversa quando algo está ruim: mostra de onde vem o problema.
  async function buildDiag() {
    const wasOn = !!statsTimer;
    await pollStats(); await new Promise((r) => setTimeout(r, 1200)); await pollStats();
    const names = new Map([['me', `${S.name} (você)`], ['me:s', 'sua tela (enviando)']]);
    S.peers.forEach((p) => { names.set(p.id, p.name); names.set(`${p.id}:s`, `tela de ${p.name}`); });
    const cs = L.cam ? L.cam.getSettings() : null;
    const lines = [
      'Resenha · diagnóstico',
      verText(),
      `sistema: ${navigator.userAgent}`,
      `pessoas na sala: ${S.peers.size + 1} · servidor TURN: ${S.hasTurn ? 'sim' : 'NÃO'}`,
      `câmera: ${cs ? `${cs.width}×${cs.height}, pedido ${cs.frameRate || '?'} fps, qualidade ${prefs.camQ}` : 'desligada'} · tela: ${prefs.scrQ}, ${scrSpec().fps} fps pedidos${L.scrV ? `, captura ${Math.round((L.scrV.getSettings().frameRate || 0))} fps` : ''} · economia: ${prefs.eco ? 'sim' : 'não'}`,
      ...[...S.peers.values()].map((p) => `ligação com ${p.name}: ${p.pc ? `${p.pc.connectionState} (ICE ${p.pc.iceConnectionState})` : 'sem ligação'}`),
      ...[...statText].map(([k, v]) => `${names.get(k) || k}: ${v}`),
    ];
    if (!wasOn) { last.clear(); statText.clear(); }
    return lines.join('\n');
  }

  /* ------------------------------------------------------------------------ chat */
  function onChat(m) {
    const li = document.createElement('li');
    if (m.id === S.id) li.className = 'me';
    const b = document.createElement('b'); b.textContent = m.id === S.id ? 'Você' : m.name;
    const t = document.createElement('span'); t.textContent = m.text;
    li.append(b, t);
    el.msgs.appendChild(li);
    while (el.msgs.children.length > 200) el.msgs.firstChild.remove();
    el.msgs.scrollTop = el.msgs.scrollHeight;
    if (!S.chatOpen && m.id !== S.id) { S.unread++; renderControls(); }
  }

  function toggleChat(open) {
    S.chatOpen = open === undefined ? !S.chatOpen : open;
    el.chat.hidden = !S.chatOpen;
    if (S.chatOpen) { S.unread = 0; el.chatInput.focus(); el.msgs.scrollTop = el.msgs.scrollHeight; }
    renderControls(); layout();
  }

  /* ------------------------------------------------------------------ controles */
  function setBtn(b, icon, label, cls) {
    b.title = label; b.setAttribute('aria-label', label);
    b.querySelector('use').setAttribute('href', `#i-${icon}`);
    b.classList.remove('warn', 'on', 'share');
    if (cls) b.classList.add(cls);
  }

  function renderControls() {
    const micOn = !!L.mic && L.micOn;
    el.bMic.setAttribute('aria-pressed', String(micOn));
    setBtn(el.bMic, micOn ? 'mic' : 'mic-off', micOn ? 'Silenciar microfone' : 'Ativar microfone', micOn ? '' : 'warn');
    el.bCam.setAttribute('aria-pressed', String(!!L.cam));
    setBtn(el.bCam, L.cam ? 'cam' : 'cam-off', L.cam ? 'Desligar câmera' : 'Ligar câmera', L.cam ? 'on' : '');
    el.bScr.setAttribute('aria-pressed', String(!!L.scrV));
    setBtn(el.bScr, 'screen', L.scrV ? 'Parar de compartilhar a tela' : 'Compartilhar tela', L.scrV ? 'share' : '');
    el.bChat.setAttribute('aria-pressed', String(S.chatOpen));
    el.bChat.title = S.chatOpen ? 'Fechar chat' : 'Abrir chat';
    if (S.unread) el.bChat.dataset.badge = S.unread > 9 ? '9+' : String(S.unread); else delete el.bChat.dataset.badge;
    el.live.hidden = !L.scrV;
  }

  async function fillDevices() {
    let list = [];
    try { list = await navigator.mediaDevices.enumerateDevices(); } catch { /* sem lista */ }
    const fill = (sel, kind, cur, none, noun) => {
      sel.textContent = '';
      sel.add(new Option(none, ''));
      let i = 0;
      for (const d of list) if (d.kind === kind && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications') sel.add(new Option(d.label || `${noun} ${++i}`, d.deviceId));
      sel.value = [...sel.options].some((o) => o.value === cur) ? cur : '';
    };
    fill(el.selMic, 'audioinput', prefs.mic, 'Padrão do sistema', 'Microfone');
    fill(el.selCam, 'videoinput', prefs.cam, 'Padrão do sistema', 'Câmera');
    fill(el.selSpk, 'audiooutput', prefs.spk, 'Padrão do sistema', 'Saída');
    el.spkRow.hidden = !(HTMLMediaElement.prototype.setSinkId);
    el.selCamQ.value = prefs.camQ; el.selScrQ.value = prefs.scrQ;
    el.chkEco.checked = !!prefs.eco; el.chkPreview.checked = !!prefs.preview; el.chkStats.checked = !!prefs.stats;
  }

  /* ---------------------------------------------------------------- entrar / sair */
  async function startJoin(code) {
    prefs.name = el.name.value.trim().slice(0, 24) || 'Amigo';
    prefs.server = el.server.value.trim();
    savePrefs();
    if (!wsURL()) {
      el.adv.open = true; el.server.focus();
      el.lobbyErr.textContent = 'Digite o endereço do servidor no campo “Servidor”.';
      return;
    }
    el.lobbyErr.textContent = '';
    el.joinBtn.disabled = el.createBtn.disabled = true;
    S.leaving = false; S.name = prefs.name; S.room = code; S.id = null; S.welcomed = false; S.retry = 0;
    audioCtx();                 // libera o áudio dentro do clique
    await initMic();
    el.lobby.hidden = true; el.room.hidden = false;
    el.roomCode.textContent = code; document.title = `Resenha · ${code}`;
    renderControls(); syncTiles(); connectWS();
  }

  function leave(msg) {
    S.leaving = true;
    clearTimeout(S.retryTimer);
    wsSend({ t: 'leave' });
    try { if (S.ws) S.ws.close(); } catch { /* ok */ }
    S.ws = null;
    for (const id of [...S.peers.keys()]) removePeer(id);
    for (const t of [L.mic, L.cam, L.scrV, L.scrA]) if (t) t.stop();
    L.mic = L.cam = L.scrV = L.scrA = null;
    for (const k of [...tiles.keys()]) dropTile(k);
    meters.clear(); last.clear(); statText.clear();
    if (actx) { actx.close().catch(() => {}); actx = null; }
    S.id = null; S.welcomed = false; S.focus = null; S.unread = 0; S.chatOpen = false;
    el.chat.hidden = true; el.msgs.textContent = '';
    el.room.hidden = true; el.lobby.hidden = false;
    el.joinBtn.disabled = el.createBtn.disabled = false;
    el.lobbyErr.textContent = typeof msg === 'string' ? msg : '';
    document.title = 'Resenha';
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  }

  /* --------------------------------------------------------------- eventos de UI */
  el.joinForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const code = cleanCode(el.code.value);
    if (code.length < 3) { el.lobbyErr.textContent = 'Digite o código da sala ou toque em “Criar sala nova”.'; el.code.focus(); return; }
    startJoin(code);
  });
  el.createBtn.addEventListener('click', () => { const c = newCode(); el.code.value = c; startJoin(c); });

  el.bMic.addEventListener('click', toggleMic);
  el.bCam.addEventListener('click', () => setCam(!L.cam));
  el.bScr.addEventListener('click', () => (L.scrV ? stopShare() : startShare()));
  el.bChat.addEventListener('click', () => toggleChat());
  el.bLeave.addEventListener('click', () => leave());
  el.bSet.addEventListener('click', async () => { await fillDevices(); el.settings.showModal(); });

  el.chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = el.chatInput.value.trim();
    if (text) wsSend({ t: 'chat', text });
    el.chatInput.value = '';
  });

  el.copyInvite.addEventListener('click', async () => {
    const text = isApp ? S.room : `${location.origin}/#${S.room}`;
    try { await navigator.clipboard.writeText(text); toast(isApp ? `Código “${S.room}” copiado. Mande para os amigos.` : 'Convite copiado. Mande o link para os amigos.'); }
    catch { toast(`Código da sala: ${S.room}`); }
  });

  el.selMic.addEventListener('change', async () => {
    prefs.mic = el.selMic.value; savePrefs();
    if (!L.mic) return;
    const was = L.micOn; L.mic.stop();
    await initMic();
    if (L.mic) { L.micOn = was; L.mic.enabled = was; await pushTrack(ROLE_MIC, L.mic); }
    sendState(); syncTiles(); renderControls();
  });
  el.selCam.addEventListener('change', async () => { prefs.cam = el.selCam.value; savePrefs(); if (L.cam) { await setCam(false); await setCam(true); } });
  el.selSpk.addEventListener('change', () => {
    prefs.spk = el.selSpk.value; savePrefs();
    tiles.forEach((t) => t.video.setSinkId && t.video.setSinkId(prefs.spk).catch(() => {}));
  });
  el.selCamQ.addEventListener('change', async () => { prefs.camQ = el.selCamQ.value; savePrefs(); if (L.cam) { await setCam(false); await setCam(true); } tuneAll(); });
  el.selScrQ.addEventListener('change', () => { prefs.scrQ = el.selScrQ.value; savePrefs(); tuneAll(); });
  el.chkEco.addEventListener('change', () => { prefs.eco = el.chkEco.checked; savePrefs(); if (!prefs.eco) S.peers.forEach((p) => sig(p.id, { ctl: 'rx', on: true })); });
  el.chkPreview.addEventListener('change', () => { prefs.preview = el.chkPreview.checked; savePrefs(); syncTiles(); });
  el.chkStats.addEventListener('change', () => setStatsOn(el.chkStats.checked));
  el.btnDiag.addEventListener('click', async () => {
    el.btnDiag.disabled = true; toast('Coletando dados… (2 segundos)', 3000);
    try {
      const text = await buildDiag();
      try { await navigator.clipboard.writeText(text); toast('Diagnóstico copiado. É só colar na conversa.'); }
      catch { toast('Não consegui copiar. Ligue “Mostrar estatísticas” e tire uma foto da tela.', 8000); }
    } finally { el.btnDiag.disabled = false; }
  });

  // Economia: janela minimizada/escondida => os amigos param de mandar vídeo para mim.
  // Espera 6 s antes de pedir isso: um alt-tab rápido, ou outra janela passando por cima, não deve cortar o vídeo.
  const HIDE_DELAY_MS = 6000;
  let hideTimer = 0;
  document.addEventListener('visibilitychange', () => {
    if (!prefs.eco || el.room.hidden) return;
    clearTimeout(hideTimer);
    if (document.hidden) {
      hideTimer = setTimeout(() => { if (document.hidden) S.peers.forEach((p) => sig(p.id, { ctl: 'rx', on: false })); }, HIDE_DELAY_MS);
    } else {
      S.peers.forEach((p) => sig(p.id, { ctl: 'rx', on: true }));
      layout();
    }
  });
  window.addEventListener('pagehide', () => { if (!S.leaving) wsSend({ t: 'leave' }); });

  /* ----------------------------------------------------------------- início */
  el.name.value = prefs.name;
  el.server.value = prefs.server;
  const fromHash = cleanCode(location.hash.slice(1));
  if (fromHash) el.code.value = fromHash;
  el.adv.open = isApp && !prefs.server && !CFG.server;
  renderControls();

  // gancho para testes automatizados
  setStatsOn(!!prefs.stats);
  const verText = () => (isApp ? 'Versão: interface local do app (sem atualização automática: o servidor não respondeu ou ainda não foi configurado)' : `Versão da interface: ${S.build || 'desconhecida'}`);
  if (!isApp) {
    fetch(`/version.json?t=${Date.now()}`).then((r) => r.json()).then((j) => { if (j && j.build) S.build = j.build; el.verInfo.textContent = verText(); }).catch(() => {});
  }
  el.verInfo.textContent = verText();
  window.__resenha = { S, L, tiles, prefs, buildDiag };
})();
