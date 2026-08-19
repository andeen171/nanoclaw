# Publicar: push e PR (fragmento comum aos genomas)

**Tu TENS push.** O proxy do OneCLI injeta a credencial de GitHub no teu tráfego
— a conexão OAuth existe desde 10/08 com escopo `repo`. Nunca configures
credencial, nunca mexas no `remote`, nunca peças token em chat: já está no fio.

```bash
git push -u origin <tua-branch>
```

Se vier `server verification failed: certificate signer not trusted`, é o git
ignorando `SSL_CERT_FILE` e caindo no bundle do sistema. Uma variável resolve:

```bash
GIT_SSL_CAINFO="$SSL_CERT_FILE" git push -u origin <tua-branch>
```

Para o PR, tens o `gh` — **sem `gh auth login`**, que não funciona aqui e não é
preciso: o proxy injeta a credencial e o `GH_TOKEN=placeholder` já vem no
ambiente só para o `gh` não recusar antes de chegar na rede.

```bash
gh pr create --base master --head <tua-branch> --title "<titulo>" --body "Fixes TTK-<n>"
gh pr checks <n>          # estado da CI
gh pr view <n> --comments # comentários de review
```

Se `gh` não estiver no PATH, usa `/workspace/extra/hostbin/gh` — o binário está
montado aí enquanto a imagem nova não é publicada.

Alternativa sem `gh`, mesma credencial e mesmo proxy:

```bash
curl -sS -X POST https://api.github.com/repos/<owner>/<repo>/pulls \
  -H 'Authorization: Bearer placeholder' \
  -H 'Accept: application/vnd.github+json' \
  -d '{"title":"<titulo>","head":"<tua-branch>","base":"master","body":"Fixes TTK-<n>"}'
```

`Fixes TTK-<n>` no corpo faz o merge fechar a issue sozinho — é por isso que tu
**nunca** moves card para Done à mão.

## A regra que não se negocia

**Commit em branch local não é entrega.** Só conta quando a branch está no remote
e o PR existe. Antes de dizer que entregaste, prova:

```bash
git branch -r --contains <sha>     # vazio = não publicaste
```

Isto está escrito porque já falhou: entre 14 e 18/08, dezesseis branches de
trabalho pronto ficaram no disco local porque os genomas afirmavam que não havia
credencial. As células comitavam, reportavam "commit feito", e o supervisor
promovia isso a "está em master". Nenhum PR saiu em dias. A credencial estava
lá o tempo todo.
