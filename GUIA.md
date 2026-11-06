# Guia da Resenha

Siga na ordem. Blocos de código são para **copiar e colar**; troque o que estiver em MAIÚSCULAS (`SEU_USUARIO`) pelo seu valor, sem aspas.

| Parte | O que faz | Tempo |
|---|---|---|
| 1 | Servidor no Ubuntu de casa + Tailscale Funnel | ~20 min |
| 2 | TURN (para quem tem internet "fechada") | ~15 min |
| 3 | GitHub e instalador do Windows | ~40 min (quase tudo espera) |
| 4 | Usar com os amigos e atualizar | 2 min |

**Você precisa de:** PC com Windows, o servidor Ubuntu (acesso por SSH, Tailscale já instalado) e um e-mail para o GitHub.

**Não consegui testar por você:** a montagem do instalador no GitHub, o script num Ubuntu de verdade, o Funnel carregando a chamada e o TURN de verdade. Se algum passo der erro, **copie a mensagem inteira e me mande**.

---

## Parte 1: o servidor em casa

O servidor só **apresenta os amigos uns aos outros**; o vídeo e o som vão direto entre eles. O Tailscale Funnel dá um endereço `https://...` na internet sem abrir portas no roteador.

### 1.1 Mandar os arquivos e instalar
1. Abra o **PowerShell**: tecla Windows, digite `powershell`, Enter.
2. Envie o zip (troque `SEU_USUARIO` pelo usuário do Ubuntu e `ENDERECO_DO_SERVIDOR` pelo IP ou nome, pode ser o do Tailscale, `100.x.x.x`):

```powershell
cd $HOME\Downloads
scp .\resenha-app.zip SEU_USUARIO@ENDERECO_DO_SERVIDOR:~/
```

   Na primeira vez digite `yes`. A senha **não aparece enquanto você digita**; é normal.
3. Entre no servidor. Quando a linha mudar para `usuario@servidor:~$`, você está dentro:

```powershell
ssh SEU_USUARIO@ENDERECO_DO_SERVIDOR
```

4. Instale (um comando de cada vez):

```bash
sudo apt install -y unzip && unzip -o resenha-app.zip
cd resenha && sudo bash deploy/instalar-ubuntu.sh
```

   Tem que terminar com `OK: a Resenha está rodando neste servidor (porta 8787).` O script instala o Node.js se faltar, cria um usuário sem poderes, liga o serviço junto com o servidor e o limita a 150 MB de RAM. Se der `ERRO`, copie as linhas e me mande.

### 1.2 Ligar o Funnel
1. No navegador do Windows abra **https://login.tailscale.com/admin/dns**. Confira o **MagicDNS** e, em **HTTPS Certificates**, clique em **Enable HTTPS** (se já estiver ligado, pule).
2. No servidor: `tailscale version` (precisa ser **1.38.3 ou maior**; senão `sudo tailscale update`). Depois:

```bash
sudo tailscale funnel --bg 8787
```

3. Ele mostra seu endereço, algo como `https://NOME.REDE.ts.net`. **Anote.** Se reclamar que o Funnel não está habilitado, siga o link que ele mostra e rode de novo. Conferir depois: `tailscale funnel status`.

### 1.3 Testar
Abra o endereço no navegador, digite um nome, clique **Criar sala nova** e **Permitir** câmera e microfone. No topo tem que aparecer **● Conectado**. Pronto; saia do servidor com `exit`. Se falhar, veja a tabela no final.

---

## Parte 2: TURN (relay para redes fechadas)

**Por quê:** o Funnel leva só o site e a sinalização, nunca o vídeo. Em algumas internets (4G com CGNAT, empresa, faculdade, roteador fechado) a ligação direta é bloqueada: a pessoa entra mas **não vê nem escuta** quem está nessa situação. O TURN é um repetidor por onde o vídeo (ainda criptografado) passa nesses casos. Só o tráfego que passa por ele conta em cota.

### 2.1 Opção A: Cloudflare (a mais fácil)
Segundo a documentação deles, os primeiros 1.000 GB por período são grátis e depois custam US$ 0,05/GB (não confirmei se o período é mensal).

1. Entre em **https://dash.cloudflare.com** (conta grátis). No menu, em **Calls** (às vezes **Realtime**) → **TURN Server**, clique **Create**. Se não achar, busque "TURN" no painel.
2. Copie o **Turn Token ID** e o **API Token** (este só aparece uma vez). Quem tem o token gasta sua cota: **nunca** o coloque no GitHub nem em `config.js`.
3. No servidor, dentro da pasta `resenha` (reenvie o zip novo se precisar), atualize e abra a configuração:

```bash
sudo bash deploy/instalar-ubuntu.sh
sudo nano /etc/resenha.env
```

   Em **OPÇÃO A**, apague o `#` das duas linhas e cole seus dados (sem aspas nem espaços). Salvar: **Ctrl+O**, Enter, **Ctrl+X**.

```
CF_TURN_KEY_ID=COLE_AQUI_O_TURN_TOKEN_ID
CF_TURN_API_TOKEN=COLE_AQUI_O_API_TOKEN
```

4. Reinicie e confira:

```bash
sudo systemctl restart resenha
sudo journalctl -u resenha -n 10 --no-pager
```

   Deve aparecer `TURN: 2 servidor(es) carregado(s)`. O app **não** precisa de instalador novo por causa disso.

**Limite de gastos (automático):** com a Cloudflare ligada, **só 2 pessoas transmitem a tela ao mesmo tempo**; o terceiro vê um aviso. Câmera, voz e chat não têm limite. Para mudar, ponha `MAX_SCREENS=3` (por exemplo) no `/etc/resenha.env`; `0` tira o limite. A tela sai sempre a **60 fps**; a qualidade em Ajustes muda só a resolução.

**Saber se funciona:** em **Ajustes → Copiar diagnóstico**, a linha `servidor TURN: sim`. Em **Mostrar estatísticas da conexão**, cada vídeo diz `ligação direta` ou `por relay (TURN)`.

### 2.2 Alternativas sem risco de cobrança
| Opção | Custo | Cota | Observação |
|---|---|---|---|
| **A. Cloudflare** | grátis até 1.000 GB, depois US$ 0,05/GB | 1.000 GB | a mais fácil |
| **B. Metered** | grátis | 20 GB/mês | o que acontece depois da cota eu não confirmei |
| **C. coturn num VPS** | Oracle grátis ou poucos euros/mês (Hetzner) | ~10 a 20 TB/mês (confira nos sites deles) | **sem cota prática** |
| **D. coturn em casa** | grátis | sua internet | precisa de IP público (sem CGNAT) |

Pode combinar. Para **garantir que nada seja cobrado**, tire as linhas `CF_...` do `/etc/resenha.env` e use só B, C ou D.

**B (Metered):** crie conta grátis em https://www.metered.ca/tools/openrelay/, pegue o nome do app e a API key, e no `/etc/resenha.env` ponha `ICE_URL=https://SEUAPP.metered.live/api/v1/turn/credentials?apiKey=SUA_KEY`. Reinicie.

**C (VPS) e D (casa):** o mesmo script instala o coturn em qualquer Ubuntu com IP público.
1. Na máquina do TURN (VPS: Ubuntu 22.04 ou 24.04; casa: o próprio servidor), com o zip descompactado, rode `sudo bash deploy/instalar-turn.sh`. Ele imprime **duas linhas** (`TURN_URL=...` e `TURN_SECRET=...`). Copie.
2. Abra as portas (entrada): **UDP 3478, TCP 3478 e UDP 49152 a 49999**: no painel do provedor (Oracle: *Networking → VCN → Security Lists*; Hetzner: *Firewalls*) ou no roteador de casa, apontando para o servidor. **Só na Oracle**, rode também na máquina:

```bash
sudo iptables -I INPUT 1 -p udp --dport 3478 -j ACCEPT
sudo iptables -I INPUT 1 -p tcp --dport 3478 -j ACCEPT
sudo iptables -I INPUT 1 -p udp --dport 49152:49999 -j ACCEPT
sudo apt install -y iptables-persistent && sudo netfilter-persistent save
```

3. No servidor da Resenha: `sudo nano /etc/resenha.env`. Em **OPÇÃO D**, tire o `#` das duas linhas e cole as copiadas. **Ponha `#` nas linhas `CF_...`** (ou apague). Salve e `sudo systemctl restart resenha`.
4. No log deve aparecer `TURN próprio (coturn) ligado` e `Limite de transmissões de tela: nenhum.` O limite de 2 some sozinho sem a Cloudflare. Teste com um amigo no 4G.

Cuidados: em casa, confira o IP público (compare o IP da WAN do roteador com https://api.ipify.org; se forem diferentes é CGNAT e não funciona; se o IP mudar, repita o passo 1). Todo vídeo por relay usa o **upload** da máquina do TURN. Na Oracle, máquinas grátis muito ociosas podem ser recolhidas; confira as regras atuais.

---

## Parte 3: GitHub e instalador do Windows

O GitHub guarda os arquivos e, de graça, **monta o instalador** por você.

### 3.1 Conta e Git
1. Crie a conta em **https://github.com** → *Sign up*, confirme o e-mail e **anote o nome de usuário**.
2. Instale o Git: **https://git-scm.com/download/win** → *Next* em tudo → *Install*. **Feche e reabra o PowerShell.**

### 3.2 Preparar a pasta
1. Em Downloads, botão direito no `resenha-app.zip` → **Extrair tudo**. Copie a pasta que tem dentro `app`, `server` e `src-tauri` para **`C:\resenha`**.
2. Abra `C:\resenha\app\config.js` no Bloco de Notas e ponha o endereço do Passo 1.2 **sem `https://`**:

```js
  server: 'NOME.REDE.ts.net',
```

   Salve (**Ctrl+S**). Assim o app já vem com seu servidor.

### 3.3 Enviar ao GitHub
1. No GitHub: **+** (canto superior) → **New repository**, nome `resenha`, **Private**, sem marcar nada, **Create repository**.
2. No PowerShell, um comando de cada vez:

```powershell
cd C:\resenha
git init
git add .
git commit -m "Primeira versao"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/resenha.git
git push -u origin main
```

   Se o `commit` pedir quem você é: `git config --global user.name "Seu Nome"` e `git config --global user.email "seu-email@exemplo.com"`, e repita o `commit`. No `push` abre o navegador: clique **Authorize**. Recarregue a página do repositório: devem aparecer as pastas.

### 3.4 Gerar e instalar
1. No repositório: aba **Actions** → (habilite, se pedir) → **Gerar instaladores** → **Run workflow** (deixe a caixinha **desmarcada**) → **Run workflow** verde.
2. Espere **10 a 25 minutos** (a bolinha amarela vira ✔ verde).
3. Abra a execução, role até **Artifacts**, baixe **resenha-windows**, extraia e dê dois cliques no **`-setup.exe`**.
4. Se aparecer "O Windows protegeu seu computador": **Mais informações → Executar assim mesmo** (acontece com todo programa sem assinatura paga).

Se aparecer ❌: abra o passo marcado, copie as **últimas 30 linhas** e me mande (é a parte que mais pode precisar de ajuste).

---

## Parte 4: usar com os amigos e atualizar

1. Abra a **Resenha**, digite o nome e **Criar sala nova** (permita câmera e microfone). Clique **Copiar convite** (copia o código da sala).
2. Mande aos amigos o **código** e o **endereço** do Passo 1.2. Eles podem **abrir o endereço no Chrome ou Edge** (sem instalar) ou instalar o `-setup.exe`, que já vem com o servidor configurado.
3. Para transmitir a tela, clique no botão do monitor, escolha **Uma janela** (ou aba, ou tela inteira) e a qualidade, e clique **Transmitir**. Só o som da janela escolhida é compartilhado (tela inteira vai sem som). Use **fones** para ninguém ouvir eco. Se a janela sair sem som, o app avisa; isso depende de um recurso novo do Chrome/Edge (WebView2 atualizado).
   Os amigos veem um bloco “Fulano está transmitindo a tela” e clicam em **Assistir** para receber (e **Sair da transmissão** para parar). Quem não clica não gasta internet. Em Ajustes dá para ligar “Assistir automaticamente”.
4. Para ver o que realmente está saindo: **Ajustes → Mostrar estatísticas** (fps, perda, `limite`: processador ou internet) ou **Copiar diagnóstico**.

### Atualizar sem mandar instalador de novo
O app instalado **abre a interface direto do seu servidor**. Para atualizar todo mundo:
1. Mande o `.zip` novo ao servidor e rode `sudo bash deploy/instalar-ubuntu.sh` (como no 1.1; o `/etc/resenha.env` não é mexido).
2. Cada amigo recebe a versão nova **ao abrir o app** (no navegador, com F5). Quem está em chamada vê o aviso "Saiu uma versão nova" e atualiza depois, sem ser derrubado.

Em **Ajustes** aparece "Versão da interface: xxxxxxxx" (o mesmo código sai no log e no diagnóstico). Se disser "interface local do app", aquele app não falou com o servidor e usa a cópia do instalador.

**Instalador novo só quando mexer em `src-tauri/` ou no `app/config.js`** (`git add .`, `git commit -m "mudanca"`, `git push` e repita o 3.4). Mudanças em `app/` e `server/` não precisam. **Uma vez só:** quem instalou uma versão anterior a este recurso precisa trocar por um instalador novo. O app mostra o que o seu servidor entregar: proteja o servidor e a conta do GitHub (senha forte e verificação em duas etapas).

---

## Se algo der errado

| Problema | O que fazer |
|---|---|
| "Não consegui falar com o servidor" | Abra o endereço no navegador. Se não abrir: no servidor, `tailscale funnel status` e `sudo systemctl status resenha` (tem que ser `active (running)`). Se abrir mas o app falha, confira o endereço em `app/config.js` (sem `https://`). |
| Fica "Reconectando…" | O Funnel pode não estar repassando o chat. Rode `sudo journalctl -u resenha -n 30 --no-pager` e me mande. |
| Servidor reiniciou e nada funciona | Espere 1 minuto; senão `sudo systemctl restart resenha`. |
| Dois amigos entram mas **não se veem nem se escutam** ("conectando…" e depois "sem conexão") | Rede bloqueando a ligação direta: faça a **Parte 2**. Confirme em **Ajustes → Copiar diagnóstico**: `servidor TURN: NÃO` + ligação não `connected`. |
| Fiz o TURN e não liga | `sudo journalctl -u resenha -n 20 --no-pager`: "respondeu 401/403" = token ou ID errado; "404" = ID errado; sem linha de TURN = falta o `/etc/resenha.env` ou reiniciar o serviço. |
| Tela do amigo não aparece, só um bloco “está transmitindo a tela” | É o normal: clique em **Assistir**. |
| "Já há 2 pessoas transmitindo a tela" | É o limite de gastos. Espere uma parar, ou ajuste `MAX_SCREENS` (ver 2.1). |
| Câmera travando | **Ajustes → Mostrar estatísticas**: "webcam entrega 15 fps" = pouca luz; `limite: internet` ou `perda` alta = rede (cabo, ou **Qualidade da câmera → Leve**); `limite: processador` = PC sobrecarregado. Use **Copiar diagnóstico** e me mande. |
| Minha própria câmera (a prévia) parece atrasada | Ligue **Ajustes → Mostrar estatísticas**: no seu quadradinho aparece `prévia 640×360 · 30 fps · N ms da captura à tela`. **N baixo (poucos ms) e a imagem ainda atrasada** = é a webcam entregando tarde. Tente, nesta ordem: acender mais a luz (pouca luz faz a webcam cair para 10 a 15 fps e parecer travada); desligar efeitos de câmera do Windows (desfoque de fundo, enquadramento automático, NVIDIA Broadcast); fechar outros programas que usam a câmera (OBS, Teams); trocar a porta USB (direto no PC, não em hub); testar **Qualidade da câmera → Normal** ou **Leve**. **fps baixo** na prévia = luz ou USB. **N alto** (centenas de ms) = me mande o **Copiar diagnóstico**. |
| Navegador não deixa usar câmera/microfone | Cadeado ao lado do endereço → permitir → recarregar. |
| Ver o que o servidor faz / reiniciar / desligar o acesso | `sudo journalctl -u resenha -f` (Ctrl+C sai) / `sudo systemctl restart resenha` / `sudo tailscale funnel reset`. |
