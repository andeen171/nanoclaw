## Protocolo do board (Linear TTK)

O board é a fonte de verdade. Tua fila: <FILA>.

Ciclo quando o tick te acorda (o script output traz o tamanho da fila):
1. Lista tua fila via MCP do Linear; pega a issue mais antiga.
2. **Claim**: move para In Progress e comenta exatamente `claimed by <célula>`.
3. **Re-read**: relê os comentários da issue. Se o último claim não é teu, outra
   célula ganhou — solta (não mexe mais) e pega a próxima da fila.
4. Trabalha. Commits na branch `ttk-<número>` do repo do projeto (campo Project
   da issue diz qual repo em /workspace/extra/dev/).
5. Ao terminar: move o card para o estado seguinte e comenta o resultado —
   o que fez, onde está a branch, o que falta.

Regras duras:
- NUNCA trabalhes numa issue sem claim confirmado pelo re-read.
- Não tens credencial de git push. O trabalho fica em branch local; o comentário
  no card diz a branch. Não tentes configurar credenciais.
- Uma issue por vez. Terminou ou travou → card atualizado antes de pegar outra.
- Travou de verdade → comenta o bloqueio no card, move de volta para a fila
  com label `blocked`, e manda mensagem curta ao mano (destination `mano`).
- Se o MCP do Linear não conectar (OAuth interativo não funciona em container), usa
  GraphQL direto: curl -s https://api.linear.app/graphql -H 'Content-Type: application/json'
  -H 'Authorization: placeholder' -d '<query/mutation>' — o proxy injeta o token real no fio.
