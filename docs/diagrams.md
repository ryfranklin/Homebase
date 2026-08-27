# Homebase diagrams

Canonical UML, ERD, data-flow, and sequence diagrams for Homebase. These render on
GitHub and in the app's **Docs** surface (rendered natively from this file). Keep
them in sync with the code; every identifier here is a placeholder.

---

## Data model (ERD)

Tenant and user identity are explicit on every record, so the single-tenant seed is
multi-tenant ready. Secrets (OAuth tokens, client credentials) are never modeled as
stored fields; they live in AWS Secrets Manager / the AgentCore Identity vault.

```mermaid
erDiagram
  TENANT ||--o{ USER : has
  USER ||--o{ SESSION : starts
  SESSION ||--o{ MESSAGE : contains
  SESSION ||--o{ MEMORY_EVENT : records
  MESSAGE ||--o{ CITATION : cites
  TENANT ||--o{ CONNECTOR_TOKEN : owns
  CONNECTOR ||--o{ CONNECTOR_TOKEN : issues
  DOCUMENT ||--o{ PASSAGE : chunked_into
  PASSAGE ||--o{ CITATION : referenced_by

  TENANT {
    string tenant_id PK "seed = homebase"
  }
  USER {
    string sub PK "Cognito subject"
    string tenant_id FK
    string email
  }
  SESSION {
    string session_id PK "web-<uuid> per page load"
    string user_id FK
    string tenant_id FK
  }
  MESSAGE {
    string id PK
    string session_id FK
    string role "user | assistant"
    string text
  }
  CITATION {
    string source_path
    float score
  }
  MEMORY_EVENT {
    string event_id PK
    string actor_id "namespaced by tenant"
    string session_id FK
    string role "USER | ASSISTANT"
    datetime event_ts
  }
  DOCUMENT {
    string source_path PK
    string tenant_id
  }
  PASSAGE {
    string id PK
    string source_path FK
    string text
    string fm_tags "metadata"
    string fm_updated "metadata"
  }
  CONNECTOR {
    string name PK "gmail, slack, jira ..."
    string vendor
    string read_tool
  }
  CONNECTOR_TOKEN {
    string tenant_id FK
    string connector FK
    string scopes "vaulted token, not in model"
  }
```

---

## AWS services and network topology

One region, one account. CloudFront (WAF + origin secret) is the only public ingress.
The BFF and shim Lambdas are not VPC-attached; the VPC carries the workstation, the
CLI, and an AgentCore interface endpoint, with private subnets that have no inbound
and egress only through a stoppable NAT.

```mermaid
flowchart TB
  Users([Internet · users])

  subgraph edge["Edge (global)"]
    CF["CloudFront + WAF"]
  end
  Cognito["Cognito User Pool<br/>Google federation"]

  Users --> CF
  CF -->|"default · OAC"| S3web["S3 · SPA static (private)"]
  CF -->|"/api/* · X-Origin-Secret"| BFF["Lambda BFF<br/>Function URL · SSE"]
  CF -.->|"JWT verified in BFF"| Cognito

  subgraph region["AWS Region · single account"]
    subgraph vpc["VPC · no inbound"]
      IGW["Internet Gateway"]
      subgraph pubs["Public subnet"]
        NAT["NAT instance<br/>(stoppable)"]
      end
      subgraph privs["Private subnets"]
        WS["EC2 workstation<br/>no public IP"]
        CLI["Fargate chat CLI<br/>ECS Exec only"]
        SLACK["Fargate Slack bridge<br/>Socket Mode, no inbound"]
      end
      VPCE["Interface endpoint<br/>bedrock-agentcore"]
      WS --> NAT
      CLI --> NAT
      SLACK --> NAT
      NAT --> IGW
    end

    subgraph ac["Bedrock AgentCore"]
      RT["Runtime · agent"]
      MEM["Memory"]
      IDV["Identity · OAuth vault"]
    end
    subgraph br["Amazon Bedrock"]
      Claude["Claude · inference profile"]
      Guardrail["Guardrail · on every Converse call"]
      Rerank["Cohere Rerank"]
      Titan["Titan Embeddings"]
    end
    KB["Knowledge Base"] --> S3V["Amazon S3 Vectors"]
    Shims["Lambda connector shims x6<br/>(per-user OAuth)"]
    WebShim["Web shim (Tavily)<br/>API key · minimal role · optional"]

    subgraph state["State & security"]
      S3c["S3 corpus · KMS"]
      SM["Secrets Manager"]
      SSMP["SSM Parameter Store"]
      KMS["KMS CMKs · per stack"]
    end
    subgraph ops["Access & ops"]
      SSM["SSM · Session Manager / ECS Exec"]
      CW["CloudWatch · logs · alarms"]
      SNS["SNS · budget / alarms"]
      CT["CloudTrail · multi-region<br/>KMS'd, locked bucket"]
      FL["VPC flow logs"]
    end
  end

  BFF --> RT
  BFF --> SM
  SLACK -->|"InvokeAgentRuntime (task role)"| RT
  SLACK --> SM
  RT -->|"Converse + Guardrail"| Claude
  Claude -. applies .- Guardrail
  RT --> MEM
  RT --> KB
  KB --> Rerank
  KB --> Titan
  KB --> S3c
  RT -->|"lambda:InvokeFunction"| Shims
  Shims --> IDV
  IDV --> SM
  Shims --> Vendors([Vendor APIs])
  RT -->|"lambda:InvokeFunction"| WebShim
  WebShim --> SM
  WebShim --> Tavily([Tavily API · search + extract])
  SSM -.->|"no SSH"| WS
  SSM -.-> CLI
  CW --> SNS
```

---

## Components (UML component diagram)

The four deployables and their internal modules. Arrows are call/dependency
direction. The agent reaches connectors by invoking their shim Lambdas directly
(it holds the tenant, not a Cognito JWT); the Gateway also exposes them as MCP.

```mermaid
flowchart LR
  subgraph web["web · React SPA"]
    App --> useAuth
    App --> useChat
    App --> ChatView
    App --> ReauthBanner["ConnectorReauthBanner<br/>(non-blocking, separate-window re-consent)"]
    ChatView --> DocsOverlay
    ChatView --> ConnectorBanner
    useChat --> sseClient
  end

  subgraph bff["bff · streaming Lambda"]
    handler --> bffcore["bff (route + auth)"]
    bffcore --> agentClient["agent (InvokeAgentRuntime)"]
    bffcore --> identity["identity (CompleteResourceTokenAuth, SigV4)"]
    bffcore --> jwt["jwt / jwks"]
    bffcore --> secrets
  end

  subgraph agent["agent · AgentCore Runtime"]
    server --> Agent
    Agent --> RetrievalTool
    Agent --> ConnectorClient
    Agent --> BedrockLLM["BedrockLLMClient (converse / converse_stream)"]
    Agent --> Memory["AgentCoreMemory"]
    Agent --> toolloop["run_tool_loop / _stream"]
  end

  subgraph conn["connectors · shim Lambdas"]
    chandler["handler"] --> gate["write gate"]
    gate --> shim["ConnectorShim"]
    shim --> capi["api (vendor REST)"]
    shim --> cidentity["lambda_identity (get token)"]
  end

  sseClient -- "SSE /api/chat" --> handler
  DocsOverlay -. "/architecture.html /diagrams.md" .-> web
  agentClient -- "InvokeAgentRuntime (SSE)" --> server
  identity -- "vault finalize" --> cidentity
  ConnectorClient -- "lambda:InvokeFunction" --> chandler
  RetrievalTool --> KB["Bedrock KB · S3 Vectors"]
  capi --> vendors["Gmail · GCal · Drive · Slack · Jira · Confluence"]
  capi --> web2["Web search · Tavily (api key, no OAuth)"]
```

---

## Agent domain (UML class diagram)

The agent's core types. `answer` is the single-shot RAG path; `answer_stream`
drives the streaming tool loop when connectors are configured.

```mermaid
classDiagram
  class Agent {
    +answer(session, question) AnswerResult
    +answer_stream(session, question) Iterator
    +supports_streaming() bool
    -_make_execute(session, question) callable
  }
  class RetrievalTool {
    +retrieve(query, top_k, rerank) Passage[]
  }
  class ConnectorClient {
    +tool_specs() dict[]
    +call(tool_name, args, tenant_id) dict
  }
  class BedrockLLMClient {
    +converse_with_tools(system, messages, tools) dict
    +converse_with_tools_stream(...) Iterator
  }
  class AgentCoreMemory {
    +record_turn(session, role, text)
    +recall(session, query) str[]
  }
  class AnswerResult {
    +text: str
    +grounded: bool
    +citations: Citation[]
    +authorization_url: str
  }
  class Outcome {
    +result: dict
    +citations: Citation[]
    +authorization_url: str
  }
  class Citation {
    +source_path: str
    +score: float
  }

  Agent --> RetrievalTool
  Agent --> ConnectorClient
  Agent --> BedrockLLMClient
  Agent --> AgentCoreMemory
  Agent ..> AnswerResult : returns
  Agent ..> Outcome : per tool call
  AnswerResult o-- Citation
  Outcome o-- Citation
```

---

## Data flow (DFD)

One question, from keystroke to streamed answer. The tool loop chooses between
knowledge-base search and the live connectors; results feed back into Claude,
which streams the answer token by token.

```mermaid
flowchart TB
  U([User]) -->|"question + bearer + session_id"| SPA[Web SPA]
  SPA -->|"POST /api/chat (SSE)"| CF[CloudFront + WAF]
  CF -->|"+ X-Origin-Secret"| BFF[Streaming BFF]
  BFF -->|"verify JWT · resolve tenant"| RT[AgentCore Runtime]
  RT --> LOOP{tool-use loop}
  LOOP -->|search_knowledge_base| KB[Bedrock KB · S3 Vectors]
  KB -->|over-retrieve| RR[Bedrock Rerank]
  RR -->|cited passages| LOOP
  LOOP -->|connector read tool| SH[Shim Lambda]
  SH -->|tenant OAuth token| ID[AgentCore Identity vault]
  SH -->|REST| V[Vendor API]
  V -->|records| LOOP
  LOOP -->|web_search / web_fetch| WSH[Web shim · Tavily]
  WSH -->|api key from Secrets Manager| WV[Tavily API · server-side extract]
  WV -->|results| LOOP
  LOOP -->|converse_stream tokens| RT
  RT -->|SSE| BFF
  BFF -->|SSE relay| CF
  CF -->|token / citation events| SPA
  SPA -->|render live| U
```

---

## Sequence: streaming chat request

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant SPA as Web SPA
  participant CF as CloudFront/WAF
  participant BFF as Streaming BFF
  participant RT as AgentCore Runtime
  participant LLM as Claude (Bedrock)
  participant T as Tool (KB / connector)

  U->>SPA: ask
  SPA->>CF: POST /api/chat (bearer, session_id)
  CF->>BFF: forward + X-Origin-Secret
  BFF->>BFF: verify Cognito JWT, resolve tenant
  BFF-->>SPA: SSE open (keepalives)
  BFF->>RT: InvokeAgentRuntime (SSE)
  loop until no tool call
    RT->>LLM: converse_stream(messages, tools, guardrail)
    Note over LLM: Bedrock Guardrail screens input + output
    LLM-->>RT: text deltas (streamed)
    RT-->>SPA: token events
    LLM-->>RT: tool_use
    RT->>T: execute tool
    T-->>RT: result (+ citations)
    RT-->>SPA: citation events
  end
  RT-->>SPA: done
  SPA-->>U: rendered answer
```

---

## Sequence: connector linking (3LO, self-service)

The first time a tenant uses a connector, the agent returns a consent link; after
the browser round-trip the GUI finalizes the session and the token is vaulted, so
every later read is headless.

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant SPA as Web SPA
  participant BFF as BFF
  participant AC as AgentCore Identity
  participant V as Vendor OAuth

  Note over SPA,AC: agent tool returned requires_authorization
  SPA-->>U: show consent link
  U->>AC: open authorize URL
  AC->>V: OAuth 3LO (scopes)
  V-->>AC: redirect with code
  AC-->>SPA: return to app with ?session_id
  SPA->>BFF: POST /api/connectors/complete (session_id)
  BFF->>AC: CompleteResourceTokenAuth (SigV4, tenant)
  AC-->>BFF: ok (token vaulted)
  BFF-->>SPA: ok
  Note over SPA,AC: future reads fetch the vaulted token, no user prompt
```

---

## Sequence: Slack front door

Homebase is one brain behind multiple front doors (Vault, Chat, Plan, Mission, and
Slack). The Slack bridge runs Socket Mode (an outbound WebSocket, no inbound), resolves
the Slack user's verified email, gates on a by-hand allow-list, then invokes the same
agent runtime with that identity (the ssh-chat task-role pattern) and answers in a thread.

```mermaid
sequenceDiagram
  autonumber
  actor U as Slack user
  participant SL as Slack
  participant SB as Slack bridge (Fargate)
  participant RT as AgentCore Runtime
  participant AL as SSM allow-list

  U->>SL: app_mention / DM
  SL-->>SB: event (outbound WebSocket)
  SB->>SL: resolve user's verified email
  SB->>AL: check /homebase/{env}/slackbot/allowed-emails
  AL-->>SB: allowed
  SB->>RT: InvokeAgentRuntime (task-role identity)
  Note over RT: Bedrock Guardrail on every model call
  RT-->>SB: answer (+ sources / auth link)
  SB->>SL: post in thread
  SL-->>U: reply
```

---

## Sequence: plan to execution (verify + gate)

A Flight Plan carries acceptance criteria per unit. The BFF maps each unit to a
Mission Control run and sends its criteria as `acceptance_criteria`. Mission Control's
state machine runs `dispatch -> run_worker -> verify -> gate -> apply_burn | teardown`:
the `verify` node runs the target repo's own tests/build plus a judged acceptance pass,
and can only ADD a block, never flip a no-go to a go. Builds land on a git remote (each
project's own target repo), not S3.

```mermaid
flowchart LR
  FP["Flight Planner<br/>per-unit acceptance criteria"] --> BFF["BFF /api/missions/runs"]
  BFF -->|"POST /runs + acceptance_criteria"| DISP["dispatch"]
  DISP --> RUN["run_worker<br/>coding agent in worktree"]
  RUN --> VER["verify<br/>tests/build + AC judge per unit"]
  VER --> GATE{"go/no-go gate"}
  GATE -->|approve| APPLY["apply_burn<br/>push to git remote"]
  GATE -->|reject| TEAR["teardown"]
  VER -. "red build auto-blocks;<br/>unverified still needs human" .-> GATE
```

---

## Sequence: vault mirror (git to S3 to KB)

Git is the source of truth for the vault. The vault-worker owns the one clone: GUI,
CLI, and workstation-cockpit writes commit through it, and a poll loop picks up
external commits (for example a push from the cockpit). It mirrors to the corpus S3
bucket and triggers a Knowledge Base reingest ONLY when git actually moved, and then
only for the changed files, so an idle vault does no S3 writes. That is what keeps the
versioned corpus bucket from accumulating noncurrent-version churn.

```mermaid
sequenceDiagram
  autonumber
  participant U as GUI / CLI / Cockpit
  participant BFF as BFF
  participant W as vault-worker (Fargate)
  participant Git as homebase-vault (git)
  participant S3 as Corpus S3 (KMS)
  participant KB as Bedrock KB (S3 Vectors)

  Note over U,KB: Write path (a note edit)
  U->>BFF: PUT /api/vault/note
  BFF->>W: POST /write {path, content, author}
  W->>Git: commit + push (author-attributed)
  W->>S3: put the changed object
  W->>KB: StartIngestionJob (best-effort)

  Note over W,KB: Poll loop (external commits)
  loop every pullIntervalMs
    W->>Git: fetch + rebase
    alt HEAD unchanged
      W-->>W: no-op (no S3 write, no reingest)
    else HEAD moved
      W->>Git: diff (changed vs deleted)
      W->>S3: put changed / delete removed (only the diff)
      W->>KB: StartIngestionJob
    end
  end

  Note over S3,KB: Read path
  KB->>S3: index + serve at query time (the agent grounds here)
```
