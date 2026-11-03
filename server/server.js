#!/usr/bin/env node
'use strict';
/*
 * Resenha — servidor de sinalização.
 *
 * Só apresenta os amigos uns aos outros (troca de "ofertas" WebRTC) e leva o chat.
 * Vídeo, áudio e tela NÃO passam por aqui: vão direto entre os computadores.
 * Por isso o servidor usa pouquíssima memória e roda até no plano grátis de qualquer hospedagem.
 *
 * Zero dependências: WebSocket implementado à mão (RFC 6455, só o necessário).
 */
const http = require('http');
const os = require('os');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 8787;
const MAX_ROOM = Math.min(Number(process.env.MAX_ROOM) || 8, 12);
const MAX_ROOMS = Number(process.env.MAX_ROOMS) || 500;
const MAX_CONNS = Number(process.env.MAX_CONNS) || 2000;
const GRACE_MS = Number(process.env.GRACE_MS) || 6000; // tempo para reconectar sem derrubar a chamada
const MAX_MSG = 64 * 1024;
const APP_DIR = path.join(__dirname, '..', 'app');
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function iceServers() {
  if (process.env.ICE_SERVERS) {
    try { return JSON.parse(process.env.ICE_SERVERS); }
    catch { console.error('ICE_SERVERS não é um JSON válido; usando o padrão.'); }
  }
  const list = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
  // Opcional: um servidor TURN ajuda quando a internet de alguém bloqueia conexão direta.
  if (process.env.TURN_URL) {
    list.push({
      urls: process.env.TURN_URL.split(',').map((s) => s.trim()),
      username: process.env.TURN_USER || '',
      credential: process.env.TURN_PASS || '',
    });
  }
  return list;
}
const ICE = iceServers();

/* ------------------------------------------------------------------ HTTP */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

const server = http.createServer((req, res) => {
  let url;
  try { url = new URL(req.url, 'http://x'); } catch { res.writeHead(400); return res.end(); }
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    return res.end('ok');
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }

  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { res.writeHead(400); return res.end(); }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(APP_DIR, rel));
  if (!file.startsWith(APP_DIR + path.sep)) { res.writeHead(403); return res.end(); }

  let stream;
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) throw new Error('not a file');
    const ext = path.extname(file).toLowerCase();
    const headers = {
      'content-type': MIME[ext] || 'application/octet-stream',
      'content-length': st.size,
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    };
    if (ext === '.html') headers['permissions-policy'] = 'camera=(self), microphone=(self), display-capture=(self)';
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    stream = fs.createReadStream(file);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Não encontrado');
  }
});

/* ------------------------------------------------------------- WebSocket */

function frame(opcode, payload) {
  const len = payload.length;
  let head;
  if (len < 126) {
    head = Buffer.from([0x80 | opcode, len]);
  } else if (len < 65536) {
    head = Buffer.alloc(4);
    head[0] = 0x80 | opcode; head[1] = 126; head.writeUInt16BE(len, 2);
  } else {
    head = Buffer.alloc(10);
    head[0] = 0x80 | opcode; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([head, payload]);
}

const rooms = new Map(); // código -> { code, members: Map(id -> membro) }
const conns = new Set();

function broadcast(room, except, msg) {
  for (const m of room.members.values()) {
    if (m !== except && m.conn && !m.gone) m.conn.send(msg);
  }
}

function dropMember(mem) {
  clearTimeout(mem.timer);
  const room = mem.room;
  if (room.members.get(mem.id) !== mem) return;
  room.members.delete(mem.id);
  broadcast(room, mem, { t: 'peer-leave', id: mem.id });
  if (room.members.size === 0) rooms.delete(room.code);
}

function cleanState(s) {
  s = s && typeof s === 'object' ? s : {};
  return { mic: s.mic !== false, cam: !!s.cam, screen: !!s.screen };
}

class Conn {
  constructor(socket) {
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.frags = [];
    this.fragLen = 0;
    this.alive = true;
    this.leaving = false;
    this.member = null;
    this.lastSeen = Date.now();
    this.winStart = Date.now();
    this.count = 0;
    conns.add(this);
    socket.setNoDelay(true);
    socket.on('data', (d) => this.onData(d));
    socket.on('close', () => this.onClose());
    socket.on('error', () => socket.destroy());
  }

  send(obj) {
    if (!this.alive || this.socket.destroyed) return;
    if (this.socket.writableLength > (1 << 20)) return this.socket.destroy();
    this.socket.write(frame(1, Buffer.from(JSON.stringify(obj))));
  }

  fail(code) {
    this.send({ t: 'error', code });
    this.leaving = true;
    this.socket.write(frame(8, Buffer.alloc(0)));
    this.socket.end();
  }

  onData(chunk) {
    this.lastSeen = Date.now();
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    if (this.buf.length > (1 << 20)) return this.socket.destroy();
    while (this.alive && this.buf.length >= 2) {
      const b0 = this.buf[0];
      const b1 = this.buf[1];
      const fin = !!(b0 & 0x80);
      const op = b0 & 0x0f;
      let len = b1 & 0x7f;
      let off = 2;
      if (!(b1 & 0x80)) return this.socket.destroy(); // cliente sempre mascara
      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2); off = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return;
        const big = this.buf.readBigUInt64BE(2);
        if (big > BigInt(MAX_MSG)) return this.socket.destroy();
        len = Number(big); off = 10;
      }
      if (len > MAX_MSG) return this.socket.destroy();
      if (this.buf.length < off + 4 + len) return;
      const mask = this.buf.subarray(off, off + 4);
      const payload = Buffer.from(this.buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < len; i++) payload[i] ^= mask[i & 3];
      this.buf = this.buf.subarray(off + 4 + len);
      this.onFrame(fin, op, payload);
    }
  }

  onFrame(fin, op, payload) {
    switch (op) {
      case 0x8: // fechar
        this.socket.write(frame(8, Buffer.alloc(0)));
        this.socket.end();
        return;
      case 0x9: // ping
        this.socket.write(frame(10, payload));
        return;
      case 0xa: // pong
        return;
      case 0x1: // texto
        this.frags = [payload]; this.fragLen = payload.length;
        break;
      case 0x0: // continuação
        this.frags.push(payload); this.fragLen += payload.length;
        break;
      default: // binário e outros: ignora
        return;
    }
    if (this.fragLen > MAX_MSG) return this.socket.destroy();
    if (fin) {
      const text = Buffer.concat(this.frags).toString('utf8');
      this.frags = []; this.fragLen = 0;
      this.onMessage(text);
    }
  }

  onMessage(raw) {
    const now = Date.now();
    if (now - this.winStart > 1000) { this.winStart = now; this.count = 0; }
    if (++this.count > 100) return; // limite de mensagens por segundo
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    if (m.t === 'join') return this.join(m);

    const mem = this.member;
    if (!mem) return;
    const room = mem.room;
    switch (m.t) {
      case 'signal': {
        const to = room.members.get(String(m.to));
        if (to && to !== mem && to.conn && !to.gone) to.conn.send({ t: 'signal', from: mem.id, data: m.data });
        break;
      }
      case 'state':
        mem.state = cleanState(m.state);
        broadcast(room, mem, { t: 'state', id: mem.id, state: mem.state });
        break;
      case 'chat': {
        const text = String(m.text || '').trim().slice(0, 500);
        if (text) broadcast(room, null, { t: 'chat', id: mem.id, name: mem.name, text, ts: Date.now() });
        break;
      }
      case 'leave':
        this.leaving = true;
        this.socket.write(frame(8, Buffer.alloc(0)));
        this.socket.end();
        break;
    }
  }

  join(m) {
    if (this.member) return;
    const code = String(m.room || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40);
    const name = String(m.name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 24) || 'Amigo';
    if (code.length < 3) return this.fail('codigo-invalido');

    let room = rooms.get(code);
    if (!room) {
      if (rooms.size >= MAX_ROOMS) return this.fail('servidor-cheio');
      room = { code, members: new Map() };
      rooms.set(code, room);
    }

    let mem = null;
    const wanted = typeof m.id === 'string' ? room.members.get(m.id) : null;
    if (wanted && wanted.gone) { // voltou rápido: mantém o mesmo lugar na sala
      clearTimeout(wanted.timer);
      wanted.gone = false;
      wanted.conn = this;
      mem = wanted;
    }
    if (!mem) {
      if (room.members.size >= MAX_ROOM) {
        if (room.members.size === 0) rooms.delete(code);
        return this.fail('sala-cheia');
      }
      const id = crypto.randomBytes(4).toString('hex');
      mem = { id, name, room, conn: this, state: cleanState(), gone: false, timer: null };
      room.members.set(id, mem);
      broadcast(room, mem, { t: 'peer-join', id, name, state: mem.state });
    }
    this.member = mem;
    const peers = [...room.members.values()]
      .filter((p) => p !== mem && !p.gone)
      .map((p) => ({ id: p.id, name: p.name, state: p.state }));
    this.send({ t: 'welcome', id: mem.id, peers, ice: ICE, max: MAX_ROOM });
  }

  onClose() {
    if (!this.alive) return;
    this.alive = false;
    conns.delete(this);
    const mem = this.member;
    if (!mem || mem.conn !== this) return;
    mem.conn = null;
    if (this.leaving) return dropMember(mem);
    mem.gone = true;
    mem.timer = setTimeout(() => dropMember(mem), GRACE_MS);
  }
}

server.on('upgrade', (req, socket) => {
  let url;
  try { url = new URL(req.url, 'http://x'); } catch { return socket.destroy(); }
  const key = req.headers['sec-websocket-key'];
  if (url.pathname !== '/ws' || String(req.headers.upgrade).toLowerCase() !== 'websocket' || !key || conns.size >= MAX_CONNS) {
    return socket.destroy();
  }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );
  new Conn(socket);
});

// Batida de coração: derruba conexões mortas e mantém as vivas abertas atrás de proxies.
setInterval(() => {
  const now = Date.now();
  for (const c of conns) {
    if (now - c.lastSeen > 70000) { c.socket.destroy(); continue; }
    c.socket.write(frame(9, Buffer.alloc(0)));
  }
}, 20000).unref();

// HOST=127.0.0.1 faz o servidor aceitar só conexões deste computador (use quando um túnel ou proxy
// HTTPS fica na frente dele). O padrão aceita a rede toda.
const HOST = process.env.HOST || '0.0.0.0';
server.listen(PORT, HOST, () => {
  console.log(`Resenha no ar na porta ${PORT}${HOST === '0.0.0.0' ? '' : ` (somente ${HOST})`}`);
  console.log(`  neste computador: http://localhost:${PORT}`);
  if (HOST === '0.0.0.0') {
    for (const list of Object.values(os.networkInterfaces())) {
      for (const i of list || []) if (i.family === 'IPv4' && !i.internal) console.log(`  na sua rede:      http://${i.address}:${PORT}`);
    }
  }
});

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(0));
