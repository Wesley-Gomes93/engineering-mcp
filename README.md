# Engineering MCP

MCP local de **engenharia**: tickets, evidência de QA e tempo entram; investigação fecha causa raiz; conhecimento fica; reporting sai pronto.

Não substitui o que você já tem:

| MCP | Papel |
|-----|--------|
| **engineering-mcp** (este) | OS de engenharia — work + evidência + tempo + RCA + memória + relatório |
| `qa-lab-agent` | Executa testes, gera spec, autocorrige |
| `qa-oracle` | Logs CI / LambdaTest / Jira histórico |

```text
ENGINEERING MCP
      │
      ├── WORK        tickets · tasks · projects
      ├── QA          testing evidence · bugs · artifacts
      └── TIME        tracking · estimates · metrics
              │
              ▼
        INVESTIGATION
              │
              ▼
          KNOWLEDGE
              │
              ▼
          REPORTING
```

---

## Problema que resolve

Um ticket no Jira, um fail no CI e um apontamento de hora vivem em três lugares. Na hora do status, ninguém monta o pacote.

Este MCP grava o ciclo **no mesmo banco local**:

1. Abre o ticket (WORK)
2. Anexa o fail / bug / screenshot (QA) — sem rodar a suite
3. Lança horas e estimativa (TIME)
4. Investiga até causa raiz (INVESTIGATION)
5. Vira playbook (KNOWLEDGE)
6. `report_ticket` devolve o pacote para handoff, daily ou evidência de carreira

---

## Requisitos

- Node **22+** (`node:sqlite` nativo, igual ao qa-oracle)
- Cliente MCP (Cursor)

---

## Instalação (sem caminho absoluto)

O Cursor **não aponta para a pasta no Desktop**. Ele baixa o pacote — igual ao `qa-lab-agent`. O banco fica em `~/.engineering-mcp/engineering.db`, em qualquer máquina.

### Config no Cursor (`~/.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "engineering": {
      "command": "npx",
      "args": ["-y", "engineering-mcp"]
    }
  }
}
```

Sem `args` com `/Users/...`. Sem `ENGINEERING_MCP_DB`. Recarregue os MCPs.

Isso funciona depois do pacote estar no npm **ou** no GitHub (abaixo). Até publicar, use o atalho local (também sem path no `mcp.json`):

```bash
cd ~/Desktop/engineering-mcp
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

`npm install -g .` coloca o comando no PATH. O `mcp.json` só cita o nome.

---

## Onde hospedar (npm vs GitHub vs nuvem)

| Onde | O que vai pra nuvem | Config no Cursor |
|------|---------------------|------------------|
| **npm** (recomendado) | Só o código, público | `"command": "npx", "args": ["-y", "engineering-mcp"]` |
| **GitHub** | Só o código, público | `"args": ["-y", "github:Wesley-Gomes93/engineering-mcp"]` |
| **Servidor HTTP** | Código **e** os seus tickets | `"url": "https://seu-dominio/mcp"` |

**Não precisa de site próprio.** O “site” é o [npmjs.com](https://www.npmjs.com) — o mesmo do `mcp-lab-agent`. Cursor roda o MCP **na sua máquina**; a nuvem só entrega o código.

Nuvem tipo URL (`"url": "https://..."`) existe no Cursor, mas aí o SQLite deixa de ser local: tickets, bugs e horas passariam a viver num servidor. Isso é produto multi-user, não este v0.

### Publicar no npm (igual o lab-agent)

Nome `engineering-mcp` está livre. Com conta npm já logada:

```bash
cd ~/Desktop/engineering-mcp
npm test
npm publish --access public
```

Depois disso, qualquer Mac usa só o bloco `npx` acima.

### Publicar no GitHub (sem npm)

```bash
cd ~/Desktop/engineering-mcp
git init
git add .
git commit -m "feat: engineering mcp v0.1"
gh repo create Wesley-Gomes93/engineering-mcp --public --source . --remote origin --push
```

Config alternativa, ainda sem path:

```json
{
  "mcpServers": {
    "engineering": {
      "command": "npx",
      "args": ["-y", "github:Wesley-Gomes93/engineering-mcp"]
    }
  }
}
```

Reinicie o Cursor (ou recarregue os MCPs). O banco é criado sozinho em `~/.engineering-mcp/`.

---

## Loop típico

```text
"Abre um projeto Atlas (ATL) e um bug P1: timeout no checkout"
  → work_upsert_project + work_upsert_ticket

"Registra o fail do checkout.spec.js e anexa o log"
  → qa_record_run + qa_attach_evidence

"Estima 4h e lança 1.5h de repro"
  → time_estimate + time_log

"Abre investigação: hipótese de seletor instável"
  → investigate_open + investigate_add_finding

"Fecha como flaky: timing no botão Finalizar"
  → investigate_conclude

"Vira playbook: wait da animação + data-testid"
  → knowledge_save

"Me dá o pacote do ticket"
  → report_ticket
```

Se não souber a tool: `eng_route` com a frase em português.

---

## Ferramentas

### WORK

| Tool | Faz |
|------|-----|
| `work_upsert_project` | Cria/atualiza projeto (`key` vira prefixo: ATL-1) |
| `work_list_projects` | Lista projetos |
| `work_upsert_ticket` | Cria/atualiza ticket (`story/bug/task/spike/epic`) |
| `work_upsert_task` | Task filha |
| `work_list` | Filtro por projeto, status, tipo, texto |
| `work_board` | Kanban: backlog → todo → doing → review → done |
| `work_get` | Detalhe + tasks |

Status: `backlog` · `todo` · `doing` · `review` · `done`  
Prioridade: `p0` … `p3`  
`external_key` guarda a chave Jira/GitLab sem puxar API ainda.

### QA

| Tool | Faz |
|------|-----|
| `qa_record_run` | Evidência de run (`pass/fail/flaky/blocked`) |
| `qa_record_bug` | Bug local + classificação |
| `qa_attach_evidence` | log / screenshot / report / url |
| `qa_list` | Runs + bugs + evidências do ticket |

Executar teste continua no **qa-lab-agent**. Histórico Jira corporativo continua no **qa-oracle**.

### TIME

| Tool | Faz |
|------|-----|
| `time_estimate` | Horas previstas no ticket |
| `time_log` | Horas reais |
| `time_metrics` | Estimado vs real vs restante |

### INVESTIGATION

| Tool | Faz |
|------|-----|
| `investigate_open` | Abre RCA (ticket e/ou bug) |
| `investigate_add_finding` | observation / evidence / hypothesis / decision |
| `investigate_conclude` | Causa raiz + classificação |
| `investigate_list` | Abertas ou concluídas |

Classificação: `bug` · `flaky` · `infra` · `regression` · `unknown`

### KNOWLEDGE

| Tool | Faz |
|------|-----|
| `knowledge_save` | Playbook / lesson / pattern |
| `knowledge_search` | Busca FTS5 ("já vimos isso?") |

### REPORTING

| Tool | Faz |
|------|-----|
| `report_ticket` | Pacote completo de um ticket |
| `report_status` | Snapshot do projeto (N dias) |
| `eng_route` | Qual domínio usar |

---

## Estrutura

```text
engineering-mcp/
├── src/
│   ├── server.js              # MCP stdio
│   ├── lib/store.js           # SQLite — fonte da verdade
│   └── domains/
│       ├── work.js
│       ├── qa.js
│       ├── time.js
│       ├── investigation.js
│       ├── knowledge.js
│       └── reporting.js
└── test/store.test.js
```

Banco padrão: `~/.engineering-mcp/engineering.db` (não viaja com o repo).

Nada sai da máquina além do que o agente já vê no chat. Sem Jira/GitLab no v0 — `external_key` é o gancho para sync depois.

---

## v0 vs depois

**Agora:** banco local, ciclo fechado, Cursor.

**Depois (só se o v0 for usado):**

- Sync Jira → tickets (reusar cliente do qa-oracle)
- Importar run do qa-lab-agent / job do GitLab
- Dashboard HTML do `report_status`

---

## Segurança

- Banco em `~/.engineering-mcp/` (fora do repo)
- Sem tokens no v0
- Publicar no npm/GitHub manda **código**, não tickets
