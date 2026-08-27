# Visão — Engineering MCP

O ciclo de um bug hoje está partido: Jira guarda o ticket, CI guarda o fail, a planilha guarda a hora, o Slack guarda a hipótese, e a daily pede um pacote que ninguém montou.

O **Engineering MCP** é a memória operacional local desse ciclo. O agente no Cursor escreve e lê o mesmo SQLite: work, evidência de QA, tempo, investigação, conhecimento e relatório. Quando alguém pergunta “o que aconteceu nesse ticket?”, a resposta já está junta. Quando alguém diz “Comecei o ATL-1”, a memória fala sozinha: caso parecido, playbook, próximo passo.

Não é um Jira. Não é um runner de testes. Não é um dashboard. Não é um modelo na nuvem. O Cursor é o cérebro (online). Este MCP é o que o cérebro consulta **enquanto você trabalha**, para o contexto não se perder entre ferramentas.

---

## Inteligente e online — o que isso significa aqui

| Papel | Quem |
|--------|------|
| Pensar, falar português, decidir | Cursor (modelo online) |
| Lembrar o *seu* ciclo, no *seu* disco | engineering-mcp (SQLite local) |
| Rodar a suite | qa-lab-agent |
| Puxar CI / Jira da empresa | qa-oracle |

Inteligência neste produto não é “mais um chat na internet”. É recall na hora certa — e silêncio quando não há sinal. `eng_context` alimenta o modelo com blocos curtos (`CURRENT_STATE`, `EVIDENCE`, `INVESTIGATION`, `TIME`, `RELATED_MEMORY`, `NEXT_STEP`), cada linha marcada como fato, inferência ou conhecimento.

Online, neste produto, é o agente. npm publica **código**. O banco (`~/.engineering-mcp/engineering.db`) não viaja. Telemetria, sync Jira e MCP por URL não fazem parte do v0.

---

## Por que existe

Três MCPs, três papéis, sem overlap:

| Camada | Responsabilidade |
|--------|------------------|
| **qa-lab-agent** | Executa. Gera spec, roda suite, tenta corrigir. |
| **qa-oracle** | Histórico corporativo. CI, LambdaTest, Jira da empresa. |
| **engineering-mcp** | Memória do ciclo. O que *este* time fez *neste* turno, com evidência e causa raiz. |

O lab-agent não precisa saber de apontamento. O oracle não precisa ser a fonte da verdade do seu dia. Este MCP não puxa a API do Jira: `external_key` / `external_source` / `external_url` são o gancho para quando o sync fizer sentido.

---

## O produto

Um SQLite na máquina. Tools de alto nível (`eng_route`, `eng_context`, `eng_work`, `eng_evidence`, `eng_investigate`, `eng_time`, `eng_knowledge`, `eng_report`). O humano fala em português; `eng_route` **executa**. As tools `work_*` / `qa_*` / … continuam como aliases no mesmo banco.

O fluxo que o produto defende:

1. A pessoa diz o que está fazendo — com ID (`Comecei o ATL-1`) ou sem (`Comecei um bug: timeout no checkout`). Banco vazio cria projeto e ticket.
2. Anexa o que o teste mostrou (run, bug, log, screenshot) — **sem** rodar a suite.
3. Lança sessão (minutos) e estimativa vs real (variância).
4. Investiga até causa raiz, com findings no caminho.
5. A conclusão vira playbook; o que se repete vira lição sozinho.
6. Tira o pacote (`eng_context`) ou a daily (`eng_report`) — handoff, standup, evidência de carreira.

Fails da mesma família, RCA sem playbook e hora acima da estimativa viram lesson/pattern sem o usuário pedir “aprende isso”. Pattern que volta abre um ticket `Melhoria: …`. Nada disso exige nuvem, painel ou passo extra de setup.

---

## Princípios

**Local first.** Tickets, bugs e horas ficam no disco de quem usa. Publicar é código.

**Um lugar, um ciclo.** Status, evidência e tempo do mesmo ticket não podem viver em três abas.

**Não duplicar os outros MCPs.** Execução de teste → lab-agent. Log/Jira da empresa → oracle. Aqui entra evidência *depois* do fato, e o OS em volta.

**Agente como interface.** O usuário não memoriza o catálogo. A frase vira ação. O MCP fala de volta só o que falta (próximo passo, já vimos, playbook).

**Melhoria no uso, não num painel.** Aprendizado vira playbook, ticket de melhoria e roteamento melhor. Não vira telemetria visível.

**Instalar é um bloco JSON.** `npx engineering-mcp`. Sem path absoluto, sem servidor próprio para o v0.

---

## O que não é (ainda)

- Sync Jira/GitLab (só a chave externa).
- Import automático de job do GitLab ou run do lab-agent.
- Banco compartilhado entre máquinas, embeddings, ou MCP por URL.
- Multi-usuário com ACL, dashboard HTML.
- Processo 24/7 com o Cursor fechado. O OS vive na sessão do agente.

Esses itens só entram se o v0 for *usado*. Visão não é backlog inflado. Cérebro compartilhado na nuvem é outro produto: se entrar, o SQLite local continua sendo a fonte da verdade desta máquina.

---

## Norte

O Engineering MCP é o lugar onde o engenheiro prova o que fez: o ticket, o fail, a hora, a causa, a lição. O agente fica mais rápido nas dores que já viu. A daily sai pronta.

A medida de sucesso não é número de tools. É: alguém diz “Comecei o ATL-1”, “o que aconteceu?” ou “me prepara para a daily” — e a memória responde completa, local, sem caçar print no Slack.
