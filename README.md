# Resenha

Chamada de vídeo, voz e **tela ao mesmo tempo** com seus amigos, no estilo do Discord, feita para gastar pouca RAM.

- Até **8 pessoas** por sala. Entra quem tiver o código da sala.
- Câmera, microfone e compartilhamento de tela (com o som do computador) funcionam juntos.
- Chat de texto na sala.
- Vídeo e áudio vão **direto entre vocês** (WebRTC, criptografado). O servidor só apresenta um amigo ao outro e leva o chat, por isso é minúsculo.
- Zero dependências de terceiros no app e no servidor.

> **Quer só seguir o passo a passo?** Abra o **[GUIA.md](GUIA.md)**: servidor em casa com Ubuntu + Tailscale, GitHub e instalador do Windows, explicado sem pular nada.

## Como funciona

```
 amigo A  <───── vídeo/voz/tela ─────>  amigo B
    \                                    /
     \──── só "apresentações" e chat ───/
                  servidor (Node)
```

- `app/` — o aplicativo (HTML, CSS e JS puro). A mesma pasta serve o navegador e o instalador.
- `server/server.js` — servidor de sinalização (um arquivo, sem `npm install`). Também serve a pasta `app/`.
- `deploy/` — serviço `systemd` e script que instala o servidor num Ubuntu.
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
| `HOST` | `127.0.0.1` aceita só conexões do próprio computador (use atrás de túnel/proxy) | `0.0.0.0` |
| `MAX_ROOM` | pessoas por sala (máx. 12) | 8 |
| `TURN_URL`, `TURN_USER`, `TURN_PASS` | servidor TURN, para quem tem internet que bloqueia ligação direta | — |
| `ICE_SERVERS` | lista completa em JSON (substitui o padrão) | STUN do Google e da Cloudflare |

Endereço de saúde: `/health`. Também há um `Dockerfile` (`docker build -t resenha .` e `docker run -p 8787:8787 resenha`).

## Instalador (Windows, Mac, Linux)

O workflow `.github/workflows/build.yml` monta o instalador no GitHub. Por padrão só o do **Windows**; marque a caixinha ao rodar para incluir Mac e Linux. O passo a passo está no GUIA.md.

No seu PC, sem GitHub: instale Node, [Rust](https://rustup.rs) (e, no Windows, as "Ferramentas de Build do C++" da Microsoft), depois `npm install` e `npm run tauri build`. Os instaladores ficam em `src-tauri/target/release/bundle/`.

Instaladores sem assinatura mostram aviso: no Windows, o SmartScreen ("Windows protegeu seu computador") → *Mais informações* → *Executar assim mesmo*; no Mac, clique direito → *Abrir*.

## Memória (RAM)

- App em JS puro, sem framework, sem biblioteca de chamadas, sem fontes baixadas, sem desfoques nem animações contínuas.
- Câmera começa em 360p e a tela em 720p. Cada pessoa recebe um fluxo seu, então a taxa de envio é dividida automaticamente conforme a sala enche.
- **Janela minimizada → os amigos param de mandar vídeo para você** (ajustável em Ajustes).
- Prévia da própria tela vem desligada.
- Ao sair da sala, câmera, microfone, ligações e o contexto de áudio são liberados.
- No servidor, o serviço é limitado a 150 MB e o Node usa bem menos que isso.

Para ver o consumo real no Windows: Gerenciador de Tarefas → aba *Detalhes* → some `resenha.exe` e os `msedgewebview2.exe` dele. Quanto mais gente com câmera ligada na sala, mais memória o motor de vídeo usa para decodificar; isso é inevitável em qualquer app de chamada.

## O que foi testado e o que não foi

`npm test` roda 61 verificações automáticas (precisa do [Playwright](https://playwright.dev) instalado): servidor (salas, repasse, sala cheia, queda e volta, mensagens inválidas) e **3 navegadores Chromium reais** com câmera e microfone de teste, conferindo voz, câmera, tela com som, chat, modo economia, reconexão e saída.

Também foi testado o script `deploy/instalar-ubuntu.sh` com um `systemctl` simulado: o serviço roda como usuário sem poderes, não consegue alterar os próprios arquivos e recusa conexões que não venham do próprio computador.

Não foi testado:

- **O instalador em si** (a compilação do Tauri). O ambiente onde isto foi escrito não tinha acesso ao `crates.io` nem ao `npm`. O workflow e `src-tauri/` seguem o modelo padrão do Tauri 2, mas a primeira compilação é que vai dizer se algo precisa de ajuste.
- **O script num Ubuntu com systemd de verdade**, e o **Tailscale Funnel** carregando WebSocket (a documentação do Funnel não cita WebSocket; o passo 1.7 do guia testa isso).
- **O seletor real de tela** do sistema: nos testes ele foi simulado. O caminho depois dele (enviar vídeo e som aos amigos) foi testado.
- **Mac e Linux dentro do Tauri**: o motor web desses sistemas pode não permitir compartilhar a tela. No Windows (WebView2, mesma base do Edge) o esperado é funcionar. Se faltar em outro sistema, use a Resenha pelo navegador.

## Limites conhecidos

- Cada pessoa liga em todas as outras, então o **upload** de quem tem a internet mais lenta é o gargalo. Por isso o limite padrão é 8 pessoas.
- Ao compartilhar a tela **com o som do computador**, os amigos podem ouvir eco se você não usar fones.
- Não há contas nem senha de sala: quem souber o código entra. Use códigos longos (o botão "Criar sala nova" já gera um).
- O servidor enxerga nomes, códigos de sala e o chat (texto). Vídeo e áudio não passam por ele.
- Sem servidor TURN, quem estiver numa rede muito restrita pode não conseguir conectar.

## Créditos

Ícones dos botões: [Feather](https://feathericons.com) (licença MIT).
