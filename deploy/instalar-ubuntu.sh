#!/usr/bin/env bash
# Instala (ou atualiza) o servidor da Resenha neste Ubuntu Server.
# Rode de dentro da pasta da Resenha:   sudo bash deploy/instalar-ubuntu.sh
set -euo pipefail

DEST="${DEST:-/opt/resenha}"
UNIT_DIR="${UNIT_DIR:-/etc/systemd/system}"
PORT_CHECK="${PORT_CHECK:-8787}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Rode com sudo:  sudo bash deploy/instalar-ubuntu.sh"
  exit 1
fi

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ ! -f "$DIR/server/server.js" ] || [ ! -d "$DIR/app" ]; then
  echo "Não achei server/server.js nem app/. Entre na pasta da Resenha (cd resenha) e rode de novo."
  exit 1
fi

# 1) Node.js 18 ou mais novo
precisa_node=1
if command -v node >/dev/null 2>&1; then
  major="$(node -p 'process.versions.node.split(".")[0]')"
  if [ "$major" -ge 18 ]; then precisa_node=0; fi
fi
if [ "$precisa_node" -eq 1 ]; then
  echo "==> Instalando o Node.js 22 (repositório oficial NodeSource)..."
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
echo "==> Node.js $(node -v)"

# 2) usuário sem poderes, só para rodar o serviço
if ! id resenha >/dev/null 2>&1; then
  echo "==> Criando o usuário 'resenha' (sem login, sem poderes)"
  useradd --system --no-create-home --shell /usr/sbin/nologin resenha
fi

# 3) copia os arquivos (somente leitura para o serviço)
echo "==> Copiando arquivos para $DEST"
mkdir -p "$DEST"
rm -rf "$DEST/server" "$DEST/app"
cp -r "$DIR/server" "$DIR/app" "$DEST/"
chown -R root:root "$DEST"
chmod -R a+rX "$DEST"

# 4) serviço que liga sozinho com o servidor
echo "==> Instalando o serviço"
mkdir -p "$UNIT_DIR"
sed "s#/opt/resenha#$DEST#g" "$DIR/deploy/resenha.service" > "$UNIT_DIR/resenha.service"
chmod 644 "$UNIT_DIR/resenha.service"
systemctl daemon-reload
systemctl enable resenha
systemctl restart resenha
sleep 2

# 5) teste
if curl -fsS "http://127.0.0.1:${PORT_CHECK}/health" >/dev/null 2>&1; then
  echo
  echo "OK: a Resenha está rodando neste servidor (porta ${PORT_CHECK})."
  echo "Próximo passo: ligar o Tailscale Funnel ->  sudo tailscale funnel --bg ${PORT_CHECK}"
else
  echo
  echo "ERRO: o serviço não respondeu. Últimas linhas do registro:"
  journalctl -u resenha -n 25 --no-pager || true
  exit 1
fi
