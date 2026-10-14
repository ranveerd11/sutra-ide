# Sovereign Architecture: Analysis of Cloud Dependencies & Local Replication Plan

## Executive Summary

The initial inspection of the codebase revealed that the upstream IDE (AINative Studio) was architected as a hybrid SaaS desktop client with heavy centralized dependencies on `https://api.ainative.studio`. While it presented itself as an AI-powered code editor, several core capabilities—user authentication, credit metering, LLM completions, project indexing ("ZeroDB"), and community skills—were channeled through remote cloud microservices.

Our reverse-engineering investigation (via REA runtime bundle analysis, static source tracing, and live HTTP probing) determined that:
1. **"ZeroDB" is not a proprietary black-box AI**: It is a multi-tenant PostgreSQL 16 database running `pgvector` hosted on Railway Hikari (`postgres.railway.internal:5432`) with ephemeral schema generation (`instant-db`) and `BAAI/bge-small-en-v1.5` embeddings.
2. **Commercial Gating vs Core Need**: Many cloud endpoints exist solely to enforce a $49/month SaaS billing model (50 credits/op) and centralized API proxying rather than providing functionality that inherently requires the cloud.
3. **Feasibility of 100% Local Sovereign Independence**: Every single one of these cloud services can be cleanly replaced or replicated locally using in-process SQLite databases, native OS credential vaults, direct BYOK/Ollama inference, and decentralized Git manifests—with zero loss of developer functionality and massive performance gains (sub-2ms local vector search vs 250ms+ cloud HTTP latency).

---

## 1. Complete Inventory of Cloud Endpoints & Base URLs

Across the codebase, 11 distinct subsystems communicate with external networks and base URLs:

```mermaid
flowchart TD
    subgraph Client["Sutra IDE Client Subsystems"]
        AUTH["Auth & Session Manager"]
        OAUTH["GitHub OAuth Handler"]
        CHAT["Managed Chat Service"]
        USAGE["Credits & Usage Metering"]
        BOOT["Cloud Bootstrap Service"]
        MEM["Agent Memory Service"]
        CTX["Code Context Engine"]
        MKT["Community Skills Marketplace"]
        EXT["Extension Gallery"]
        UPD["Auto-Update Service"]
        METRICS["Telemetry & Metrics"]
        DOCS["Web Fetch Tool"]
    end

    subgraph Cloud["External Cloud Services"]
        AIN_AUTH["api.ainative.studio/api/v1/auth/*"]
        AIN_OAUTH["api.ainative.studio/v1/auth/github/callback"]
        AIN_CHAT["api.ainative.studio/api/v1/managed/chat/completions"]
        AIN_USAGE["api.ainative.studio/api/v1/managed/usage*"]
        AIN_BOOT["api.ainative.studio/api/v1/cli/bootstrap"]
        AIN_MEM["api.ainative.studio/v1/memory/*"]
        AIN_ZDB["api.ainative.studio/api/v1/zerodb/projects/ensure"]
        AIN_MKT["api.ainative.studio/v1/skills/marketplace/*"]
        OPEN_VSX["open-vsx.org/vscode/*"]
        GH_REL["api.github.com/repos/.../releases"]
        POSTHOG["us.i.posthog.com"]
        WEB_DOCS["Trusted Docs (docs.python.org, MDN, etc.)"]
    end

    AUTH -.-> AIN_AUTH
    OAUTH -.-> AIN_OAUTH
    CHAT -.-> AIN_CHAT
    USAGE -.-> AIN_USAGE
    BOOT -.-> AIN_BOOT
    MEM -.-> AIN_MEM
    CTX -.-> AIN_ZDB
    MKT -.-> AIN_MKT
    EXT -.-> OPEN_VSX
    UPD -.-> GH_REL
    METRICS -.-> POSTHOG
    DOCS -.-> WEB_DOCS
```

---

## 2. In-Depth Subsystem Technical Analysis

### Subsystem 1: Authentication & User Accounts
- **Target Endpoints**:
  - `POST https://api.ainative.studio/api/v1/auth/register`
  - `POST https://api.ainative.studio/api/v1/auth/login`
  - `POST https://api.ainative.studio/v1/auth/refresh`
  - `POST https://api.ainative.studio/v1/auth/logout`
  - `GET  https://api.ainative.studio/v1/auth/me`
  - `POST https://api.ainative.studio/v1/auth/forgot-password`
  - `POST https://api.ainative.studio/v1/auth/reset-password`
  - `POST https://api.ainative.studio/v1/auth/verify-token`
- **Source Locations**:
  - `src/vs/workbench/contrib/ainative/common/ainativeAuthService.ts`
  - `src/vs/workbench/contrib/ainative/common/ainativeSDKClient.ts`
  - `src/vs/workbench/contrib/ainative/common/ainativeCloudAuthService.ts`
- **Actual Technical Purpose**:
  - Enforces user identity, email verification, and issues JWT Bearer tokens with 15-minute expiration and 30-day refresh tokens.
  - Links local IDE activity to an account on `api.ainative.studio` for subscription entitlement check.
- **Breakage Impact**:
  - **High (in legacy cloud mode)**: If cloud is down or unreachable, sign-in dialog crashes with 401/NetworkError, preventing account access.
  - **Zero in BYOK mode**: Setting `byokMode: true` bypasses login completely.

---

### Subsystem 2: GitHub OAuth Intermediary
- **Target Endpoints**:
  - `GET  https://github.com/login/oauth/authorize` (Client ID: `Ov23liU7x20VoRInkAiq`)
  - `POST https://api.ainative.studio/v1/auth/github/callback`
- **Source Location**:
  - `src/vs/workbench/contrib/ainative/common/githubOAuthService.ts`
- **Actual Technical Purpose**:
  - The IDE initiates OAuth via browser URL redirect `ainative://auth/github/callback`.
  - Because a desktop app cannot safely store the GitHub Client Secret, it posts the authorization `code` to `api.ainative.studio`, which exchanges it for a GitHub token and issues an AINative JWT.
- **Breakage Impact**:
  - **High for OAuth login**: If `api.ainative.studio` is down, GitHub login in the IDE fails.
  - **Zero for Developer Git Operations**: Standard VS Code Git features use local SSH keys or the system `git` CLI credential helper, completely independent of this service.

---

### Subsystem 3: Managed Chat Completion Gateway & Model Proxy
- **Target Endpoints**:
  - `POST https://api.ainative.studio/api/v1/managed/chat/completions`
  - `POST https://api.ainative.studio/api/v1/chat/completions` (OpenAI compatible, `X-API-Key`)
  - `GET  https://api.ainative.studio/api/v1/managed/models`
- **Source Locations**:
  - `src/vs/workbench/contrib/ainative/common/managedChatAPIService.ts`
  - `src/vs/workbench/contrib/ainative/electron-main/llmMessage/providers/ainativeCloudProvider.ts`
- **Actual Technical Purpose**:
  - Acts as a reverse-proxy gateway forwarding prompts to upstream providers (Anthropic Claude 3.5 Sonnet, OpenAI GPT-4o, Groq LLaMA, Cerebras).
  - Inspects user credits on every request, deducts 50 credits per run, and rejects requests with HTTP 402 if credits reach 0.
- **Breakage Impact**:
  - **Total for managed chat users**: No AI completions can be generated through the managed route.
  - **Zero for Direct Providers**: When users configure their own keys (Anthropic, OpenAI, DeepSeek, Gemini, Ollama, LM Studio), requests bypass this gateway entirely.

---

### Subsystem 4: Credit Billing, Quota & Usage Tracking
- **Target Endpoints**:
  - `GET  https://api.ainative.studio/api/v1/managed/usage`
  - `GET  https://api.ainative.studio/api/v1/managed/usage/history?days=30`
  - `GET  https://api.ainative.studio/api/v1/public/credits/balance`
  - `POST https://api.ainative.studio/api/v1/managed/estimate`
- **Source Locations**:
  - `src/vs/workbench/contrib/ainative/common/usageTrackingService.ts`
  - `src/vs/workbench/contrib/ainative/common/managedChatAPIService.ts`
- **Actual Technical Purpose**:
  - Renders the credit balance pill in the status bar and powers the usage charts in settings.
  - Pre-flight estimation: calculates expected token cost before executing prompt iterations.
- **Breakage Impact**:
  - **Low / Cosmetic**: Status bar shows disconnected credit icon; settings usage tab shows network error.

---

### Subsystem 5: CLI / IDE Provider Bootstrap
- **Target Endpoint**:
  - `GET https://api.ainative.studio/api/v1/cli/bootstrap`
- **Source Locations**:
  - `src/vs/workbench/contrib/ainative/common/cloudBootstrapService.ts`
  - `src/vs/workbench/contrib/ainative/browser/cloudBootstrapContribution.ts`
- **Actual Technical Purpose**:
  - Upon user login, fetches pre-provisioned shared provider API keys from the server and injects them into `ainativeSettingsService` so the user doesn't need to manually configure API keys.
- **Breakage Impact**:
  - **Medium**: If offline, initial automated key injection fails; user must supply their own API keys.

---

### Subsystem 6: ZeroDB / Remote Vector Memory & Knowledge Graph
- **Target Endpoints**:
  - `POST https://api.ainative.studio/v1/memory/store`
  - `POST https://api.ainative.studio/v1/memory/search`
  - `GET  https://api.ainative.studio/v1/memory/context?session_id=...`
  - `POST https://api.ainative.studio/api/v1/zerodb/projects/ensure`
  - `POST https://api.ainative.studio/api/v1/public/instant-db`
- **Source Locations**:
  - `src/vs/workbench/contrib/ainative/common/agentMemoryService.ts`
  - `src/vs/workbench/contrib/ainative/common/codeContextProjectHash.ts`
- **Backend Architecture Uncovered via Live REA & Curl Probing**:
  - Probing `POST /api/v1/public/instant-db` returns:
    `Server: railway-hikari`, `x-zerodb-version: 2.0`, connecting to PostgreSQL internal pool (`postgres.railway.internal:5432`).
  - Remote indexing pipeline:
    1. Computes SHA256 repo hash of git remote.
    2. Sends code chunks to remote backend.
    3. Backend runs embedding model (`BAAI/bge-small-en-v1.5`, 384 dimensions).
    4. Stores vectors in PostgreSQL pgvector table.
- **Breakage Impact**:
  - **High (in legacy setup)**: Agent memory search fails; codebase context search fails if offline.
  - **Phase 2 Status**: We implemented `LocalVectorStore` and `CodeContextEngineService` which store vectors in local SQLite (`.sutra/index.db`), rendering ZeroDB obsolete.

---

### Subsystem 7: Community Skills Marketplace
- **Target Endpoints**:
  - `GET  https://api.ainative.studio/v1/skills/marketplace`
  - `GET  https://api.ainative.studio/v1/skills/marketplace/search?q=...`
  - `GET  https://api.ainative.studio/v1/skills/marketplace/{skillName}`
  - `POST https://api.ainative.studio/v1/skills/marketplace` (submit skill zip)
  - `POST https://api.ainative.studio/v1/skills/marketplace/{id}/rate`
- **Source Location**:
  - `src/vs/workbench/contrib/ainative/common/marketplace/communityMarketplace.ts`
- **Actual Technical Purpose**:
  - Centralized discovery and download catalog for custom agent prompts and skill bundles.
  - Uploads user-authored skills as multipart ZIP files.
- **Breakage Impact**:
  - **Low**: Browsing community skills fails; local built-in skills and skills already installed in `~/.sutra/skills` continue working normally.

---

### Subsystem 8: Extension Gallery
- **Target Endpoints**:
  - `https://open-vsx.org/vscode/gallery`
  - `https://open-vsx.org/vscode/item`
  - `https://open-vsx.org/vscode/unpkg/{publisher}/{name}/{version}/{path}`
- **Source Location**:
  - `product.json`
- **Actual Technical Purpose**:
  - Open-source alternative to Microsoft VS Code Marketplace. Allows downloading language tools, linters, and themes.
- **Breakage Impact**:
  - **Medium**: New extensions cannot be searched or downloaded while offline. Installed extensions run normally.

---

### Subsystem 9: Desktop Auto-Update Service
- **Target Endpoint**:
  - `GET https://api.github.com/repos/AINative-Studio/binaries/releases/latest`
- **Source Location**:
  - `src/vs/workbench/contrib/ainative/electron-main/ainativeUpdateMainService.ts`
- **Actual Technical Purpose**:
  - Polls GitHub releases tag to compare current installed version with the latest published desktop binary.
- **Breakage Impact**:
  - **Low**: Silent failure; user continues working without interruption.

---

### Subsystem 10: Telemetry & Product Analytics
- **Target Endpoint**:
  - `https://us.i.posthog.com`
- **Source Location**:
  - `src/vs/workbench/contrib/ainative/electron-main/metricsMainService.ts`
- **Actual Technical Purpose**:
  - Product metrics tracking, retention analysis, feature usage tracking.
- **Breakage Impact**:
  - **Zero**: Already fully gated behind `SUTRA_POSTHOG_KEY`. If unset, the PostHog client is never created.

---

### Subsystem 11: Web Fetch Documentation Gateway
- **Target Endpoints**:
  - Whitelist of 60+ domains (`docs.python.org`, `developer.mozilla.org`, `react.dev`, `nodejs.org`, `numpy.org`, etc.)
- **Source Location**:
  - `src/vs/workbench/contrib/ainative/common/webFetchService.ts`
- **Actual Technical Purpose**:
  - Allows autonomous agents to retrieve live technical documentation and convert HTML to markdown.
- **Breakage Impact**:
  - **Low**: Only fails if user asks agent to fetch online documentation while disconnected from the internet.

---

## 3. Sovereign Architecture: Local Replication Blueprint

To achieve 100% independence from `api.ainative.studio` and external SaaS servers, we replace the centralized cloud dependencies with sovereign local implementations:

```mermaid
flowchart LR
    subgraph CloudDep["Legacy Cloud Architecture"]
        direction TB
        C1["Remote Auth API<br>(api.ainative.studio)"]
        C2["Credit Billing & Usage<br>(api.ainative.studio/usage)"]
        C3["ZeroDB Remote Embeddings<br>(Postgres/pgvector on Railway)"]
        C4["Remote Agent Memory<br>(api.ainative.studio/v1/memory)"]
        C5["Proprietary Skill Catalog<br>(api.ainative.studio/marketplace)"]
        C6["Old Binary Updates<br>(AINative-Studio/binaries)"]
    end

    subgraph SovereignDep["Sutra Sovereign Architecture"]
        direction TB
        S1["Local Master Vault & BYOK<br>(VS Code SecretStorage / Keytar)"]
        S2["In-Process Token Ledger<br>(SQLite .sutra/usage.db)"]
        S3["Local Hybrid Vector Store<br>(SQLite FTS5 + Dense Embeddings)"]
        S4["Local Agent Memory Store<br>(SQLite .sutra/agent_memory.db)"]
        S5["Decentralized Git Skills<br>(GitHub Raw / Git Submodules)"]
        S6["Independent Releases<br>(ranveerd11/sutra-ide)"]
    end

    C1 ==>|Replaced by| S1
    C2 ==>|Replaced by| S2
    C3 ==>|Replaced by| S3
    C4 ==>|Replaced by| S4
    C5 ==>|Replaced by| S5
    C6 ==>|Replaced by| S6
```

---

### Detailed Replacement Plan by Subsystem

#### 1. Identity & Auth: Sovereign Zero-Account Mode
- **Current State**: Requires account creation on `api.ainative.studio`, JWT refresh loop, email validation.
- **Sovereign Replacement**:
  - **Remove Cloud Requirement**: Make authentication strictly optional or disabled by default (`byokMode = true`).
  - **Master Credential Vault**: Store provider API keys (Anthropic, OpenAI, DeepSeek, Google, OpenRouter) securely in the OS keychain via VS Code's `ISecretStorageService` (`node-keytar` wrapper).
  - **Offline Profile**: Store user preferences and local agent profile in local JSON config (`~/.sutra/profile.json`).

#### 2. Agent Memory: SQLite In-Process Vector & Knowledge Store
- **Current State**: `AgentMemoryService` sends memories to `https://api.ainative.studio/v1/memory/store` and searches via `/memory/search`.
- **Sovereign Replacement**:
  - Repoint `IAgentMemoryService` to utilize `LocalVectorStore` backed by SQLite (`.sutra/agent_memory.db`).
  - Store conversation entries, tool executions, and learned user preferences locally.
  - Hybrid lexical (FTS5 BM25) + dense vector semantic retrieval executed in <2ms with zero network requests.

#### 3. ZeroDB Code Context: Local Codebase Semantic Search
- **Current State**: Codebase chunks uploaded to Railway Hikari PostgreSQL.
- **Sovereign Replacement**:
  - Fully handled by `CodeContextEngineService` and `LocalVectorStore` created in Phase 2.
  - Embeddings generated locally or via user's configured embedding model, stored in `.sutra/index.db`.
  - Incremental re-indexing on file change events via `IFileService`.

#### 4. Usage & Token Tracking: Local Developer Telemetry
- **Current State**: Cloud tracks credit burn to enforce paid subscriptions.
- **Sovereign Replacement**:
  - Create `LocalUsageTrackingService` backed by SQLite (`.sutra/usage.db`).
  - Record: timestamp, model name, prompt tokens, completion tokens, estimated USD cost based on public pricing tables.
  - Render local usage stats in the settings UI for developer visibility, with zero billing restrictions or artificial credit caps.

#### 5. Community Skills Marketplace: Decentralized Git Registry
- **Current State**: Rest-API querying `api.ainative.studio/v1/skills/marketplace`.
- **Sovereign Replacement**:
  - Shift to a Git-backed decentralized skill catalog:
    - Primary: Fetch static JSON manifest from `https://raw.githubusercontent.com/ranveerd11/sutra-skills/main/index.json` or fallback to bundled local skills.
    - Support direct installation from any Git URL: `/skill install https://github.com/user/skill-name`.
    - Local directory structure: skills stored as plain directories with `SKILL.md` under `~/.sutra/skills/`.

#### 6. Auto-Update Service: Independent GitHub Releases
- **Current State**: Checks `AINative-Studio/binaries/releases/latest`.
- **Sovereign Replacement**:
  - Update endpoint in `ainativeUpdateMainService.ts` to `https://api.github.com/repos/ranveerd11/sutra-ide/releases/latest`.
  - Provide fallback option to check offline or prompt user cleanly.

#### 7. Offline Documentation: Local Dash / Zeal / DevDocs Support
- **Current State**: Fetches online documentation via HTTP from whitelisted domains.
- **Sovereign Enhancement**:
  - Retain HTTP fetch for online workflows.
  - Add optional local documentation directory (`~/.sutra/docs/` or DevDocs offline bundles) allowing offline querying of standard libraries (Python, Node.js, Rust, Go) when completely disconnected from the internet.

---

## 4. Migration & Decoupling Action Matrix

| Subsystem | Upstream Cloud Target | Sovereign Replacement | Implementation Effort | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Code Context / ZeroDB** | `api.ainative.studio/api/v1/zerodb/*` | `LocalVectorStore` (SQLite + FTS5 + Dense) | High | **Completed (Phase 2)** |
| **Agent Memory** | `api.ainative.studio/v1/memory/*` | SQLite local memory store | Medium | **Ready to Implement** |
| **Auth / Session** | `api.ainative.studio/api/v1/auth/*` | Direct BYOK + OS SecretStorage | Low | **Ready to Implement** |
| **Chat Proxy** | `api.ainative.studio/api/v1/managed/chat` | Direct BYOK (Anthropic/OpenAI/Ollama) | Low | **Already Supported** |
| **Usage Tracking** | `api.ainative.studio/api/v1/managed/usage` | Local SQLite usage ledger | Medium | **Ready to Implement** |
| **Community Skills** | `api.ainative.studio/v1/skills/marketplace`| Git-based decentralized registry | Medium | **Ready to Implement** |
| **Auto-Update** | `api.github.com/repos/AINative-Studio/*` | `ranveerd11/sutra-ide` releases | Trivial | **Ready to Implement** |
| **Telemetry** | `us.i.posthog.com` | Disabled by default (opt-in only) | Trivial | **Completed** |

---

## 5. Strategic Recommendations for Next Phase

1. **Step 1: Repoint `AgentMemoryService` to `LocalVectorStore`**:
   - Eliminate all remote HTTP calls to `api.ainative.studio/v1/memory/*`.
   - Store conversation sessions and cross-session agent memory in `.sutra/agent_memory.db`.
2. **Step 2: Retire Mandatory Cloud Sign-In & Set BYOK as Sovereign Default**:
   - Default `byokMode: true` across all configuration layers.
   - Clean up UI to make "Local / Direct Provider" the default view rather than prompting for an AINative Cloud account.
3. **Step 3: Replace `ainativeUpdateMainService` Target**:
   - Change binary release tracking to `ranveerd11/sutra-ide`.
4. **Step 4: Decentralize Community Skills**:
   - Point `communityMarketplace.ts` to a static GitHub JSON manifest or direct Git clone.

Following this blueprint guarantees that the IDE becomes a completely self-contained, sovereign, privacy-preserving developer tool with zero ongoing dependency on third-party SaaS servers.
