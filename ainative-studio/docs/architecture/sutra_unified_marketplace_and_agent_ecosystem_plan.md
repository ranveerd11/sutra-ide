# Sutra IDE: Unified Studio Marketplace & Open Agentic Ecosystem Specification

## Executive Vision

Modern AI code editors suffer from two opposing extremes:
1. **The Fragmented Legacy Editor (VS Code)**: Offers a vast extension gallery for syntax and linters, but treats AI as an afterthought plugin. Agent skills, MCP servers, prompt personas, and terminal agents have no unified catalog or visual management.
2. **The Walled-Garden SaaS (Cursor, Windsurf)**: Provides agentic chat and multi-file editing, but locks developers into proprietary cloud servers, subscription gating ($20-$40/month), opaque telemetry, and treats external terminal agents (Claude Code, OpenAI Codex, Aider) as hostile competitors with zero IDE co-operation.

**Sutra IDE breaks this paradigm** by introducing:
1. **The Unified Studio Marketplace**: A modern, cloud-style visual marketplace combining **VS Code Extensions** (via Open VSX), **Agent Skills** (`SKILL.md`), **MCP Server Plugins**, **Lifecycle Hooks**, and **Vibe Personas** in a single cohesive storefront.
2. **The Open Agentic Bridge (`sutra-bridge`)**: Sutra IDE turns itself into an open runtime host. When developers run Claude Code, Codex, or CLI agents in Sutra's terminal, Sutra exposes its 14-language Tree-Sitter AST, local vector index, and shadow workspace sandbox over Model Context Protocol (MCP).
3. **Vibe Coder Mode with Ambient Extensibility**: A distraction-free canvas where active skills, security guardrails, and vibe personas can be switched fluidly.
4. **100% Privacy & Sovereign Freedom**: Zero telemetry lock-in, zero cloud paywalls, with native support for Indian foundation models (Sarvam AI, Krutrim), global frontier APIs, and local offline models (Ollama/Metal).

```mermaid
flowchart TD
    subgraph Marketplace["Sutra Unified Studio Marketplace"]
        direction TB
        UI["Modern Visual Marketplace UI (Storefront)"]
        Tab1["Extensions (Open VSX: Python, Prettier, Themes)"]
        Tab2["Agent Skills (SKILL.md: FastAPI, K8s, SQLite)"]
        Tab3["MCP Plugins (Postgres, GitHub, Playwright)"]
        Tab4["Lifecycle Hooks (Pre-commit, AST Linters)"]
        Tab5["Vibe Personas (MVP Builder, Security Auditor)"]
        
        UI --> Tab1 & Tab2 & Tab3 & Tab4 & Tab5
    end

    subgraph Core_Engines["Sutra Core Sovereign Engines"]
        AST["14-Language Tree-Sitter AST Engine"]
        VEC["SQLite BM25 + 256-dim Dense Vector Store"]
        SHADOW["Shadow Workspace & Speculative Test Runner"]
        TIMELINE["Turn-by-Turn Git Checkpoint & Diffs"]
    end

    subgraph Agent_Bridge["Sutra Open Agentic Bridge (MCP & IPC)"]
        MCP_Host["sutra-bridge (Native Local MCP Host)"]
        Terminal["Integrated Terminal / CLI Environment"]
        
        Claude["Claude Code (Anthropic)"]
        Codex["OpenAI Codex / CLI"]
        Aider["Aider / OpenQodex"]
        InEditor["Sutra Native Agent / Vibe Mode"]
        
        Terminal --> Claude & Codex & Aider
        Claude & Codex & Aider & InEditor <--> MCP_Host
        MCP_Host <--> Core_Engines
    end

    Marketplace --> Core_Engines
```

---

## 1. Competitive Landscape & Sutra Differentiation Matrix

| Capability | VS Code (Microsoft) | Cursor (Anysphere) | Windsurf (Codeium) | Zed | **Sutra IDE (Sovereign)** |
|---|---|---|---|---|---|
| **Extension Ecosystem** | Proprietary MS Marketplace (thousands) | Open VSX proxy (`cursorapi.com`) | Open VSX proxy | Custom WASM (immature) | **Direct Open VSX + Sovereign Mirror (100% compatible)** |
| **Agent Skills & Workflows** | None native; loose snippet plugins | `.cursorrules` (text files only) | Proprietary Cascades | Basic slash commands | **First-class `SKILL.md` package catalog with 1-click install** |
| **MCP Plugins & Tool Registry** | Manual JSON config via extensions | Buried in settings JSON; fragile | None | Basic context server | **Visual MCP Storefront + 1-click install & environment wizard** |
| **External Agent Support (Claude Code / Codex)** | Isolated shell; no editor AST/vector sharing | Zero integration; competitor lock-in | Zero integration; competitor lock-in | None | **Native `sutra-bridge`: shares AST, vector search & shadow test sandbox** |
| **Vibe Coder Mode** | Zen mode (hides chrome only) | None | None | Clean UI | **Full Vibe Coder Mode (⌘⇧V) with ambient persona & skill switching** |
| **Speculative Self-Healing Sandbox** | None | None (edits directly in working tree) | None | None | **Isolated Shadow Worktree + automatic compilation & test verification** |
| **Privacy & Model Sovereignty** | MS telemetry; Copilot telemetry | Heavy cloud logging; US SaaS lock-in | Proprietary Codeium servers | Partial BYOK | **100% Local-First BYOK + Indian LLMs (Sarvam/Krutrim) + Ollama** |

---

## 2. Component Architecture: The Unified Studio Marketplace

The marketplace is rendered inside Sutra IDE as a primary editor webview / workbench panel (`sutra.marketplace.open`), styled with modern cards, badges, verified tags, search bars, and category filters.

```mermaid
sequenceDiagram
    autonumber
    actor Developer
    participant Storefront as Sutra Marketplace UI
    participant CatalogManager as MarketplaceCatalogManager
    participant OpenVSX as Open VSX Registry (open-vsx.org)
    participant SkillsRegistry as Decentralized Git Registry (sutra-skills)
    participant MCPRegistry as MCP Registry Service
    participant LocalDisk as Local File System (~/.sutra/)

    Developer->>Storefront: Opens Marketplace (⌘⇧X or Marketplace Tab)
    Storefront->>CatalogManager: Query featured items (all categories)
    par Parallel Catalog Ingestion
        CatalogManager->>OpenVSX: Fetch trending extensions
        CatalogManager->>SkillsRegistry: Fetch community skills manifest
        CatalogManager->>MCPRegistry: Fetch verified MCP servers
    end
    CatalogManager-->>Storefront: Unified Search Results & Badged Cards
    
    Developer->>Storefront: Clicks "Install" on "PostgreSQL MCP Plugin"
    Storefront->>MCPRegistry: Install server "postgres-mcp"
    MCPRegistry->>LocalDisk: Write to ~/.sutra/mcp.json & start process
    LocalDisk-->>Storefront: Installation Complete & Active Badge
```

### Marketplace Categories
1. **Extensions**:
   - Integrated with Open VSX (`https://open-vsx.org/vscode/gallery`).
   - Supports searching by language (Python, Rust, TypeScript, Go), themes, linters, debuggers, and keymaps.
   - Preserves manual `.vsix` drag-and-drop installation.
2. **Agent Skills**:
   - Sourced from the decentralized Git catalog (`sutra-skills`) with local offline bundled fallbacks.
   - Shows tags (`database`, `fastapi`, `security`, `frontend`), ratings, author, and `SKILL.md` documentation preview.
3. **MCP Plugins**:
   - Curated catalog of production-tested Model Context Protocol servers:
     - `sqlite-mcp`, `postgres-mcp`, `github-mcp`, `playwright-mcp`, `docker-mcp`, `slack-mcp`.
   - Graphical environment variable prompt modal (e.g. prompt for database connection string or API token safely stored in native OS keychain).
4. **Lifecycle Hooks**:
   - Event-driven hooks that trigger at critical developer lifecycle points:
     - `pre-agent-exec`: validates that agent edits pass AST syntax linting.
     - `post-agent-exec`: triggers shadow test runner.
     - `pre-commit`: automated OpenQodex / secret scanning before git commit.
5. **Vibe Personas**:
   - Pre-packaged personality and behavioral modes for the agent:
     - *Rapid Prototyper*: prioritizes speed and working MVPs with sensible defaults.
     - *Systems Architect*: prioritizes strict typing, documentation, clean interfaces, and zero tech debt.
     - *Security Auditor*: scrutinizes input sanitization, OWASP Top 10, and secret hygiene.

---

## 3. The Open Agentic Bridge (`sutra-bridge`)

When developers run autonomous tools like **Claude Code**, **OpenAI Codex**, or **Aider** inside Sutra's integrated terminal, Sutra does not force them into its own UI. Instead, Sutra acts as an intelligent runtime accelerator:

```mermaid
flowchart LR
    subgraph Terminal_Agent["Terminal Coding Agent (e.g. Claude Code)"]
        AgentCore["Claude Code / Codex / Aider"]
    end

    subgraph Sutra_Bridge["Sutra Open Agentic Bridge (MCP Server)"]
        Bridge["sutra-bridge Daemon (~/.sutra/bridge.sock or stdio)"]
        
        Tool1["sutra_get_ast(file, language)"]
        Tool2["sutra_hybrid_search(query, top_k)"]
        Tool3["sutra_shadow_verify(thread_id)"]
        Tool4["sutra_get_editor_state()"]
        Tool5["sutra_apply_staged_diff()"]
    end

    subgraph Sutra_Engines["Sutra Core Services"]
        AST_Engine["Tree-Sitter AST Parser"]
        Vector_Engine["SQLite Vector + FTS5 BM25"]
        Shadow_Engine["Shadow Workspace Test Runner"]
        Editor_Engine["Active Text Editor & Tabs"]
    end

    AgentCore <--> Bridge
    Bridge --> Tool1 & Tool2 & Tool3 & Tool4 & Tool5
    Tool1 --> AST_Engine
    Tool2 --> Vector_Engine
    Tool3 --> Shadow_Engine
    Tool4 & Tool5 --> Editor_Engine
```

### Capabilities Exposed to Claude Code / Codex via `sutra-bridge`:
1. `sutra_get_ast`: Returns symbols, callers, callees, and complexity calculated by Sutra's in-process 14-language Tree-Sitter engine in <5ms.
2. `sutra_hybrid_search`: Returns reciprocal-rank-fused semantic and lexical code chunks from Sutra's local SQLite store without calling remote embeddings.
3. `sutra_shadow_verify`: Claude Code can ask Sutra to test a speculative code diff inside Sutra's shadow workspace; Sutra runs the project's test suite and returns structured compiler/test failure logs back to Claude Code for self-correction.
4. `sutra_apply_staged_diff`: Sends Claude Code's approved diff into Sutra's visual editor, highlighting changes with inline accept/reject decorations.

---

## 4. Vibe Coder Mode Integration

In Vibe Coder Mode (triggered via `⌘⇧V` / `Ctrl+Shift+V`):
- Chrome is minimized to maximize conversation and live rendering.
- An **Ambient Pill & Action Bar** is docked unobtrusively in the status area or header:
  - **Persona Badge**: Click to switch between *Rapid Prototyper*, *Architect*, or *Auditor*.
  - **Active Skills Counter**: Shows currently loaded skills (e.g., `⚡ 4 Skills Active`).
  - **Quick Marketplace Launcher**: `⌘⇧P -> "Sutra: Browse Marketplace"` brings up a distraction-free spotlight modal.
  - **Sandbox Status**: Real-time indicator displaying speculative shadow test results (`✓ Tests Passing in Sandbox`).

---

## 5. Implementation Roadmap (Phases & Issues)

```mermaid
flowchart TD
    I10["Issue #10: Unified Marketplace Core Service & Open VSX Gallery Integration"]
    I11["Issue #11: Marketplace UI Storefront (React Panels: Extensions, Skills, MCP, Hooks, Vibe)"]
    I12["Issue #12: Sutra Open Agentic Bridge (Native MCP Server for Claude Code & Codex)"]
    I13["Issue #13: Vibe Coder Mode Ambient Extensibility & Persona Management"]

    I10 --> I11
    I10 --> I12
    I11 & I12 --> I13
```

- **Issue #10**: `feat(marketplace): unified catalog manager integrating Open VSX, community skills, and MCP registry`
- **Issue #11**: `feat(ui): modern visual marketplace storefront with multi-category tabs and one-click installation`
- **Issue #12**: `feat(bridge): sutra open agentic bridge MCP server for external CLI agents (Claude Code, Codex, Aider)`
- **Issue #13**: `feat(vibe): ambient persona switcher, skill activator, and sandbox status in Vibe Coder Mode`
