# Engineering MCP

Memória local do seu trabalho de engenharia no Cursor. Você fala o que está fazendo. O MCP grava, recupera e sugere o próximo passo. O Cursor pensa; este processo lembra. Nada sai da sua máquina.

Não precisa de Jira, de ID pronto, nem de saber o catálogo de tools.

Visão: [VISION.md](VISION.md).

---

## Começar (2 minutos)

Node **22+**. Cole no `~/.cursor/mcp.json` e recarregue os MCPs:

```json
{
  "mcpServers": {
    "engineering": {
      "command": "npx",
      "args": ["-y", "engineering-mcp@latest"]
    }
  }
}
```

No chat, peça ao agente para usar o MCP **engineering** e diga:

```text
Comecei um bug: timeout no checkout
```

Isso cria o projeto (se não houver), abre o ticket, foca nele e pede evidência. Depois, no mesmo fio:

```text
Anexa evidência 401
Hipótese: token expirado
40 min
Causa raiz: cache do client, flaky
O que aconteceu?
Me prepara para a daily
```

Inglês também vale: `Started a bug: checkout timeout`.

Banco: `~/.engineering-mcp/engineering.db`. npm leva **só o código**.

Não substitui o que você já tem.

| MCP | Papel |
|-----|--------|
| **engineering-mcp** (este) | Memória do ciclo: work, evidência, tempo, RCA, daily |
| `qa-lab-agent` | Roda testes |
| `qa-oracle` | CI / Jira da empresa |

**Fronteiras (não misturar):** lab-agent executa a suite; oracle puxa CI/Jira da empresa; mockserver/core-mcp/GitLab/Sonar continuam nos respectivos MCPs. Aqui entra o que *aconteceu neste ciclo* — depois do fato. `external_key` é ponte, não espelho do Jira.

Se o `eng_route` só responder “domínio QA, use qa_record_run”, o `npx` está na versão antiga. Recarregue o MCP; `engineering-mcp@latest` puxa o **0.2.0** do npm. Não clone o repo para usar.

Pacote: [npmjs.com/package/engineering-mcp](https://www.npmjs.com/package/engineering-mcp) · código: [github.com/Wesley-Gomes93/engineering-mcp](https://github.com/Wesley-Gomes93/engineering-mcp)

---

## Exemplo: falha de componente (piloto)

Skills e specs dizem **como** automatizar. Este MCP registra **o que aconteceu**.

```text
Comecei um bug: TDS_CARD timeout no bottom sheet (Android)
  → ticket + foco (CQA-n se o projeto core-qa já existir)

Anexa evidência: fail no CI, suite TDS_CARDTEST.js
Hipótese: timeout do mock com lazy load
40 min
Causa raiz: timeOutMsgComponents curto demais, flaky
O que aconteceu?
Já vimos isso?
```

A RCA vira lesson sozinha. Na próxima falha parecida, o foco sussurra o playbook — se houver sinal. `eng_context` / `eng_report` são o pacote de handoff (não um dashboard).

---

## Desenvolvimento local

```bash
npm install
npm install -g .
```

```json
{
  "mcpServers": {
    "engineering": {
      "command": "engineering-mcp"
    }
  }
}
```

---

## Loop típico

Fale em português ou inglês. `eng_route` **executa**. Banco vazio é ok.

```text
"Comecei um bug: timeout no checkout"
  → cria projeto + ticket + foco (ex: ENG-1)

"Comecei o APP-1"
  → se não existir, cria o projeto APP e o ticket

"Anexa evidência 401"
  → run fail + evidência no ticket em foco

"Hipótese: seletor instável"
  → finding (abre investigação se precisar)

"40 min"
  → sessão de trabalho + horas

"Causa raiz: timing no botão, flaky"
  → fecha a investigação

"O que aconteceu?"
  → história completa (work, QA, tempo, RCA, parecidos)

"Já vimos isso?"
  → tickets e playbooks semelhantes

"Me prepara para a daily"
  → resumo do dia
```

As tools `work_*`, `qa_*`, `time_*`, `investigate_*`, `knowledge_*` e `report_*` continuam como aliases.

Fails repetidos, RCA e hora acima da estimativa viram lesson/pattern sozinhos. Pattern que volta abre um ticket `Melhoria: …` no backlog.

O MCP **não** é um modelo na nuvem. O Cursor pensa; este processo lembra. Ao focar um ticket, só sussurra se houver playbook, caso parecido ou um próximo passo derivado do estado. `eng_context` devolve blocos compactos (`CURRENT_STATE` … `NEXT_STEP`), com `[fact]` / `[inference]` / `[knowledge]`. Nada disso sai da máquina.

---

## Ferramentas

Alto nível (use estas). Sem ticket_id, vale o foco da sessão.

| Tool | Faz |
|------|-----|
| `eng_route` | Executa a frase em linguagem natural |
| `eng_context` | Blocos compactos para o modelo: estado, evidência, RCA, tempo, memória, próximo passo |
| `eng_work` | Foco, criar/atualizar, listar, board, status |
| `eng_evidence` | Run, bug ou anexo — não executa teste |
| `eng_investigate` | Hipótese, finding, causa raiz |
| `eng_time` | Estimativa, horas, sessão em minutos, variância |
| `eng_knowledge` | Playbook / busca / “já vimos isso?” |
| `eng_report` | Pacote do ticket, daily, ou snapshot do projeto |

### Aliases (mesmo banco)

### WORK

| Tool | Faz |
|------|-----|
| `work_upsert_project` | Cria/atualiza projeto (`key` vira prefixo: `ATL-1`) |
| `work_list_projects` | Lista projetos |
| `work_upsert_ticket` | Cria/atualiza (`story` / `bug` / `task` / `spike` / `epic`) |
| `work_upsert_task` | Task filha |
| `work_list` | Filtro por projeto, status, tipo, texto |
| `work_board` | Kanban: backlog → todo → doing → review → done |
| `work_get` | Detalhe + tasks |

Status: `backlog` · `todo` · `doing` · `review` · `done`  
Prioridade: `p0` … `p3`  
`external_key` / `external_source` / `external_url` guardam o gancho Jira/GitLab sem puxar API. Tags e `component` alimentam o “já vimos isso?”.

### QA

| Tool | Faz |
|------|-----|
| `qa_record_run` | Evidência de run (`pass` / `fail` / `flaky` / `blocked`) |
| `qa_record_bug` | Bug local + classificação |
| `qa_attach_evidence` | log / screenshot / report / url |
| `qa_list` | Runs, bugs e evidências do ticket |

Rodar a suite continua no **qa-lab-agent**. Histórico Jira corporativo continua no **qa-oracle**.

### TIME

| Tool | Faz |
|------|-----|
| `time_estimate` | Horas previstas |
| `time_log` | Horas reais |
| `time_metrics` | Estimado vs real vs restante vs variância |

### INVESTIGATION

| Tool | Faz |
|------|-----|
| `investigate_open` | Abre RCA (ticket e/ou bug) |
| `investigate_add_finding` | `observation` / `evidence` / `hypothesis` / `decision` |
| `investigate_conclude` | Causa raiz + classificação |
| `investigate_list` | Abertas ou concluídas |

Classificação: `bug` · `flaky` · `infra` · `regression` · `unknown`

### KNOWLEDGE

| Tool | Faz |
|------|-----|
| `knowledge_save` | Playbook, lesson ou pattern |
| `knowledge_search` | Busca no que já foi visto |

### REPORTING

| Tool | Faz |
|------|-----|
| `report_ticket` | Pacote completo de um ticket |
| `report_status` | Snapshot do projeto (N dias) |

---

## Desenvolvimento

```bash
npm install
npm test
npm start
```

Requisito: Node 22+ (`node:sqlite`).

```text
src/
  server.js          MCP stdio
  lib/store.js       SQLite — fonte da verdade
  lib/route.js       linguagem natural → ação
  domains/           eng (alto nível) + aliases work/qa/time/…
```

Banco: `~/.engineering-mcp/engineering.db` (fora do git). Override opcional: `ENGINEERING_MCP_DB`.

---

## Privacidade

- Tickets, bugs e horas ficam no disco local
- Sem Turso, sem sync, sem MCP por URL
- `npm publish` / push no GitHub mandam código, não o banco
