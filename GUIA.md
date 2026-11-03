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

> Bom saber: o Tailscale limita a banda do Funnel, mas o servidor da Resenha só troca mensagens minúsculas. O vídeo vai direto entre vocês e não passa por ele.

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

**Dica de ouro:** se for compartilhar a tela **com o som do computador**, use fones, senão seus amigos ouvem eco.

### Como atualizar depois
- **App:** mexeu nos arquivos? Rode `git add .`, `git commit -m "mudanca"`, `git push`, depois repita a Parte 3.
- **Servidor:** mande o `.zip` novo (Passo 1.2) e rode de novo o `sudo bash deploy/instalar-ubuntu.sh` (Passo 1.4). Ele atualiza sem perder nada.

---

## Se algo der errado

| O que aconteceu | O que fazer |
|---|---|
| "Não consegui falar com o servidor" | Abra o endereço do Passo 1.6 no navegador. Se **não abrir**, no servidor rode `tailscale funnel status` (tem que listar o endereço) e `sudo systemctl status resenha` (tem que dizer `active (running)`). Se abrir no navegador mas o app falha, confira se o endereço em `app/config.js` está igual, **sem** `https://`. |
| Aparece o site mas fica "Reconectando…" | O Funnel pode não estar repassando conexões de chat. Rode no servidor `sudo journalctl -u resenha -n 30 --no-pager` e me mande o resultado. |
| O servidor reiniciou e nada funciona | O serviço e o Funnel voltam sozinhos. Espere 1 minuto. Se não voltar: `sudo systemctl restart resenha`. |
| Amigo entra, mas fica em "conectando…" e sem vídeo | A internet dele (ou a de alguém) está bloqueando ligação direta. Isso se resolve com um servidor extra chamado TURN. Me avise que eu preparo. |
| Navegador não deixa usar câmera ou microfone | Clique no cadeado ao lado do endereço → permita câmera e microfone → recarregue a página. |
| Quero ver o que o servidor está fazendo | `sudo journalctl -u resenha -f` (Ctrl + C para sair). |
| Quero desligar o acesso pela internet | No servidor: `sudo tailscale funnel reset`. |
| Quero reiniciar o servidor da Resenha | `sudo systemctl restart resenha`. |
