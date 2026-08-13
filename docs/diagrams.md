# Homebase diagrams

Canonical UML, ERD, data-flow, and sequence diagrams for Homebase. These render on
GitHub and are also surfaced in the app's **Docs → Diagrams** tab (parsed from this
file). Keep them in sync with the code; every identifier here is a placeholder.

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
      end
      VPCE["Interface endpoint<br/>bedrock-agentcore"]
      WS --> NAT
      CLI --> NAT
      NAT --> IGW
    end

    subgraph ac["Bedrock AgentCore"]
      RT["Runtime · agent"]
      MEM["Memory"]
      IDV["Identity · OAuth vault"]
    end
    subgraph br["Amazon Bedrock"]
      Claude["Claude · inference profile"]
      Rerank["Cohere Rerank"]
      Titan["Titan Embeddings"]
    end
    KB["Knowledge Base"] --> S3V["Amazon S3 Vectors"]
    Shims["Lambda connector shims x6"]

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
    end
  end

  BFF --> RT
  BFF --> SM
  RT --> Claude
  RT --> MEM
  RT --> KB
  KB --> Rerank
  KB --> Titan
  KB --> S3c
  RT -->|"lambda:InvokeFunction"| Shims
  Shims --> IDV
  IDV --> SM
  Shims --> Vendors([Vendor APIs])
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
    RT->>LLM: converse_stream(messages, tools)
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
