## Protocolo do board (Linear TTK)

O board é a fonte de verdade. Tua fila: <FILA>.

Ciclo quando o tick te acorda (o script output traz o tamanho da fila):
1. Lista tua fila via MCP do Linear; pega a issue mais antiga.
2. **Claim**: move para In Progress e comenta exatamente `claimed by <célula>`.
3. **Re-read**: relê os comentários da issue. Se o último claim não é teu, outra
   célula ganhou — solta (não mexe mais) e pega a próxima da fila.
4. Trabalha. Commits na branch `chore/ttk-<número>-<slug-curto>` do repo do projeto (campo Project
   da issue diz qual repo em /workspace/extra/dev/).
5. Ao terminar: move o card para o estado seguinte e comenta o resultado —
   o que fez, onde está a branch, o que falta.

Regras duras:
- NUNCA trabalhes numa issue sem claim confirmado pelo re-read.
- **Tens push.** O proxy do OneCLI injeta a credencial de GitHub (conexao OAuth
  com escopo `repo`). Nunca configures credencial, nunca mexas no remote, nunca
  pecas token: `git push -u origin <branch>`. Se vier erro de certificado, usa
  `GIT_SSL_CAINFO="$SSL_CERT_FILE" git push ...` — o git ignora SSL_CERT_FILE.
- **Commit em branch local NAO e entrega.** So conta com a branch no remote e o
  PR aberto. A imagem nao tem `gh`; o PR abre pela API do GitHub. Receita
  completa em /workspace/extra/genomes/_git-publish.md. Prova antes de dizer que
  entregaste: `git branch -r --contains <sha>` vazio = nao publicaste.
- Uma issue por vez. Terminou ou travou → card atualizado antes de pegar outra.
- Travou de verdade → comenta o bloqueio no card, move de volta para a fila
  com label `blocked`, e manda mensagem curta ao mano (destination `mano`).
- Se o MCP do Linear não conectar (OAuth interativo não funciona em container), usa
  GraphQL direto: curl -s https://api.linear.app/graphql -H 'Content-Type: application/json'
  -H 'Authorization: placeholder' -d '<query/mutation>' — o proxy injeta o token real no fio.

## Fluxo (relay de papéis)

Issues podem ter uma linha `Fluxo: papel → papel → …` na descrição (escrita no
grooming pelo po, arbitrada pelo mano nas major). Ao terminar a TUA etapa:
- Há papel DEPOIS do teu no fluxo → troca o label `role:<teu>` pelo
  `role:<próximo>`; estado: **In Review** se o próximo é qa, senão **Todo**.
  Comenta o handoff: o que fizeste, onde está (branch/arquivos), o que o
  próximo papel precisa.
- És o último (ou a issue não tem linha Fluxo) → comportamento normal do teu
  genoma.
- O fluxo é do po+mano: não o alteres. Se achares que falta ou sobra etapa,
  comenta na issue e segue o que está escrito.
