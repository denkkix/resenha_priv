# Resenha

Chamada de vídeo, voz e **tela ao mesmo tempo** com seus amigos, no estilo do Discord, feita para gastar pouca RAM.

- Até **8 pessoas** por sala por padrão (configurável até 12). Entra quem tiver o código da sala.
- Câmera, microfone e compartilhamento de tela (com o som **só da janela escolhida**) funcionam juntos.
- **Transmissão estilo Discord:** ao transmitir você escolhe *janela, aba ou tela inteira* e a qualidade; os amigos veem um bloco **“Fulano está transmitindo a tela · N assistindo”** e só recebem o vídeo e o som quando clicam em **Assistir** (ou se ligarem “assistir automaticamente”). Quem não assiste não gasta internet, nem a cota do relay.
- Chat de texto na sala.
- Vídeo e áudio usam **WebRTC criptografado**: vão direto entre vocês quando a rede permite ou passam por um relay TURN quando necessário. O servidor da Resenha faz a sinalização, leva o chat e serve a interface; ele não transporta a mídia.
- Zero dependências de terceiros no app e no servidor.

> **Quer só seguir o passo a passo?** Abra o **[GUIA.md](GUIA.md)**: servidor em casa com Ubuntu + Tailscale, GitHub e instalador do Windows, explicado sem pular nada.

## Como funciona

```
 amigo A  <──── vídeo/voz/tela via WebRTC ────> amigo B
    \                                    /
     \──── sinalização e chat ─────────/
              servidor da Resenha
        (TURN pode retransmitir a mídia)
```

- `app/` — o aplicativo (HTML, CSS e JS puro). A mesma pasta serve o navegador e o instalador.
- `server/server.js` — servidor de sinalização (um arquivo, sem `npm install`). Também serve a pasta `app/`.
- `deploy/` — serviço `systemd`, script que instala o servidor num Ubuntu, `resenha.env.exemplo` (configuração com a opção A e a D prontas para ligar) e `instalar-turn.sh` (coturn).
- `src-tauri/` — casca do instalador, feita com [Tauri](https://tauri.app). Usa o motor web que já existe no sistema (WebView2 no Windows), em vez de embutir um Chrome inteiro como o Electron.

## Rodar agora (teste de 1 minuto)

Precisa de [Node.js](https://nodejs.org) 18 ou mais novo.

```
node server/server.js
```

Abra `http://localhost:8787` no Chrome ou no Edge, em duas abas, entre com o mesmo código de sala e pronto.

> Câmera e microfone no **navegador** só funcionam em `https://` ou em `localhost`. Para os amigos, use o servidor em casa com Tailscale Funnel (veja o GUIA.md), que entrega HTTPS.

## Servidor

Opções por variável de ambiente:

| Variável | Para quê | Padrão |
|---|---|---|
| `PORT` | porta | 8787 |
| `HOST` | endereço de escuta; `127.0.0.1` aceita conexões só do próprio computador (útil atrás de túnel/proxy) | `0.0.0.0` |
| `MAX_ROOM` | pessoas por sala (máximo permitido: 12) | 8 |
| `MAX_ROOMS` | número máximo de salas simultâneas | 500 |
| `MAX_CONNS` | número máximo de conexões WebSocket simultâneas | 2000 |
| `GRACE_MS` | tempo para uma pessoa reconectar sem perder o lugar na sala | 6000 ms |
| `CF_TURN_KEY_ID`, `CF_TURN_API_TOKEN` | **TURN da Cloudflare**: o servidor busca credenciais temporárias e as renova sozinho; o token nunca vai para os clientes | — |
| `ICE_URL` | outro serviço de TURN (ex.: Metered) que devolva uma lista `iceServers` por GET | — |
| `MAX_SCREENS` | quantas pessoas podem transmitir a tela ao mesmo tempo (0 = sem limite). **Automático:** 2 quando há Cloudflare/`ICE_URL` (relay com cota); sem limite com coturn próprio ou sem TURN | automático |
| `ICE_TTL_S`, `ICE_REFRESH_MS`, `ICE_RETRY_MS`, `CF_API_BASE` | validade (12 h), renovação (3 h), nova tentativa após falha (60 s) e endereço da API | — |
| `TURN_URL`, `TURN_SECRET` | **coturn próprio** com segredo compartilhado (TURN REST API): o servidor calcula credenciais temporárias na hora, sem serviço externo. `deploy/instalar-turn.sh` instala o coturn e imprime estas duas linhas | — |
| `TURN_URL`, `TURN_USER`, `TURN_PASS` | um servidor TURN seu, com usuário e senha fixos (sem `TURN_SECRET`) | — |
| `ICE_SERVERS` | lista completa em JSON (substitui o padrão) | STUN do Google e da Cloudflare |

No serviço do Ubuntu, coloque os segredos em `/etc/resenha.env` (`chmod 600`); o `systemd` lê esse arquivo.

O instalador Ubuntu configura `HOST=127.0.0.1`, pois o Tailscale Funnel fica na frente do servidor. Ao executar o Node diretamente ou no Docker, o padrão é `0.0.0.0`. Endereços de saúde e versão: `/health` e `/version.json`. Também há um `Dockerfile` (`docker build -t resenha .` e `docker run -p 8787:8787 resenha`).

## Instalador (Windows, Mac, Linux)

O workflow `.github/workflows/build.yml` monta o instalador no GitHub. Por padrão só o do **Windows**; marque a caixinha ao rodar para incluir Mac e Linux. O passo a passo está no GUIA.md.

No seu PC, sem GitHub: instale Node, [Rust](https://rustup.rs) (e, no Windows, as "Ferramentas de Build do C++" da Microsoft), depois `npm install` e `npm run tauri build`. Os instaladores ficam em `src-tauri/target/release/bundle/`.

Instaladores sem assinatura mostram aviso: no Windows, o SmartScreen ("Windows protegeu seu computador") → *Mais informações* → *Executar assim mesmo*; no Mac, clique direito → *Abrir*.

## Atualização do app (sem instalador novo)

O app instalado guarda uma cópia da interface. Quando há um endereço de servidor configurado, **ao abrir confere o servidor** (`/version.json`) e, se for um servidor da Resenha, passa a mostrar a interface *do servidor* (`app/boot.js`). Atualizar o servidor atualiza esses apps na próxima abertura; quem está numa chamada recebe um aviso e atualiza depois. Se o servidor não responder, o app segue com a cópia local. Sem endereço configurado, também usa a cópia local até a pessoa informar um servidor. A versão é um resumo (hash) dos arquivos de `app/`, calculado ao ligar o servidor; aparece em Ajustes e no diagnóstico.

Só é preciso um instalador novo ao mudar `src-tauri/` ou o `app/config.js`. Quem já tem um instalador antigo, anterior a este recurso, precisa trocar uma vez.

Limite: isso atualiza a interface (HTML/CSS/JS) e o servidor, não o programa em Rust do instalador. Para atualizar também o programa dentro do app existe o *updater* do Tauri (assinatura de arquivos e `latest.json` no GitHub Releases); não está ligado porque não é necessário para o que muda no dia a dia.

## Memória (RAM)

- App em JS puro, sem framework, sem biblioteca de chamadas, sem fontes baixadas, sem desfoques nem animações contínuas.
- Câmera começa em 360p e a tela em 720p. Cada pessoa recebe um fluxo seu, então a taxa de envio é dividida automaticamente conforme a sala enche.
- **Janela minimizada por mais de 6 segundos → os amigos param de mandar vídeo para você** (ajustável em Ajustes). Um alt-tab rápido não corta nada.
- Prévia da própria tela vem desligada.
- **Tela sempre a 60 quadros por segundo.** A qualidade (Ajustes) muda só a resolução e o teto de banda: Leve 720p/2,5 Mbps, Equilibrada 720p/4,5 Mbps, Alta 1080p/8 Mbps (tetos; o WebRTC usa menos se der). 60 fps pedem bem mais banda que 30: com teto baixo o WebRTC corta quadros e resolução. O envio de tela fica limitado a 16 Mbps no total, dividido só entre quem está assistindo.
- Ao sair da sala, câmera, microfone, ligações e o contexto de áudio são liberados.
- Na instalação Ubuntu, o serviço `systemd` é limitado a 150 MB (`MemoryMax`); essa restrição não se aplica ao Node executado diretamente nem ao Docker.

Para ver o consumo real no Windows: Gerenciador de Tarefas → aba *Detalhes* → some `resenha.exe` e os `msedgewebview2.exe` dele. Quanto mais gente com câmera ligada na sala, mais memória o motor de vídeo usa para decodificar; isso é inevitável em qualquer app de chamada.

## O que foi testado e o que não foi

`npm test` roda 228 verificações automáticas na execução completa. Os testes do servidor rodam com Node.js; os testes de interface e WebRTC precisam do [Playwright](https://playwright.dev) instalado e, sem ele, são pulados. Eles usam Chromium com câmera e microfone simulados e conferem voz, câmera, tela com som, chat, modo economia, reconexão e saída. Também testam o TURN contra uma Cloudflare **simulada** (pedido, renovação, queda e recuperação), o painel de estatísticas e o aviso de "sem conexão" numa rede com UDP bloqueado.

Também foi testado o script `deploy/instalar-ubuntu.sh` com um `systemctl` simulado: o serviço roda como usuário sem poderes, não consegue alterar os próprios arquivos e recusa conexões que não venham do próprio computador.

Não foi testado:

- **O `deploy/instalar-turn.sh` num VPS de verdade e um coturn real** (só a geração do arquivo de configuração foi testada, e a senha temporária confere com o algoritmo documentado). Também não testei Oracle, Hetzner nem o Metered de verdade.
- **O TURN contra a Cloudflare de verdade** (sem acesso a ela no ambiente de teste): o formato do pedido segue a documentação, mas o primeiro teste real é o 2.1 do guia. Também não foi possível testar uma ligação que de fato passe por relay.
- **O app instalado carregando a interface do servidor dentro do Tauri/WebView2.** Testei a lógica (`boot.js`) num Chromium abrindo a cópia local por `file://`, com servidor no ar, fora do ar e de outro tipo. Falta confirmar no Windows: que o WebView2 aceita navegar para o endereço do servidor e que câmera, microfone e tela funcionam nessa origem. Se não aceitar, o app continua na cópia local (como antes), sem quebrar.
- **O instalador em si** (a compilação do Tauri). O ambiente onde isto foi escrito não tinha acesso ao `crates.io` nem ao `npm`. O workflow e `src-tauri/` seguem o modelo padrão do Tauri 2, mas a primeira compilação é que vai dizer se algo precisa de ajuste.
- **O script num Ubuntu com systemd de verdade**, e o **Tailscale Funnel** carregando WebSocket (a documentação do Funnel não cita WebSocket; o passo 1.3 do guia testa isso).
- **O seletor real de tela** do sistema: nos testes ele foi simulado. O caminho depois dele (enviar vídeo e som aos amigos) foi testado.
- **Seletor de janelas com miniaturas dentro do app (como o do Discord): não existe.** A janela “Transmitir a tela” do app escolhe o *tipo* (janela, aba, tela inteira) e a qualidade e repassa isso ao navegador como dica; quem mostra a lista de janelas é o seletor do próprio sistema/WebView2. Um seletor próprio exigiria código nativo (Rust/Windows) que não dá para compilar nem testar aqui.
- **Diagnóstico com histórico:** enquanto alguém transmite ou assiste, o app grava a cada 2 s (até 3 min) fps, banda, captura, limite, perda e travadas, mesmo com o app escondido atrás de um jogo, e o “Copiar diagnóstico” traz o resumo separado em “app na frente” e “app escondido”. Sem isso o diagnóstico só media depois de voltar ao app, quando o jogo já saiu da frente.
- **Transmissão sem resposta:** se o seletor do sistema não responde em 25 s, ou a captura começa mas não entrega quadros em 4 s, o app avisa. O diagnóstico traz `passos da transmissão` (onde parou) e `aplicativo: instalado ou navegador`.
- **Falhas ao transmitir nunca ficam em silêncio:** se o sistema recusar a captura (`AbortError`, “Permission denied by system” etc.), o app mostra o motivo e o diagnóstico traz a linha `último erro:`.
- **Codificador H.264 (Ajustes, experimental):** pede ao Windows para codificar a tela na placa de vídeo, aliviando o processador (útil em jogos). Só vale se os dois lados escolherem; se só um escolher, a ligação segue em VP8. A negociação foi testada, mas o uso real da placa de vídeo no Windows não: o painel de estatísticas mostra “codificador H264 / … (hardware)” quando funcionar.
- O botão **Assistir**, o contador e a economia de banda foram testados com 3 navegadores reais; o ganho de banda no mundo real (e na cota da Cloudflare) não foi medido.
- **Mac e Linux dentro do Tauri**: o motor web desses sistemas pode não permitir compartilhar a tela. No Windows (WebView2, mesma base do Edge) o esperado é funcionar. Se faltar em outro sistema, use a Resenha pelo navegador.

## Limites conhecidos

- Cada pessoa liga em todas as outras, então o **upload** de quem tem a internet mais lenta é o gargalo. Por isso o limite padrão é 8 pessoas.
- Os 60 fps da tela foram testados com uma fonte de vídeo sintética; **com a captura de tela real no Windows não foi testado**. O número que vale é o do painel "Mostrar estatísticas" (`captura entrega … fps`).
- **Som da tela: só o da janela (ou aba) escolhida, nunca o do computador inteiro.** O app pede isso ao navegador (`windowAudio: 'window'`, `systemAudio: 'exclude'`, recurso do Chrome/Edge novos, a partir do 141 segundo o anúncio do Chromium) e **confere o resultado**: se você escolher a tela inteira, o áudio é descartado; se não der para saber o que foi escolhido, também. Se o sistema não oferecer o áudio da janela (versão antiga do WebView2/Chrome, ou Windows sem esse recurso), a tela vai sem som e o app avisa. Não testei com uma janela real no Windows: nos testes o seletor é simulado. O microfone da chamada não muda.
- Com o som da janela, os amigos podem ouvir eco se você não usar fones.
- Não há contas nem senha de sala: quem souber o código entra. Use códigos longos (o botão "Criar sala nova" já gera um).
- O servidor enxerga nomes, códigos de sala e o chat (texto). Vídeo e áudio não passam por ele.
- **Sem servidor TURN, quem estiver numa rede restrita (CGNAT, empresa, faculdade) pode não conseguir ver nem ouvir alguns amigos.** O Tailscale Funnel só leva o site e a sinalização, nunca o vídeo. Ligue o TURN (GUIA.md, Parte 2). Quando a ligação passa pelo relay, o upload de todos continua sendo usado e a cota do serviço de TURN também.
- Quem souber o endereço público do servidor consegue pedir as credenciais de TURN (elas valem 12 h). É o preço de ter TURN sem contas; acompanhe o uso no painel da Cloudflare.

## Créditos

Ícones dos botões: [Feather](https://feathericons.com) (licença MIT).
