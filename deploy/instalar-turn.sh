#!/usr/bin/env bash
# Instala um servidor TURN (coturn) para a Resenha num Ubuntu/Debian COM IP PÚBLICO
# (um VPS grátis da Oracle, um VPS pago barato, ou seu servidor de casa com portas abertas no roteador).
# Uso:  sudo bash deploy/instalar-turn.sh [IP_PUBLICO]
# Ao final mostra as 2 linhas que você coloca no servidor da Resenha (/etc/resenha.env).
set -euo pipefail

ETC="${ETC:-/etc}"                 # (só para testes) onde gravar a configuração
MIN_PORT="${MIN_PORT:-49152}"
MAX_PORT="${MAX_PORT:-49999}"
say() { printf '==> %s\n' "$*"; }
die() { printf 'ERRO: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "rode com sudo:  sudo bash deploy/instalar-turn.sh"

if [ "${SKIP_INSTALL:-0}" != "1" ]; then
  command -v apt-get >/dev/null || die "este script é para Ubuntu/Debian (apt)."
  say "Instalando o coturn…"
  DEBIAN_FRONTEND=noninteractive apt-get update -y >/dev/null
  DEBIAN_FRONTEND=noninteractive apt-get install -y coturn openssl curl >/dev/null
fi

# IP público: o argumento, ou descobre sozinho.
PUB="${1:-${PUBLIC_IP:-}}"
if [ -z "$PUB" ]; then
  PUB="$(curl -fsS --max-time 8 https://api.ipify.org 2>/dev/null || true)"
fi
echo "$PUB" | grep -Eq '^[0-9]{1,3}(\.[0-9]{1,3}){3}$' || die "não consegui descobrir o IP público. Rode assim: sudo bash deploy/instalar-turn.sh SEU.IP.PUBLICO"

# IP da própria máquina (em VPS da Oracle/AWS/Google ele é diferente do público).
PRIV="${PRIVATE_IP:-$(hostname -I 2>/dev/null | awk '{print $1}')}"
EXT="$PUB"
if [ -n "$PRIV" ] && [ "$PRIV" != "$PUB" ]; then EXT="$PUB/$PRIV"; fi

# Segredo: criado uma vez e reaproveitado se você rodar o script de novo.
SECRET_FILE="$ETC/resenha-turn.secret"
if [ -s "$SECRET_FILE" ]; then SECRET="$(cat "$SECRET_FILE")"
else
  SECRET="$(openssl rand -hex 32)"
  ( umask 077; printf '%s' "$SECRET" > "$SECRET_FILE" )
fi

CONF="$ETC/turnserver.conf"
[ -f "$CONF" ] && [ ! -f "$CONF.original" ] && cp "$CONF" "$CONF.original"
say "Gravando $CONF"
umask 077
cat > "$CONF" <<CFG
# Gerado por deploy/instalar-turn.sh (Resenha)
listening-port=3478
min-port=$MIN_PORT
max-port=$MAX_PORT
external-ip=$EXT
realm=resenha
fingerprint
# credenciais temporárias: o servidor da Resenha as calcula com este mesmo segredo
use-auth-secret
static-auth-secret=$SECRET
# segurança: sem painel remoto, sem TLS próprio (o vídeo já é criptografado pelo WebRTC) e
# sem permitir que o relay alcance a própria máquina, metadados de nuvem e multicast
no-cli
no-tls
no-dtls
no-multicast-peers
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
# limites para um uso de amigos
total-quota=100
stale-nonce=600
no-stdout-log
syslog
CFG
chmod 640 "$CONF"
getent group turnserver >/dev/null 2>&1 && chgrp turnserver "$CONF" || true

if [ "${SKIP_INSTALL:-0}" != "1" ]; then
  # Ubuntu/Debian mais antigos exigem esta linha para o serviço ligar.
  [ -f /etc/default/coturn ] && sed -i 's/^#\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn || true
  systemctl enable coturn >/dev/null 2>&1 || true
  systemctl restart coturn
  sleep 2
  systemctl is-active --quiet coturn || { journalctl -u coturn -n 20 --no-pager || true; die "o coturn não ligou (veja as linhas acima)."; }

  if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
    say "Abrindo as portas no ufw"
    ufw allow 3478/udp >/dev/null; ufw allow 3478/tcp >/dev/null; ufw allow "$MIN_PORT:$MAX_PORT/udp" >/dev/null
  fi
fi

cat <<OUT

OK: o servidor TURN está instalado.

1) Abra estas portas no FIREWALL/painel do seu provedor (entrada, de qualquer origem):
     UDP 3478   TCP 3478   UDP $MIN_PORT-$MAX_PORT
   (Na Oracle isso é na "Security List" da rede E, no Ubuntu deles, também no iptables: veja o GUIA.)

2) No servidor da Resenha, acrescente ao arquivo /etc/resenha.env estas duas linhas:

TURN_URL=turn:$PUB:3478?transport=udp,turn:$PUB:3478?transport=tcp
TURN_SECRET=$SECRET

   e reinicie:  sudo systemctl restart resenha
   (O segredo também fica guardado em $SECRET_FILE. Não publique.)
OUT
