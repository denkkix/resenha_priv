# Guia da Resenha: do zero até a chamada com os amigos

Este guia leva você de mãos dadas por 4 partes. Siga na ordem e não pule nada.

| Parte | O que você faz | Tempo |
|---|---|---|
| 1 | Colocar o servidor para funcionar no seu Ubuntu de casa e liberar o acesso pela internet com o Tailscale | ~20 min |
| 2 | Subir os arquivos para o GitHub | ~15 min |
| 3 | Pedir ao GitHub para montar o instalador e instalar no seu Windows | ~25 min (a maior parte é espera) |
| 4 | Chamar os amigos | 2 min |

**O que você precisa ter:** seu PC com Windows, acesso ao servidor Ubuntu (por SSH) com o Tailscale já instalado nele, e um e-mail para criar a conta do GitHub (grátis).

**Como ler os blocos cinza:** tudo que está em bloco cinza é para **copiar e colar** exatamente como está. Quando aparecer algo em MAIÚSCULAS, como `SEU_USUARIO`, troque pelo seu valor real (sem aspas e sem espaços).

**O que não consegui testar por você** (para você saber onde pode dar um tropeço): a montagem do instalador no GitHub, o script no seu Ubuntu de verdade e o Tailscale Funnel carregando a chamada. Se qualquer passo mostrar erro, **copie a mensagem inteira e me mande**. Costuma ser coisa pequena de ajustar.

---

## Parte 1: o servidor em casa (Ubuntu + Tailscale)

### Ideia em uma frase
O servidor da Resenha é um programinha que só **apresenta os amigos uns aos outros**. O vídeo e o som vão direto entre vocês, então ele usa quase nada de memória. O Tailscale Funnel dá a ele um endereço `https://...` na internet **sem você abrir portas no roteador**.

### Passo 1.1: Abrir o "PowerShell" no Windows
1. Aperte a tecla **Windows** do teclado.
2. Digite `powershell`.
3. Aperte **Enter**. Abre uma janela azul ou preta com texto. É onde você vai colar comandos.

### Passo 1.2: Mandar os arquivos da Resenha para o servidor
Você baixou um arquivo chamado `resenha-app.zip`. Vamos copiá-lo para o servidor.

1. No PowerShell, vá até a pasta onde o arquivo está. Se ele está em **Downloads**:

```powershell
cd $HOME\Downloads
```

2. Copie para o servidor (troque `SEU_USUARIO` pelo seu usuário no Ubuntu e `ENDERECO_DO_SERVIDOR` pelo IP ou nome do servidor; pode ser o endereço do Tailscale, tipo `100.x.x.x`, ou o nome dele):

```powershell
scp .\resenha-app.zip SEU_USUARIO@ENDERECO_DO_SERVIDOR:~/
```

**O que vai aparecer:**
- Na primeira vez pergunta `Are you sure you want to continue connecting (yes/no)?`. Digite `yes` e Enter.
- Pede a senha. **Ao digitar a senha, nada aparece na tela. É normal.** Digite e aperte Enter.
- Termina mostrando `resenha-app.zip ... 100%`.

**Se der erro:** confira o usuário e o endereço. Teste antes com `ssh SEU_USUARIO@ENDERECO_DO_SERVIDOR`. Se isso entrar, o `scp` também entra.

### Passo 1.3: Entrar no servidor
Ainda no PowerShell:

```powershell
ssh SEU_USUARIO@ENDERECO_DO_SERVIDOR
```

Digite a senha (de novo, não aparece nada). Quando o texto da linha mudar para algo como `usuario@servidor:~$`, você está **dentro do servidor**. A partir daqui, todos os comandos da Parte 1 são digitados nele.

### Passo 1.4: Descompactar e instalar
Cole estes dois comandos, um de cada vez:

```bash
sudo apt install -y unzip && unzip -o resenha-app.zip
```

```bash
cd resenha && sudo bash deploy/instalar-ubuntu.sh
```

(Pode pedir a senha do `sudo`, a mesma do seu usuário.)

**O que vai aparecer:** uma sequência de linhas começando com `==>` e, no fim:

```
OK: a Resenha está rodando neste servidor (porta 8787).
```

O script instala o Node.js se faltar, cria um usuário sem poderes só para a Resenha, coloca o servidor para ligar sozinho quando o servidor reiniciar, e o limita a 150 MB de RAM.

**Se aparecer `ERRO`:** o próprio script mostra as últimas linhas do registro. Copie e me mande.

### Passo 1.5: Ligar o HTTPS do Tailscale (uma vez só, pelo navegador)
O Funnel precisa do "HTTPS" ligado na sua conta Tailscale.

1. No navegador do Windows, abra **https://login.tailscale.com/admin/dns** e entre na sua conta.
2. Confira que o **MagicDNS** está ligado.
3. Mais abaixo, em **HTTPS Certificates**, clique em **Enable HTTPS** (se já estiver ligado, não precisa fazer nada).

### Passo 1.6: Ligar o Funnel (de volta no servidor)
No servidor (a janela do `ssh`), cole:

```bash
tailscale version
```

A primeira linha tem que ser **1.38.3 ou maior**. Se for menor, atualize o Tailscale antes (`sudo tailscale update`). Agora ligue o Funnel:

```bash
sudo tailscale funnel --bg 8787
```

**O que vai aparecer:** uma mensagem com o seu endereço público, parecido com:

```
https://NOME-DO-SERVIDOR.NOME-DA-SUA-REDE.ts.net
```

**Anote esse endereço.** Ele é o endereço da sua Resenha. O `--bg` faz o Funnel continuar ligado em segundo plano e voltar sozinho depois de reiniciar o servidor.

**Se ele reclamar que o Funnel não está habilitado:** a mensagem costuma indicar o que fazer (normalmente um link para aprovar). Faça o que ela pede e rode o comando de novo.

Para conferir depois quando quiser:

```bash
tailscale funnel status
```

### Passo 1.7: Testar
No navegador do Windows, abra o endereço que você anotou. Deve aparecer a tela de entrada da **resenha**. Então:

1. Digite um nome e clique em **Criar sala nova**.
2. O navegador pede para usar câmera e microfone: clique em **Permitir**.
3. No canto direito do topo deve aparecer **● Conectado**.

Se você viu isso, **o servidor está pronto**. Pode sair do servidor digitando `exit` e Enter.

**Se não funcionou**, veja a tabela no final do guia ("Se algo der errado").

> Bom saber: o Tailscale limita a banda do Funnel, mas o servidor da Resenha só troca mensagens minúsculas. O vídeo vai direto entre vocês e não passa por ele. **Atenção:** justamente por isso, sozinho o Funnel não basta para todas as redes. Faça também o Passo 1.8 (TURN).

### Passo 1.8: Ligar o servidor TURN (grátis, e **necessário** para algumas redes)
**Por que isso existe:** o Funnel leva só o site e as "apresentações" entre os amigos. O **vídeo e o som** vão direto de um amigo para o outro. Em algumas internets (celular com CGNAT, redes de empresa ou de faculdade, roteadores bem fechados) essa ligação direta é bloqueada: a pessoa entra na sala, mas **não vê nem escuta** quem está nessa situação. O TURN é um "repetidor" na internet que resolve isso: o vídeo, ainda criptografado, passa por ele quando a ligação direta não é possível. A Cloudflare oferece esse repetidor e os primeiros 1.000 GB por período são grátis (depois é cobrado; se isso te preocupa, veja o Passo 1.9) (segundo a documentação deles hoje; confira em https://developers.cloudflare.com/realtime/turn/faq/ se precisar). Para uns poucos amigos, isso é muito.

**Quanto ao app no Windows:** você **não precisa gerar o instalador de novo** só por causa do TURN. O servidor entrega os dados do repetidor para o app quando ele entra na sala.

1. No navegador do Windows, entre em **https://dash.cloudflare.com** (crie uma conta grátis se não tiver).
2. No menu da esquerda procure **Calls** (em alguns momentos aparece como **Realtime**) e entre em **TURN Server**. Clique em **Create** (Criar), dê um nome qualquer (ex.: `resenha`) e confirme. *O Cloudflare muda os nomes dos menus de vez em quando; se não achar, use a busca do painel por "TURN".*
3. A tela mostra dois dados: o **Turn Token ID** e o **API Token**. **Copie os dois agora** (o API Token só aparece uma vez) e guarde num lugar seguro. Quem tiver o API Token pode gastar sua cota. **Não** coloque isso no GitHub nem em `config.js`.
4. **Atualize o servidor com a versão mais nova** (mande o `.zip` novo como no Passo 1.2, descompacte e, de dentro da pasta `resenha`, rode):

```bash
sudo bash deploy/instalar-ubuntu.sh
```

   Isso cria o arquivo de configuração `/etc/resenha.env` com exemplos já escritos (só o administrador consegue ler). Se ele já existia, **não é mexido**.
5. Abra o arquivo e ligue a Cloudflare:

```bash
sudo nano /etc/resenha.env
```

   Na parte **OPÇÃO A**, apague o `#` do começo das duas linhas e cole seus dados no lugar do texto, sem aspas e sem espaços:

```
CF_TURN_KEY_ID=COLE_AQUI_O_TURN_TOKEN_ID
CF_TURN_API_TOKEN=COLE_AQUI_O_API_TOKEN
```

   Para salvar: **Ctrl + O**, **Enter**, depois **Ctrl + X**. Depois reinicie:

```bash
sudo systemctl restart resenha
```
6. Confira:

```bash
sudo journalctl -u resenha -n 10 --no-pager
```

   Tem que aparecer uma linha como `TURN: 2 servidor(es) carregado(s); renovação automática a cada 3 h`. Se aparecer `não consegui buscar as credenciais`, o ID ou o token foram copiados errados (veja a tabela no final).

O servidor renova as credenciais sozinho. Elas duram 12 horas e o token **nunca** é enviado aos amigos.

**Limite de gastos (automático):** enquanto a Cloudflare (ou outro serviço com cota) estiver ligada, **só 2 pessoas podem transmitir a tela ao mesmo tempo**, para poupar a cota. Quem tenta ser o terceiro vê o aviso "Já há 2 pessoas transmitindo a tela. Quando uma parar, você pode transmitir." Câmera, voz e chat não têm limite. No log do servidor aparece `Limite: no máximo 2 pessoas transmitindo a tela...`. A tela sai sempre a **60 quadros por segundo**; em **Ajustes → Qualidade da tela** muda só a resolução. Para mudar o número do limite, ponha `MAX_SCREENS=3` (por exemplo) no `/etc/resenha.env`.

**Como saber se está funcionando:** na Resenha, abra **Ajustes → Copiar diagnóstico** e cole numa conversa. A linha `servidor TURN: sim` confirma. Na mesma tela, **Mostrar estatísticas da conexão** escreve em cada vídeo `ligação direta` ou `ligação por relay (TURN)`. Se alguém aparece como `por relay`, o repetidor foi necessário e salvou a chamada.

> **Preocupado com a cobrança depois da cota?** Veja o Passo 1.9: há alternativas sem cobrança, inclusive um TURN seu, sem cota nenhuma.

### Passo 1.9: Alternativas à Cloudflare (sem risco de cobrança)
**Antes de mudar, uma conta de cabeça.** Só o tráfego que **passa pelo relay** conta na cota, e a maioria das ligações é direta e não conta. Cada pessoa recebida por relay gasta algo como 1 GB por hora de vídeo (2 Mbps). Os 1.000 GB grátis da Cloudflare dão a ordem de mil horas disso. Para um grupo de amigos, dificilmente acaba; depois da cota a Cloudflare cobra US$ 0,05 por GB (valores da documentação deles). Mesmo assim, se quiser zero risco, as opções são:

| Opção | Custo | Cota | Dá trabalho? | Observação |
|---|---|---|---|---|
| **A. Cloudflare** (Passo 1.8) | grátis até 1.000 GB; depois US$ 0,05/GB | 1.000 GB | pouco | a mais fácil |
| **B. Metered (Open Relay)** | grátis | 20 GB/mês | pouco | o que acontece depois dos 20 GB (parar ou cobrar) eu não confirmei: veja no site deles |
| **C. Seu próprio TURN num VPS** | grátis (Oracle) ou poucos euros/mês (Hetzner, confira o preço) | 10 TB/mês na Oracle (confira no site deles) | médio | **sem cota prática**, o mais seguro contra surpresa |
| **D. Seu próprio TURN em casa** | grátis | sua internet | médio | só funciona se sua internet tiver IP público (sem CGNAT) |

Dá para **combinar**: o app tenta todos os servidores da lista e usa o que funcionar. Para garantir que nada seja cobrado, **não** configure a Cloudflare (apague as duas linhas `CF_...` do `/etc/resenha.env`) e use só B, C ou D.

#### Opção B: Metered (20 GB/mês grátis)
1. Crie uma conta grátis em **https://www.metered.ca/tools/openrelay/** e pegue a sua **API key** e o nome do seu app.
2. O endereço de credenciais tem o formato `https://SEUAPP.metered.live/api/v1/turn/credentials?apiKey=SUA_KEY`.
3. No servidor: `sudo nano /etc/resenha.env` e acrescente (trocando pelo seu):

```
ICE_URL=https://SEUAPP.metered.live/api/v1/turn/credentials?apiKey=SUA_KEY
```
4. `sudo systemctl restart resenha` e confira com `sudo journalctl -u resenha -n 10 --no-pager` (tem que aparecer `TURN: ... carregado(s)`). Se o `ICE_URL` e a Cloudflare estiverem os dois no arquivo, vale a Cloudflare: use só um.

#### Opção C: seu próprio TURN num VPS (coturn, sem cota)
Um **VPS** é um computador alugado na internet, com IP público fixo. O TURN precisa disso porque o vídeo dos amigos vai até ele por **UDP**, algo que o Tailscale Funnel não carrega.
1. **Escolha onde:** a **Oracle Cloud** tem uma máquina "Always Free" (conta grátis, mas pede cartão para verificar) e, segundo o site egresscost.com, 10 TB de saída por mês. Uma alternativa paga e simples é a **Hetzner** (poucos euros por mês e, segundo o egresscost.com, 20 TB de saída; confira o preço atual). Crie uma máquina **Ubuntu 22.04 ou 24.04** e conecte nela por `ssh` como no Passo 1.3. *Cuidado, pelo que sei:* a Oracle pode recolher máquinas grátis que ficam muito ociosas; confira as regras atuais.
2. Mande a pasta da Resenha para essa máquina como no Passo 1.2 (`scp`) e descompacte (`unzip`). Só precisa do arquivo `deploy/instalar-turn.sh`.
3. Instale o coturn (de dentro da pasta `resenha`):

```bash
sudo bash deploy/instalar-turn.sh
```

   O script descobre o IP público, instala o coturn, cria um **segredo** e imprime no final **duas linhas** (`TURN_URL=...` e `TURN_SECRET=...`). **Copie essas duas linhas.**
4. **Abra as portas** (entrada, de qualquer origem): **UDP 3478**, **TCP 3478** e **UDP 49152 a 49999**.
   - No painel do provedor: na Oracle fica em *Networking → sua VCN → Security Lists → Add Ingress Rules*; na Hetzner, em *Firewalls*.
   - **Só na Oracle**, o Ubuntu deles também bloqueia por dentro. Rode na máquina:

```bash
sudo iptables -I INPUT 1 -p udp --dport 3478 -j ACCEPT
sudo iptables -I INPUT 1 -p tcp --dport 3478 -j ACCEPT
sudo iptables -I INPUT 1 -p udp --dport 49152:49999 -j ACCEPT
sudo apt install -y iptables-persistent && sudo netfilter-persistent save
```
5. **No servidor da Resenha** (o de casa), acrescente as duas linhas copiadas em `/etc/resenha.env` (como no Passo 1.8) e reinicie: `sudo systemctl restart resenha`. O log mostra `TURN próprio (coturn) ligado`.
6. Teste: **Ajustes → Copiar diagnóstico** deve dizer `servidor TURN: sim`. Um bom teste real é um amigo entrar pelo 4G (celular sem Wi-Fi) e conferir, com "Mostrar estatísticas", que a ligação dele aparece como `por relay (TURN)`.

O servidor da Resenha calcula as credenciais temporárias sozinho com o segredo, sem consultar ninguém. O segredo nunca vai para os amigos.

#### Opção D: TURN no seu servidor de casa (já deixei pronto)
Funciona com o mesmo script de instalação, mas só se **sua internet tiver IP público de verdade**. Para saber: compare o "IP da internet" que o painel do seu roteador mostra com o que aparece em https://api.ipify.org. Se forem diferentes, você está atrás de CGNAT e **não vai funcionar** (use a opção C).

**Quando você tiver o IP público, a troca da A para a D é esta:**
1. No servidor de casa, dentro da pasta `resenha`: `sudo bash deploy/instalar-turn.sh`. Ele instala o coturn, cria um segredo e imprime duas linhas (`TURN_URL=...` e `TURN_SECRET=...`). Copie.
2. No roteador, redirecione para o IP do servidor as portas **UDP 3478, TCP 3478 e UDP 49152 a 49999**.
3. `sudo nano /etc/resenha.env`:
   - **ponha um `#` no começo** das duas linhas `CF_...` (OPÇÃO A) ou apague-as;
   - **tire o `#`** das duas linhas da **OPÇÃO D** e cole as que o script mostrou.
4. `sudo systemctl restart resenha`.
5. Confira o log: `sudo journalctl -u resenha -n 10 --no-pager`. Tem que aparecer `TURN próprio (coturn) ligado` e `Limite de transmissões de tela: nenhum.` **O limite de 2 transmissões some sozinho** quando a Cloudflare sai do arquivo. Teste com um amigo no 4G.

Dois cuidados: se o IP de casa mudar, o TURN para de funcionar até você repetir o passo 1 com o IP novo; e todo vídeo por relay passa pelo seu **upload** de casa.

---

## Parte 2: subir os arquivos para o GitHub

O GitHub é um site que guarda seus arquivos e, de graça, **monta o instalador do app para você** (porque montar exige programas pesados que você não precisa instalar).

### Passo 2.1: Criar a conta
1. Abra **https://github.com** → **Sign up** e siga o cadastro (e-mail, senha, nome de usuário).
2. Confirme o e-mail (eles mandam um código).
3. **Anote seu nome de usuário.** Vai precisar dele.

### Passo 2.2: Instalar o Git no Windows
O Git é o programa que envia os arquivos ao GitHub.

1. Abra **https://git-scm.com/download/win**. O download começa sozinho.
2. Abra o arquivo baixado e clique em **Next** em todas as telas até **Install** e depois **Finish**.
3. **Feche o PowerShell e abra de novo** (passo 1.1) para ele "enxergar" o Git.

### Passo 2.3: Descompactar a Resenha no seu PC
1. Vá até a pasta **Downloads**, clique com o botão direito no `resenha-app.zip` → **Extrair tudo…** → **Extrair**.
2. Abra a pasta que apareceu até achar a que tem dentro as pastas **app**, **server** e **src-tauri**. É a pasta do projeto. Para facilitar, **copie essa pasta para `C:\resenha`** (arraste para o disco C:).

### Passo 2.4: Colocar o endereço do seu servidor no app
Assim os amigos não precisam digitar nada.

1. Abra `C:\resenha\app\config.js` com o **Bloco de Notas** (botão direito → Abrir com → Bloco de Notas).
2. Você vai ver uma linha assim:

```js
  server: '',
```

3. Coloque o endereço do Passo 1.6 **sem o `https://`** no meio das aspas:

```js
  server: 'NOME-DO-SERVIDOR.NOME-DA-SUA-REDE.ts.net',
```

4. **Ctrl + S** para salvar e feche.

### Passo 2.5: Criar o "cofre" vazio no GitHub
1. No GitHub, clique no **+** (canto superior direito) → **New repository**.
2. Em **Repository name**, digite `resenha`.
3. Escolha **Private** (só você vê).
4. **Não marque nada** em "Add a README", ".gitignore" ou "license".
5. Clique em **Create repository**.
6. Na página que abrir, deixe a aba aberta. Vamos usá-la já.

### Passo 2.6: Enviar os arquivos
No PowerShell (aberto de novo depois de instalar o Git), cole **um comando de cada vez**:

```powershell
cd C:\resenha
```

```powershell
git init
```

```powershell
git add .
```

```powershell
git commit -m "Primeira versao"
```

> Se ele reclamar `Please tell me who you are` (pede quem é você), rode estes dois (com os seus dados) e repita o `git commit` acima:
> ```powershell
> git config --global user.name "Seu Nome"
> git config --global user.email "seu-email@exemplo.com"
> ```

```powershell
git branch -M main
```

Agora o comando que liga a sua pasta ao cofre (troque `SEU_USUARIO` pelo seu nome de usuário do GitHub):

```powershell
git remote add origin https://github.com/SEU_USUARIO/resenha.git
```

E o envio:

```powershell
git push -u origin main
```

**O que vai aparecer:** abre uma janela do navegador pedindo para entrar no GitHub e autorizar. Clique em **Authorize**. Depois o PowerShell mostra uns números subindo e termina com algo como `Branch 'main' set up to track 'origin/main'`.

**Para conferir:** recarregue a página do repositório no GitHub (F5). Devem aparecer as pastas `app`, `server`, `src-tauri`, `deploy`, `.github`, `test` e os arquivos. Se aparecer, está pronto.

---

## Parte 3: gerar o instalador e instalar

### Passo 3.1: Mandar o GitHub montar o instalador
1. No seu repositório, clique na aba **Actions** (barra no topo).
2. Se aparecer um botão verde pedindo para habilitar, clique nele.
3. Na lista da esquerda, clique em **Gerar instaladores**.
4. À direita, clique em **Run workflow** (botão cinza) → deixe a caixinha **desmarcada** (assim ele monta só o do Windows, que é o que você precisa) → clique no botão verde **Run workflow**.

### Passo 3.2: Esperar
1. Recarregue a página (F5): aparece uma linha com uma **bolinha amarela girando**. Clique nela e depois em **build**.
2. Na primeira vez demora **de 10 a 25 minutos**, porque ele baixa e compila tudo. Pode fechar a página e fazer outra coisa.
3. Quando terminar, a bolinha vira um **✔ verde**.

### Passo 3.3: Baixar o instalador
1. Entre na execução que terminou (clique na linha com ✔).
2. Role até o fim da página, até a seção **Artifacts**.
3. Clique em **resenha-windows** para baixar (vem num `.zip`).
4. Extraia o `.zip` (botão direito → Extrair tudo). Dentro tem um arquivo terminado em **`-setup.exe`** (e, se vier, um `.msi`; use o `-setup.exe`).

**Se aparecer um ❌ vermelho:** clique no `build`, procure o passo marcado com ❌, abra-o, copie as **últimas 30 linhas** do texto e me mande. Esta é a parte que eu não consegui testar por você, então é a mais provável de precisar de um ajuste pequeno.

### Passo 3.4: Instalar
1. Dê dois cliques no `-setup.exe`.
2. O Windows pode mostrar **"O Windows protegeu seu computador"**. Isso acontece com todo programa novo que não é "assinado" (assinar custa dinheiro). Clique em **Mais informações** → **Executar assim mesmo**.
3. Avance até concluir. A **Resenha** aparece no Menu Iniciar.

---

## Parte 4: usar com os amigos

1. Abra a **Resenha**, digite seu nome e clique em **Criar sala nova**. Permita câmera e microfone.
2. Clique em **Copiar convite** (no topo). Isso copia o **código da sala** (algo como `lua-vento-4821`).
3. **Mande para os amigos o código e o endereço**, de um destes dois jeitos:
   - **Sem instalar nada (mais fácil):** eles abrem o endereço do Passo 1.6 no **Chrome ou Edge**, digitam o nome e o código, e entram.
   - **Com o app:** mande o `-setup.exe` (por Google Drive, por exemplo). Ele já vem com o seu servidor configurado. É só abrir, digitar nome e código.
4. Para transmitir a tela, clique no botão do monitor (🖥) na barra de baixo e escolha a tela ou a janela. Câmera, voz e tela funcionam juntas.

**Transmissão de tela:** sai sempre a 60 quadros por segundo. Para ver o que realmente saiu, ligue **Ajustes → Mostrar estatísticas da conexão** (e **Mostrar prévia da minha tela** para ver na sua janela) ou use **Copiar diagnóstico**: aparecem `fps`, `captura entrega … fps` e o `limite` (processador, internet ou nenhum). Se aparecer menos de 60, o limite é o PC ou a internet.

**Dica de ouro:** se for compartilhar a tela **com o som do computador**, use fones, senão seus amigos ouvem eco.

### Como atualizar depois (sem mandar instalador de novo)
O app instalado **abre a interface direto do seu servidor**. Por isso, para atualizar a Resenha para todo mundo:

1. No seu PC, descompacte o `.zip` novo.
2. Mande para o servidor e instale por cima, como nos Passos 1.2 e 1.4: `sudo bash deploy/instalar-ubuntu.sh`. Ele atualiza sem perder nada (o `/etc/resenha.env` não é mexido).
3. **Pronto.** Cada amigo recebe a versão nova **na próxima vez que abrir o app** (ou apertando F5 no navegador). Quem estava no meio de uma chamada vê o aviso "Saiu uma versão nova da Resenha" e atualiza ao terminar, sem ser derrubado.

Para conferir qual versão cada um está usando: **Ajustes** mostra "Versão da interface: xxxxxxxx" (o mesmo código aparece no log do servidor, `sudo journalctl -u resenha -n 5 --no-pager`, e em **Copiar diagnóstico**). Se o Ajustes disser "interface local do app", aquele app **não conseguiu falar com o servidor** e está usando a cópia que veio no instalador.

**Só precisa de instalador novo** quando você mexer no que fica *dentro* do instalador: a pasta `src-tauri/` (nome, ícone, tamanho da janela, versão do Tauri) ou o endereço do servidor no `app/config.js`. Mudanças em `app/` (telas, botões, qualidade) e em `server/` **não** precisam.

**Uma vez só:** quem já instalou uma versão *anterior* a esta (sem a atualização automática) precisa instalar **um** instalador novo, montado com os arquivos deste `.zip` (Parte 3). Daí em diante não precisa mais.

**Segurança:** o app mostra o que o seu servidor entregar. Só o dono do servidor pode mudar isso, então mantenha o servidor e a conta do GitHub protegidos (senha forte, verificação em duas etapas).

- **Instalador (quando precisar):** mexeu nos arquivos? Rode `git add .`, `git commit -m "mudanca"`, `git push`, depois repita a Parte 3.

---

## Se algo der errado

| O que aconteceu | O que fazer |
|---|---|
| "Não consegui falar com o servidor" | Abra o endereço do Passo 1.6 no navegador. Se **não abrir**, no servidor rode `tailscale funnel status` (tem que listar o endereço) e `sudo systemctl status resenha` (tem que dizer `active (running)`). Se abrir no navegador mas o app falha, confira se o endereço em `app/config.js` está igual, **sem** `https://`. |
| Aparece o site mas fica "Reconectando…" | O Funnel pode não estar repassando conexões de chat. Rode no servidor `sudo journalctl -u resenha -n 30 --no-pager` e me mande o resultado. |
| O servidor reiniciou e nada funciona | O serviço e o Funnel voltam sozinhos. Espere 1 minuto. Se não voltar: `sudo systemctl restart resenha`. |
| Dois amigos entram, mas **não se veem nem se escutam** (o vídeo diz "conectando…" e depois "sem conexão") | A internet de um deles bloqueia a ligação direta entre os dois. A solução é o servidor TURN: faça o **Passo 1.8**. Para confirmar a causa, abra **Ajustes → Copiar diagnóstico**: `servidor TURN: NÃO` + ligação não `connected` = é isso. |
| Fiz o Passo 1.8 e continua sem ligar | `sudo journalctl -u resenha -n 20 --no-pager`. "respondeu 401/403": o API Token ou o ID está errado (copie de novo, sem espaço no fim). "respondeu 404": o ID está errado. Sem nenhuma linha de TURN: o arquivo `/etc/resenha.env` não existe ou o serviço não foi reiniciado (`sudo bash deploy/instalar-ubuntu.sh`). |
| Aparece "Já há 2 pessoas transmitindo a tela" | É o limite de gastos: com a Cloudflare ligada só 2 pessoas transmitem a tela ao mesmo tempo. Espere uma parar. Para mudar: `MAX_SCREENS=3` no `/etc/resenha.env`. Some sozinho com coturn próprio (Opção D). |
| A câmera está travando | Abra **Ajustes → Mostrar estatísticas da conexão**. Em cada vídeo aparece `fps`, `kbps`, `perda` e o `limite` (processador, internet ou nenhum). Fps baixo com "webcam entrega 15 fps" = a webcam está com pouca luz (acenda a luz do quarto). `limite: internet` ou `perda` alta = rede (use cabo, ou **Qualidade da câmera → Leve**). `limite: processador` = o PC está sobrecarregado. Depois use **Copiar diagnóstico** e me mande. |
| Navegador não deixa usar câmera ou microfone | Clique no cadeado ao lado do endereço → permita câmera e microfone → recarregue a página. |
| Quero ver o que o servidor está fazendo | `sudo journalctl -u resenha -f` (Ctrl + C para sair). |
| Quero desligar o acesso pela internet | No servidor: `sudo tailscale funnel reset`. |
| Quero reiniciar o servidor da Resenha | `sudo systemctl restart resenha`. |
