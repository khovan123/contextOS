import { useState } from "react";

const PROJECT = {
  name: "ContextOS (ctx)",
  tagline: "The operating system for your agent's brain.",
  oneliner: "Codex plugin inject context thông minh vào mỗi task — người dùng vẫn chạy codex bình thường, ctx tự động chạy ngầm qua hooks engine.",

  problem: {
    headline: "Codex đọc AGENTS.md nhưng thường xuyên bỏ qua nó",
    detail: "Arize AI đo được accuracy của agent sụp đổ ở 70% context capacity do 'lost in the middle' — model yếu attention ở giữa context window. Developer viết AGENTS.md cẩn thận nhưng không biết Codex có thực sự dùng không, và không có cách nào đo điều đó.",
    evidence: [
      "Arize AI: agent accuracy drops at 70% context capacity, not 90%",
      "Developer feedback (Jan 2026): 'exhausting trying to get model to follow context even with extensive instructions'",
      "Codex Skills cap tại 8,000 chars — lớn hơn là bị drop silently",
    ],
  },

  solution: {
    headline: "Codex Plugin = MCP server + hooks — không wrap, không thay thế",
    howItWorks: [
      { step: "Install", desc: "npx ctx install → copy plugin files, tải model all-MiniLM-L6-v2 (23MB) vào models/, warm embeddings.db. Fail fast nếu model không tải được. In 'Restart Codex to activate'." },
      { step: "Codex start", desc: "Codex load plugin → start ctx-mcp server → MCP server load model vào memory (~2s). Codex đảm bảo MCP ready trước khi nhận input — không có race condition." },
      { step: "UserPromptSubmit hook", desc: "User submit task → hook gọi private bridge của ctx-mcp với prompt/cwd → MCP server score context → hook build additionalContext → inject vào conversation." },
      { step: "Codex nhận context", desc: "Model thấy context đã được tối ưu như developer message. Không biết ctx tồn tại, không thay đổi UX." },
      { step: "Stop hook", desc: "Khi Codex xong task → hook đọc git diff, đo rule compliance, in report vào Codex TUI." },
    ],
    keyInsight: "MCP server là long-running process do Codex quản lý lifecycle — start trước session, restart nếu crash. Model load 1 lần lúc MCP init. Hook không tự quản daemon; nó chỉ gọi private bridge socket do ctx-mcp sở hữu vì shell hooks không gọi trực tiếp được Codex MCP runtime.",
  },

  architecture: {
    pluginStructure: [
      { path: "~/.codex/plugins/ctx/", desc: "Plugin root — Codex tự discover" },
      { path: ".codex-plugin/plugin.json", desc: "Plugin manifest — khai báo metadata và mcpServers='.mcp.json' theo schema Codex hiện tại" },
      { path: "hooks/hooks.json", desc: "Đăng ký 2 hooks: UserPromptSubmit + Stop" },
      { path: "mcp/server.js", desc: "MCP server — load model lúc init, expose tool ctx_score_context và private hook bridge. Long-running, Codex quản lý lifecycle" },
      { path: "bin/on-prompt.js", desc: "Hook prompt — gọi ctx-mcp private bridge, build additionalContext, trả stdout" },
      { path: "bin/on-stop.js", desc: "Hook stop — measure compliance từ git diff, in report vào TUI" },
      { path: "lib/analyzer.js", desc: "Parse AGENTS.md, hybrid score (embedding cosine + heuristic bonus)" },
      { path: "lib/scheduler.js", desc: "Primacy+Recency layout, build additionalContext string" },
      { path: "lib/measure.js", desc: "Git diff reader + rule compliance checker" },
      { path: "lib/graph.js", desc: "Import graph traversal — seed files → subtree scan, hard timeout 150ms" },
      { path: "~/.codex/contextos/models/", desc: "Model cache — all-MiniLM-L6-v2 (23MB), tải lúc install" },
      { path: "~/.codex/contextos/embeddings.db", desc: "SQLite — embedding cache cho rules + files, warm lúc install, MCP server đọc lúc init" },
    ],
    hookFlow: "Codex start → load ctx plugin → start mcp/server.js → model load vào memory → session ready → user submit prompt → UserPromptSubmit hook → on-prompt.js gọi ctx-mcp private bridge(prompt, cwd, openFiles) → MCP server score context → trả kết quả → scheduler build additionalContext → inject vào conversation → agent chạy → Stop hook → on-stop.js → git diff → compliance → report in TUI",
    keyConstraint: "MCP server được Codex quản lý lifecycle và hook chỉ gọi local bridge với timeout ngắn. Model không cold-load trong hook. Toàn bộ pipeline mục tiêu < 200ms; import graph và embedding retrieval đều bị cap timeout.",
    daemonLifecycle: "Không còn daemon tự quản. Codex start ctx-mcp, restart nếu crash, stop khi session đóng. Private Unix socket chỉ là bridge nội bộ do ctx-mcp sở hữu cho shell hooks; không có PID file hay daemon process riêng.",
  },

  audience: "Developer đang dùng Codex CLI có AGENTS.md với conventions, nhưng frustrate vì Codex hay bỏ qua rules. Đặc biệt teams có codebase lớn và AGENTS.md dài.",
  positioning: "Không phải security tool. Không phải observability tool. Không phải CLI wrapper. Đây là Codex plugin — tích hợp native, không thay đổi workflow, làm agent thông minh hơn từ bên trong.",
  successMetric: "Demo 60 giây trong Codex TUI: submit task → thấy ctx report cuối session — rules followed/ignored, efficiency score. Difference rõ ràng so với không có ctx.",
  nonGoals: [
    "Không replace Codex hay thay đổi cách user dùng Codex",
    "Không hỗ trợ Codex Cloud (chỉ CLI, hooks chỉ có ở CLI)",
    "Không có web UI hay dashboard",
    "Không có network calls trong hook (phải fast)",
    "v1 không support multi-agent hay parallel tasks",
  ],
};

const PHASES = [
  {
    id: "p0",
    label: "P0",
    title: "Plugin scaffold",
    color: "#534AB7",
    bg: "#EEEDFE",
    goal: "Plugin được Codex discover, MCP server start và load model, hooks fire đúng event",
    deliverable: "ctx install không lỗi → restart Codex → mcp/server.js start và log 'ctx-mcp ready' → submit task → on-prompt.js inject context qua MCP bridge",
    modules: [
      {
        name: "Plugin manifest (plugin.json)",
        what: "Tạo .codex-plugin/plugin.json khai báo name='ctx' và mcpServers='.mcp.json'. Hook commands được install vào global hooks bằng ctx install vì schema plugin hiện tại không nhận inline hooks field.",
        get: "Codex discover plugin, biết phải start MCP server nào và register hook nào",
        test: "validate:plugin pass. codex plugin list → ctx xuất hiện. codex mcp list/get → ctx-mcp enabled. ~/.codex/hooks.json có UserPromptSubmit + Stop commands của ctx.",
      },
      {
        name: "MCP server (mcp/server.js)",
        what: "MCP server load model/cache lúc init, log 'ctx-mcp ready'. Expose tool ctx_score_context qua MCP SDK stdio transport và private bridge cho shell hooks.",
        get: "Codex start được MCP server, model load thành công, tool callable từ hook",
        test: "Start Codex hoặc test:mcp → check tool trả structuredContent đúng schema. Hook bridge smoke trả modelStatus enabled. Verify model không cold-load trong hook.",
      },
      {
        name: "npx ctx install — model download + warm",
        what: "Bước 1: copy plugin files vào ~/.codex/plugins/ctx/. Bước 2: in 'Preparing required local embedding model...' → tải all-MiniLM-L6-v2 (23MB) vào ~/.codex/contextos/models/. Bước 3: warm embeddings.db với AGENTS.md của project hiện tại. Fail fast exit 1 nếu model không tải được. In 'Restart Codex to activate' khi xong.",
        get: "Sau install: model file có sẵn, embeddings.db warm, MCP server sẽ load được ngay khi Codex restart",
        test: "Chạy install trên máy sạch → models/ có file, embeddings.db có rows. Simulate download fail → exit 1 message rõ. Simulate AGENTS.md không có → warn, không fail.",
      },
      {
        name: "hooks.json + on-prompt.js",
        what: "Đăng ký UserPromptSubmit → on-prompt.js, Stop → on-stop.js. on-prompt.js parse JSON stdin, gọi ctx-mcp bridge, nhận scoredRules/suggestedFiles, trả stdout JSON hợp lệ với additionalContext.",
        get: "Hook pipeline end-to-end hoạt động: stdin → MCP bridge call → scheduler → stdout",
        test: "Submit task → JSON stdout valid, Codex không error. Runtime smoke trên buddy trả modelStatus enabled và total hook < 200ms.",
      },
      {
        name: "on-stop.js",
        what: "Parse JSON stdin, đọc last prompt context, đo git diff/status, build report followed/ignored/unknown, trả JSON hợp lệ với systemMessage.",
        get: "Stop hook pipeline hoạt động và có report thật",
        test: "Codex hoàn thành task → Stop hook trả ContextOS report, ctx report/evidence đọc lại được last-report.json.",
      },
    ],
  },
  {
    id: "p1",
    label: "P1",
    title: "Context scheduler",
    color: "#0F6E56",
    bg: "#E1F5EE",
    goal: "on-prompt.js inject context semantic-aware — 'kiểm duyệt' phải kéo được rules về 'moderation'",
    deliverable: "Submit 'kiểm tra flow kiểm duyệt upload' → additionalContext có rules về moderation/upload dù không có token overlap. Import graph tìm đúng file liên quan. elapsedMs < 300ms.",
    modules: [
      {
        name: "AGENTS.md reader (lib/reader.js)",
        what: "Đọc chain: ~/.codex/AGENTS.md → project root AGENTS.md → walk down tới cwd. Merge thành 1 string, giữ section headers để phân biệt nguồn gốc.",
        get: "Toàn bộ rules user đã viết, đúng thứ tự ưu tiên Codex dùng",
        test: "Unit test 3 levels AGENTS.md, verify merge thứ tự. Edge: chỉ có global, chỉ có project, không có file.",
      },
      {
        name: "Rule parser (lib/analyzer.js)",
        what: "Parse AGENTS.md thành mảng RuleItem[]. Handle: bullet (- /*), numbered list, heading sections, plain lines > 20 chars. Bỏ qua blank lines và separator.",
        get: "Mảng rules riêng lẻ có thể score độc lập",
        test: "5 AGENTS.md fixture từ repos phổ biến. Verify không mất rule, không duplicate.",
      },
      {
        name: "Hybrid scorer — embedding + heuristic (lib/analyzer.js + mcp/server.js)",
        what: "MCP server implement ctx_score_context: nhận prompt + rules[] + files[] → embed tất cả qua model đã load → tính cosine similarity → apply heuristic bonus (+0.4 nếu rule có always/never/must/required/important/strictly, +0.2 nếu rule mention filename) → trả scoredRules[] + suggestedFiles[]. Hook chỉ gọi tool, không biết gì về embedding logic.",
        get: "Semantic gap giải quyết trong MCP server: 'kiểm duyệt' ≈ 'moderation' trong embedding space dù khác token",
        test: "Gọi ctx_score_context trực tiếp (không qua hook): prompt 'kiểm tra flow kiểm duyệt upload' + rules có 'moderation' → score > 0.5. Prompt tiếng Anh 'fix auth bug' + rules về auth → score cao. Không còn fallback path — nếu MCP fail là bug cần fix.",
      },
      {
        name: "Primacy+Recency scheduler (lib/scheduler.js)",
        what: "Sort rules theo score. High (≥0.5) → đầu + cuối additionalContext (recency trick). Mid (0.1–0.5) → giữa. Low (<0.1) → drop. Total length cap 4000 chars.",
        get: "Model nhớ tốt nhất high-relevance rules, noise bị loại",
        test: "Snapshot test deterministic. High rules xuất hiện đúng 2 lần. Length luôn < 4000 chars.",
      },
      {
        name: "File relevance finder — embedding + import graph (lib/graph.js + lib/analyzer.js)",
        what: "Bước 1: embedding search — embed prompt, so với embedding của file paths trong embeddings.db, lấy top-10 candidates. Bước 2: import graph traversal — từ top-10 seed files, parse import statements, expand tới files được import/import ngược. Chỉ scan subtree liên quan, không walk toàn bộ monorepo. Hard timeout 150ms cho toàn bộ bước 2. Output: top 5 files với lý do.",
        get: "Tìm đúng files kể cả khi path không có token match với prompt. Monorepo-safe.",
        test: "Prompt 'kiểm duyệt upload' → tìm được upload.events.ts, resource-upload.spec.ts. Verify timeout 150ms được enforce: mock slow traversal → vẫn trả kết quả partial đúng hạn.",
      },
      {
        name: "Hook wiring (on-prompt.js hoàn chỉnh)",
        what: "Parse stdin → gọi ctx_score_context(prompt, rules, files) → nhận {scoredRules, suggestedFiles, elapsedMs} → scheduler build additionalContext → trả stdout JSON. Log: elapsedMs, rules injected count, files suggested. Không có fallback path — MCP luôn available.",
        get: "Mỗi task nhận context semantic-aware, log đủ để debug",
        test: "E2E trong Codex: submit 'kiểm tra flow kiểm duyệt upload' → verify additionalContext trong transcript. MCP protocol smoke chạy 50 warm calls, p95 < 50ms. Installed hook smoke trên buddy total < 200ms.",
      },
    ],
  },
  {
    id: "p2",
    label: "P2",
    title: "Measure & report",
    color: "#854F0B",
    bg: "#FAEEDA",
    goal: "Stop hook in report rõ ràng trong Codex TUI — đây là thứ người ta screenshot",
    deliverable: "Sau mỗi task Codex, TUI hiển thị: rules followed/ignored, efficiency %, suggestion cụ thể",
    modules: [
      {
        name: "Git diff reader (lib/measure.js)",
        what: "Từ cwd trong Stop payload, chạy git diff HEAD. Parse output: extract filenames thay đổi, extract added lines (bắt đầu bằng +). Fallback: git status nếu chưa có commit. Fallback 2: skip nếu không có git.",
        get: "Snapshot những gì Codex thực sự viết",
        test: "Mock git diff output với fixture strings. Verify parser lấy đúng filenames + added lines. Test fallback: mock git không khả dụng → skip gracefully.",
      },
      {
        name: "Rule compliance checker (lib/measure.js)",
        what: "So sánh high-score rules (score ≥ 0.5) với added lines từ git diff. Naive keyword match: extract nouns/libs từ rule, check có xuất hiện trong diff không. Rule 'use zod' → check 'zod' trong imports. Rule 'no console.log' → check 'console.log' trong diff.",
        get: "Danh sách rules: followed / ignored / unknown (không đủ signal)",
        test: "Fixture: rule 'use zod validation' + diff có import zod → followed. Rule 'no console.log' + diff có console.log → ignored. Rule về architecture → unknown (không thể verify từ diff).",
      },
      {
        name: "Report builder + Stop hook wiring (on-stop.js)",
        what: "Build report string từ measure results. Format: header, injected rules count, followed/ignored list, efficiency %, suggestion ('consider moving X to top of AGENTS.md'). Print ra stdout plain text — Codex hiển thị trong TUI như system message.",
        get: "User thấy report ngay trong Codex TUI sau khi task xong, không cần chạy lệnh khác",
        test: "Visual test với mock data: verify format không wrap xấu ở 80 cols. Verify suggestion chỉ xuất hiện khi có ignored rules. Test: Codex TUI thực sự hiển thị output từ Stop hook.",
      },
    ],
  },
  {
    id: "p3",
    label: "P3",
    title: "Polish & ship",
    color: "#993C1D",
    bg: "#FAECE7",
    goal: "Repo public, người khác cài được, README hiểu trong 10 giây",
    deliverable: "npm publish + GitHub repo + demo GIF + HN post",
    modules: [
      {
        name: "Error handling toàn bộ",
        what: "Mọi error trong hook scripts phải: (1) không throw uncaught exception làm crash hook, (2) trả JSON hợp lệ với continue:true để Codex không bị block, (3) log lỗi vào PLUGIN_DATA/error.log. Cases: AGENTS.md không tồn tại, git fail, JSON parse fail, timeout.",
        get: "Hook không bao giờ làm hỏng Codex session dù có bug",
        test: "Inject lỗi vào từng bước: corrupt AGENTS.md, git không có → verify Codex vẫn chạy bình thường, chỉ ctx bị skip với warning.",
      },
      {
        name: "ctx debug command",
        what: "npx ctx debug — chạy analyze + schedule với task giả trên project hiện tại, in ra: rules parsed, scores, final additionalContext sẽ được inject. Dùng để user hiểu ctx đang làm gì và tune AGENTS.md.",
        get: "Transparency tool — user tin tưởng ctx hơn khi thấy logic rõ ràng",
        test: "Chạy trong project có AGENTS.md → output có đủ: rule list, scores, final context. Không crash khi AGENTS.md trống.",
      },
      {
        name: "ctx report command",
        what: "npx ctx report — đọc PLUGIN_DATA/last-report.json, in lại report của task gần nhất. Dùng để share sau khi Codex session đã đóng.",
        get: "User có thể lưu và share report mà không cần mở lại Codex",
        test: "Run task trong Codex → đóng Codex → npx ctx report → output giống report trong TUI.",
      },
      {
        name: "README + demo GIF",
        what: "README: GIF demo đầu tiên (screen record Codex TUI với ctx report hiện ra), fear hook ('your AGENTS.md is being ignored'), 1-line install, before/after example. GIF quay 2 session: không có ctx (rules ignored) vs có ctx (rules followed, report hiện).",
        get: "Người xem README hiểu giá trị trong 10 giây, nút star ngay",
        test: "Show cho 3 người không biết project: trong 30 giây họ có hiểu ctx làm gì không? Nếu không → rewrite README.",
      },
    ],
  },
];

const TESTING = [
  {
    layer: "Unit tests",
    tool: "Vitest",
    what: "Test pure functions trong lib/: parseRules(), scheduleContext(), parseGitDiff(), checkCompliance(). Mock MCP client để scorer test không cần server thật chạy.",
    coverage: "lib/ ≥ 90% line coverage",
  },
  {
    layer: "MCP server tests",
    tool: "Vitest + MCP SDK test client",
    what: "Start mcp/server.js thật, gọi ctx_score_context qua MCP protocol. Verify: tool trả đúng schema, model đã load trước tool call đầu tiên (không cold-load), concurrent calls không block nhau. Đo latency p95 < 50ms sau warm-up.",
    coverage: "Happy path + concurrent calls + schema validation",
  },
  {
    layer: "Hook contract tests",
    tool: "Vitest + child_process",
    what: "Spawn on-prompt.js như Codex: pipe JSON stdin → đọc JSON stdout. Verify: valid JSON, continue:true, elapsedMs < 200ms. Chạy với MCP server thật đang running.",
    coverage: "Mọi JSON field Codex expect đều có",
  },
  {
    layer: "Semantic scorer tests",
    tool: "Vitest — gọi MCP tool trực tiếp",
    what: "Test vocabulary mismatch qua ctx_score_context: 'kiểm duyệt' + rules có 'moderation' → score ≥ 0.4. 'tải lên' + rules có 'upload' → score ≥ 0.4. Dùng model thật (không mock) để bắt regression nếu đổi model.",
    coverage: "10 cross-language pairs",
  },
  {
    layer: "Snapshot fixtures",
    tool: "Vitest snapshot",
    what: "6 AGENTS.md thực tế + 3 task mỗi cái. Verify scheduler output không đổi giữa builds. Bắt regression khi thay đổi scoring weights hay layout logic.",
    coverage: "6 × 3 = 18 snapshots",
  },
  {
    layer: "Performance regression",
    tool: "Vitest bench (CI)",
    what: "Benchmark hook pipeline end-to-end với MCP server running. Fail CI nếu p95 > 200ms. Benchmark riêng import graph traversal — fail nếu vượt 150ms. Chạy mỗi PR.",
    coverage: "p50 / p95 / p99 tracked mỗi PR",
  },
  {
    layer: "Manual smoke test (rtk)",
    tool: "npm test + validate:plugin",
    what: "Sau mỗi thay đổi: rtk npm test, rtk npm run validate:plugin. Smoke test ctx debug trong buddy: verify elapsedMs < 200ms, files suggested hợp lý, không có cold-load trong hook.",
    coverage: "Chạy trước mỗi push lên main",
  },
];

const RISKS = [
  {
    risk: "MCP server crash giữa session — Codex restart hay để hook fail?",
    mitigation: "Codex tự restart MCP server khi crash — đây là guaranteed behavior của Codex plugin lifecycle. Hook call kế tiếp sau restart sẽ gặp cold-load (~2s) một lần duy nhất. Không cần ctx xử lý gì thêm.",
    severity: "low",
  },
  {
    risk: "Model download fail khi install (network, disk space, permission)",
    mitigation: "install fail fast exit 1 với message cụ thể. MCP server không start được nếu models/ trống — lỗi rõ ràng ngay khi Codex load plugin. Thêm --offline flag để skip download, dùng ctx mà không có embedding (degraded mode).",
    severity: "medium",
  },
  {
    risk: "embeddings.db stale khi AGENTS.md thay đổi — scoring dùng embedding cũ",
    mitigation: "MCP server check mtime của AGENTS.md lúc init và mỗi N calls. Nếu mtime thay đổi → re-embed rules bị stale. Re-embed incremental: chỉ rules mới/thay đổi, không warm lại toàn bộ.",
    severity: "medium",
  },
  {
    risk: "Import graph traversal timeout 150ms không đủ cho monorepo rất lớn",
    mitigation: "Chỉ scan subtree liên quan đến seed files — không walk toàn bộ. Timeout hard cap trả partial result. Đo trong CI benchmark, điều chỉnh nếu cần.",
    severity: "low",
  },
  {
    risk: "Codex thay đổi plugin.json schema hoặc additionalContext format",
    mitigation: "Contract test verify schema mỗi PR. Fail-open: nếu hook crash, Codex vẫn chạy bình thường. Pin Codex version trong docs và CHANGELOG.",
    severity: "medium",
  },
  {
    risk: "MCP SDK version conflict nếu project đã có MCP server khác",
    mitigation: "ctx-mcp dùng MCP SDK riêng trong plugin directory, không share với project. Không có global dependency. Version pin rõ ràng trong package.json của plugin.",
    severity: "low",
  },
];

export default function Plan() {
  const [activePhase, setActivePhase] = useState("p0");
  const [activeModule, setActiveModule] = useState(null);
  const [tab, setTab] = useState("overview");
  const phase = PHASES.find(p => p.id === activePhase);

  return (
    <div style={{ fontFamily: "'IBM Plex Mono','Courier New',monospace", padding: "1.5rem 0", lineHeight: 1.6 }}>

      {/* Tab bar */}
      <div style={{ display:"flex", gap:0, marginBottom:"1.5rem", borderBottom:"0.5px solid var(--color-border-tertiary)" }}>
        {[["overview","Overview"],["arch","Architecture"],["phases","Build phases"],["testing","Testing"],["risks","Risks"]].map(([id,label]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            background:"none", border:"none",
            borderBottom: tab===id ? "2px solid var(--color-text-primary)" : "2px solid transparent",
            padding:"8px 12px", fontSize:"12px", fontWeight: tab===id ? 500 : 400,
            color: tab===id ? "var(--color-text-primary)" : "var(--color-text-secondary)",
            cursor:"pointer", marginBottom:"-0.5px", fontFamily:"inherit",
          }}>{label}</button>
        ))}
      </div>

      {/* OVERVIEW */}
      {tab === "overview" && (
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          <div style={{ background:"var(--color-background-primary)", border:"0.5px solid var(--color-border-tertiary)", borderRadius:12, padding:"16px 18px" }}>
            <div style={{ fontSize:11, color:"var(--color-text-tertiary)", marginBottom:4 }}>project</div>
            <div style={{ fontSize:16, fontWeight:500, color:"var(--color-text-primary)", marginBottom:4 }}>{PROJECT.name}</div>
            <div style={{ fontSize:12, color:"var(--color-text-secondary)", marginBottom:10, fontStyle:"italic" }}>{PROJECT.tagline}</div>
            <div style={{ fontSize:12, color:"var(--color-text-primary)", lineHeight:1.6, background:"var(--color-background-secondary)", padding:"10px 12px", borderRadius:8 }}>{PROJECT.oneliner}</div>
          </div>

          <div style={{ background:"var(--color-background-primary)", border:"0.5px solid var(--color-border-tertiary)", borderRadius:12, padding:"16px 18px" }}>
            <div style={{ fontSize:11, fontWeight:500, color:"#791F1F", background:"#FCEBEB", padding:"2px 7px", borderRadius:3, display:"inline-block", marginBottom:10 }}>problem</div>
            <div style={{ fontSize:13, fontWeight:500, color:"var(--color-text-primary)", marginBottom:8 }}>{PROJECT.problem.headline}</div>
            <div style={{ fontSize:12, color:"var(--color-text-secondary)", lineHeight:1.6, marginBottom:12 }}>{PROJECT.problem.detail}</div>
            {PROJECT.problem.evidence.map((e,i) => (
              <div key={i} style={{ display:"flex", gap:8, fontSize:11, color:"var(--color-text-secondary)", marginBottom:4 }}>
                <span style={{ color:"#A32D2D", flexShrink:0 }}>→</span><span>{e}</span>
              </div>
            ))}
          </div>

          <div style={{ background:"var(--color-background-primary)", border:"0.5px solid var(--color-border-tertiary)", borderRadius:12, padding:"16px 18px" }}>
            <div style={{ fontSize:11, fontWeight:500, color:"#085041", background:"#E1F5EE", padding:"2px 7px", borderRadius:3, display:"inline-block", marginBottom:10 }}>solution</div>
            <div style={{ fontSize:13, fontWeight:500, color:"var(--color-text-primary)", marginBottom:12 }}>{PROJECT.solution.headline}</div>
            {PROJECT.solution.howItWorks.map((s,i) => (
              <div key={i} style={{ display:"flex", gap:0, marginBottom: i < PROJECT.solution.howItWorks.length-1 ? 0 : 0 }}>
                <div style={{ display:"flex", flexDirection:"column", alignItems:"center", marginRight:12 }}>
                  <div style={{ width:22, height:22, borderRadius:"50%", background:"#E1F5EE", display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:500, color:"#085041", flexShrink:0 }}>{i+1}</div>
                  {i < PROJECT.solution.howItWorks.length-1 && <div style={{ width:1, flex:1, background:"var(--color-border-tertiary)", minHeight:12 }}/>}
                </div>
                <div style={{ paddingBottom:12 }}>
                  <span style={{ fontSize:12, fontWeight:500, color:"var(--color-text-primary)" }}>{s.step} </span>
                  <span style={{ fontSize:12, color:"var(--color-text-secondary)" }}>— {s.desc}</span>
                </div>
              </div>
            ))}
            <div style={{ fontSize:11, color:"var(--color-text-tertiary)", borderTop:"0.5px solid var(--color-border-tertiary)", paddingTop:10, lineHeight:1.6 }}>
              <span style={{ fontWeight:500, color:"var(--color-text-secondary)" }}>Key insight: </span>{PROJECT.solution.keyInsight}
            </div>
          </div>

          <div style={{ background:"var(--color-background-primary)", border:"0.5px solid var(--color-border-tertiary)", borderRadius:12, padding:"16px 18px" }}>
            <div style={{ fontSize:11, fontWeight:500, color:"#3C3489", background:"#EEEDFE", padding:"2px 7px", borderRadius:3, display:"inline-block", marginBottom:10 }}>verified smoke test</div>
            <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
              {[
                ["embedding.status", "enabled-mcp"],
                ["MCP warm p95", "7ms"],
                ["model cold-load in hook", "không xảy ra"],
                ["rtk npm test", "28 passed"],
                ["rtk npm run test:mcp", "passed"],
                ["validate:plugin", "passed"],
              ].map(([k,v]) => (
                <div key={k} style={{ display:"flex", gap:12, fontSize:12 }}>
                  <code style={{ color:"var(--color-text-tertiary)", flexShrink:0, minWidth:200 }}>{k}</code>
                  <span style={{ color:"var(--color-text-success)", fontWeight:500 }}>{v}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
            <div style={{ background:"var(--color-background-primary)", border:"0.5px solid var(--color-border-tertiary)", borderRadius:10, padding:"14px 16px" }}>
              <div style={{ fontSize:11, fontWeight:500, color:"#3C3489", background:"#EEEDFE", padding:"2px 7px", borderRadius:3, display:"inline-block", marginBottom:8 }}>audience</div>
              <div style={{ fontSize:12, color:"var(--color-text-secondary)", lineHeight:1.6 }}>{PROJECT.audience}</div>
            </div>
            <div style={{ background:"var(--color-background-primary)", border:"0.5px solid var(--color-border-tertiary)", borderRadius:10, padding:"14px 16px" }}>
              <div style={{ fontSize:11, fontWeight:500, color:"#633806", background:"#FAEEDA", padding:"2px 7px", borderRadius:3, display:"inline-block", marginBottom:8 }}>positioning</div>
              <div style={{ fontSize:12, color:"var(--color-text-secondary)", lineHeight:1.6 }}>{PROJECT.positioning}</div>
            </div>
          </div>

          <div style={{ background:"var(--color-background-secondary)", border:"0.5px dashed var(--color-border-tertiary)", borderRadius:8, padding:"12px 14px" }}>
            <div style={{ fontSize:11, fontWeight:500, color:"var(--color-text-secondary)", marginBottom:4 }}>success metric</div>
            <div style={{ fontSize:12, color:"var(--color-text-primary)", lineHeight:1.6 }}>{PROJECT.successMetric}</div>
          </div>

          <div style={{ background:"var(--color-background-primary)", border:"0.5px solid var(--color-border-tertiary)", borderRadius:10, padding:"14px 16px" }}>
            <div style={{ fontSize:11, fontWeight:500, color:"var(--color-text-secondary)", marginBottom:8 }}>non-goals (v1)</div>
            {PROJECT.nonGoals.map((g,i) => (
              <div key={i} style={{ display:"flex", gap:8, fontSize:12, color:"var(--color-text-tertiary)", marginBottom:4 }}>
                <span style={{ flexShrink:0 }}>—</span><span>{g}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ARCHITECTURE */}
      {tab === "arch" && (
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          <div style={{ background:"var(--color-background-primary)", border:"0.5px solid var(--color-border-tertiary)", borderRadius:12, padding:"16px 18px" }}>
            <div style={{ fontSize:11, fontWeight:500, color:"#3C3489", background:"#EEEDFE", padding:"2px 7px", borderRadius:3, display:"inline-block", marginBottom:12 }}>plugin structure</div>
            <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
              {PROJECT.architecture.pluginStructure.map((f,i) => (
                <div key={i} style={{ display:"flex", gap:12, alignItems:"flex-start" }}>
                  <code style={{ fontSize:11, color:"var(--color-text-primary)", background:"var(--color-background-secondary)", padding:"2px 6px", borderRadius:3, whiteSpace:"nowrap", flexShrink:0 }}>{f.path}</code>
                  <span style={{ fontSize:12, color:"var(--color-text-secondary)", lineHeight:1.5 }}>{f.desc}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ background:"var(--color-background-primary)", border:"0.5px solid var(--color-border-tertiary)", borderRadius:12, padding:"16px 18px" }}>
            <div style={{ fontSize:11, fontWeight:500, color:"#085041", background:"#E1F5EE", padding:"2px 7px", borderRadius:3, display:"inline-block", marginBottom:12 }}>hook flow</div>
            <div style={{ fontSize:12, color:"var(--color-text-secondary)", lineHeight:1.8 }}>
              {PROJECT.architecture.hookFlow.split("→").map((part, i, arr) => (
                <span key={i}>
                  <span style={{ color:"var(--color-text-primary)" }}>{part.trim()}</span>
                  {i < arr.length-1 && <span style={{ color:"var(--color-text-tertiary)", margin:"0 6px" }}>→</span>}
                </span>
              ))}
            </div>
          </div>

          <div style={{ background:"#FAEEDA", border:"0.5px solid #EF9F27", borderRadius:10, padding:"12px 14px" }}>
            <div style={{ fontSize:11, fontWeight:500, color:"#633806", marginBottom:6 }}>key constraint</div>
            <div style={{ fontSize:12, color:"#633806", lineHeight:1.6 }}>{PROJECT.architecture.keyConstraint}</div>
          </div>

          <div style={{ background:"var(--color-background-primary)", border:"0.5px solid var(--color-border-tertiary)", borderRadius:10, padding:"14px 16px" }}>
            <div style={{ fontSize:11, fontWeight:500, color:"#085041", background:"#E1F5EE", padding:"2px 7px", borderRadius:3, display:"inline-block", marginBottom:8 }}>MCP lifecycle</div>
            <div style={{ fontSize:12, color:"var(--color-text-secondary)", lineHeight:1.6 }}>{PROJECT.architecture.daemonLifecycle}</div>
          </div>

          <div style={{ background:"var(--color-background-primary)", border:"0.5px solid var(--color-border-tertiary)", borderRadius:12, padding:"16px 18px" }}>
            <div style={{ fontSize:11, fontWeight:500, color:"var(--color-text-secondary)", marginBottom:12 }}>hook payload examples</div>
            <div style={{ fontSize:11, fontWeight:500, color:"var(--color-text-secondary)", marginBottom:6 }}>UserPromptSubmit — stdin nhận:</div>
            <pre style={{ fontSize:11, background:"var(--color-background-secondary)", padding:"10px 12px", borderRadius:6, overflow:"auto", color:"var(--color-text-primary)", margin:"0 0 14px" }}>{`{
  "prompt": "fix the auth bug",
  "cwd": "/my/project",
  "session_id": "uuid",
  "model": "gpt-5.5",
  "hook_event_name": "UserPromptSubmit"
}`}</pre>
            <div style={{ fontSize:11, fontWeight:500, color:"var(--color-text-secondary)", marginBottom:6 }}>on-prompt.js trả stdout:</div>
            <pre style={{ fontSize:11, background:"var(--color-background-secondary)", padding:"10px 12px", borderRadius:6, overflow:"auto", color:"var(--color-text-primary)", margin:0 }}>{`{
  "continue": true,
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "## Critical rules\\n- always use zod...\\n\\n## Files to check\\n- auth.ts, jwt.utils.ts\\n\\n## Reminders\\n- always use zod..."
  }
}`}</pre>
          </div>
        </div>
      )}

      {/* BUILD PHASES */}
      {tab === "phases" && (
        <div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8, marginBottom:"1.25rem" }}>
            {PHASES.map(p => (
              <button key={p.id} onClick={() => { setActivePhase(p.id); setActiveModule(null); }} style={{
                background: activePhase===p.id ? p.bg : "var(--color-background-secondary)",
                border: `0.5px solid ${activePhase===p.id ? p.color : "var(--color-border-tertiary)"}`,
                borderRadius:8, padding:"10px 12px", cursor:"pointer", textAlign:"left",
              }}>
                <div style={{ fontSize:10, fontWeight:500, color:p.color, marginBottom:2, fontFamily:"inherit" }}>{p.label}</div>
                <div style={{ fontSize:12, fontWeight:500, color:"var(--color-text-primary)", fontFamily:"inherit" }}>{p.title}</div>
              </button>
            ))}
          </div>

          <div style={{ background:"var(--color-background-primary)", border:"0.5px solid var(--color-border-tertiary)", borderRadius:12, padding:"16px 18px", marginBottom:"1rem" }}>
            <div style={{ marginBottom:10 }}>
              <span style={{ fontSize:10, fontWeight:500, background:phase.bg, color:phase.color, padding:"2px 7px", borderRadius:3, fontFamily:"inherit" }}>{phase.label}</span>
              <span style={{ fontSize:14, fontWeight:500, color:"var(--color-text-primary)", marginLeft:8 }}>{phase.title}</span>
            </div>
            <div style={{ fontSize:12, color:"var(--color-text-secondary)", marginBottom:6 }}>
              <span style={{ color:"var(--color-text-tertiary)" }}>Goal: </span>{phase.goal}
            </div>
            <div style={{ fontSize:12, color:"var(--color-text-secondary)" }}>
              <span style={{ color:"var(--color-text-tertiary)" }}>Done when: </span>{phase.deliverable}
            </div>
          </div>

          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {phase.modules.map((mod,i) => (
              <div key={i} onClick={() => setActiveModule(activeModule===i ? null : i)}
                style={{ background:"var(--color-background-secondary)", border:`0.5px solid ${activeModule===i ? phase.color : "var(--color-border-tertiary)"}`, borderRadius:8, padding:"12px 14px", cursor:"pointer" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <span style={{ fontSize:13, fontWeight:500, color:"var(--color-text-primary)", fontFamily:"inherit" }}>{mod.name}</span>
                  <span style={{ fontSize:14, color:"var(--color-text-tertiary)" }}>{activeModule===i ? "−" : "+"}</span>
                </div>
                {activeModule===i && (
                  <div style={{ marginTop:12, display:"flex", flexDirection:"column", gap:10 }}>
                    {[["Build",mod.what],["Result",mod.get],["Test",mod.test]].map(([label,content]) => (
                      <div key={label} style={{ display:"flex", gap:10 }}>
                        <span style={{ fontSize:10, fontWeight:500, color:phase.color, background:phase.bg, padding:"2px 6px", borderRadius:3, height:"fit-content", marginTop:2, flexShrink:0, fontFamily:"inherit" }}>{label}</span>
                        <span style={{ fontSize:12, color:"var(--color-text-secondary)", lineHeight:1.6 }}>{content}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TESTING */}
      {tab === "testing" && (
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          {TESTING.map((t,i) => (
            <div key={i} style={{ background:"var(--color-background-primary)", border:"0.5px solid var(--color-border-tertiary)", borderRadius:10, padding:"14px 16px" }}>
              <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
                <span style={{ fontSize:13, fontWeight:500, color:"var(--color-text-primary)" }}>{t.layer}</span>
                <span style={{ fontSize:10, fontWeight:500, background:"var(--color-background-secondary)", color:"var(--color-text-secondary)", padding:"2px 7px", borderRadius:3, fontFamily:"inherit" }}>{t.tool}</span>
              </div>
              <div style={{ fontSize:12, color:"var(--color-text-secondary)", marginBottom:8, lineHeight:1.6 }}>{t.what}</div>
              <div style={{ fontSize:11, color:"var(--color-text-tertiary)", fontFamily:"inherit" }}>
                Coverage target: <span style={{ color:"var(--color-text-success)", fontWeight:500 }}>{t.coverage}</span>
              </div>
            </div>
          ))}
          <div style={{ background:"var(--color-background-secondary)", border:"0.5px dashed var(--color-border-tertiary)", borderRadius:8, padding:"12px 14px" }}>
            <div style={{ fontSize:11, fontWeight:500, color:"var(--color-text-secondary)", marginBottom:6 }}>acceptance criteria tối thượng</div>
            <div style={{ fontSize:12, color:"var(--color-text-tertiary)", lineHeight:1.6 }}>
              Quay được screen record trong Codex TUI: submit task → ctx report hiện sau khi agent xong → rules followed/ignored rõ ràng. Nếu không quay được clip đó → chưa xong.
            </div>
          </div>
        </div>
      )}

      {/* RISKS */}
      {tab === "risks" && (
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          {RISKS.map((r,i) => (
            <div key={i} style={{ background:"var(--color-background-primary)", border:"0.5px solid var(--color-border-tertiary)", borderRadius:10, padding:"14px 16px" }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
                <span style={{
                  fontSize:10, fontWeight:500, padding:"2px 7px", borderRadius:3, fontFamily:"inherit",
                  background: r.severity==="high" ? "#FCEBEB" : r.severity==="medium" ? "#FAEEDA" : "#EAF3DE",
                  color: r.severity==="high" ? "#791F1F" : r.severity==="medium" ? "#633806" : "#27500A",
                }}>{r.severity}</span>
                <span style={{ fontSize:13, fontWeight:500, color:"var(--color-text-primary)" }}>{r.risk}</span>
              </div>
              <div style={{ fontSize:12, color:"var(--color-text-secondary)", lineHeight:1.6 }}>
                <span style={{ color:"var(--color-text-tertiary)" }}>Mitigation: </span>{r.mitigation}
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop:"1.5rem", padding:"10px 14px", background:"var(--color-background-secondary)", borderRadius:8, fontSize:11, color:"var(--color-text-tertiary)", lineHeight:1.6 }}>
        P0 → P1 → P2 → P3 là thứ tự bắt buộc. P0 không xong thì không verify được hook pipeline. P1 là core value. P2 là thứ người dùng share. P3 là ship.
      </div>
    </div>
  );
}
