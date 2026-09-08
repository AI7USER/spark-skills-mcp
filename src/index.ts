import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "node:path";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SkillRegistry } from "./registry.js";
import { createMcpServer } from "./tools.js";

dotenv.config();

const app = express();

// Full permissive CORS for web clients (including Gemini)
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "mcp-session-id",
      "mcp-protocol-version",
      "accept",
    ],
    exposedHeaders: ["mcp-session-id", "mcp-protocol-version", "content-type"],
  })
);

// Logging middleware for troubleshooting incoming connections
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`, {
    origin: req.headers.origin,
    accept: req.headers.accept,
    contentType: req.headers["content-type"],
    userAgent: req.headers["user-agent"],
  });
  next();
});

const port = process.env.PORT || 10000;
const skillsPath = process.env.SKILLS_DIR || path.resolve(process.cwd(), "skills");

const registry = new SkillRegistry(skillsPath);
registry.loadSkills();

const mcpServer = createMcpServer(registry);

// Modern Streamable HTTP MCP Transport (compatible with /mcp and /sse)
const streamableTransport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined, // Stateless mode for resilient cloud hosting
  enableJsonResponse: true,      // Supports both SSE streaming and direct JSON responses
});

// Connect MCP server to transport on startup
await mcpServer.connect(streamableTransport);

// 1. Health check for Render and monitoring
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    uptimeSeconds: Math.floor(process.uptime()),
    skillsCount: registry.getCount(),
    timestamp: new Date().toISOString(),
  });
});

// 2. Direct REST API preview for quick browser inspection
app.get("/api/skills", (req, res) => {
  const category = (req.query.category as string) || undefined;
  res.json({
    total: registry.getCount(),
    skills: registry.listSkills(category),
  });
});

app.get("/api/skills/:name", (req, res) => {
  const skill = registry.getSkill(req.params.name);
  if (!skill) {
    return res.status(404).json({ error: "Skill not found" });
  }
  res.json(skill);
});

// 3. MCP Unified Handler (handles both /mcp and /sse for GET and POST)
const handleMcp = async (req: express.Request, res: express.Response) => {
  try {
    await streamableTransport.handleRequest(req, res);
  } catch (err) {
    console.error("[MCP Error]:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
};

app.all("/mcp", handleMcp);
app.all("/sse", handleMcp);
app.post("/messages", handleMcp);

// 4. Root status page
app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Google Spark MCP Skills Registry</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; padding: 2rem; }
          .card { background: #1e293b; border-radius: 12px; padding: 1.5rem; max-width: 650px; margin: 0 auto; box-shadow: 0 4px 6px rgba(0,0,0,0.3); }
          h1 { color: #38bdf8; font-size: 1.5rem; margin-top: 0.5rem; }
          code { background: #334155; padding: 3px 8px; border-radius: 4px; color: #a5f3fc; font-size: 0.95rem; }
          .badge { display: inline-block; background: #059669; color: white; padding: 4px 10px; border-radius: 9999px; font-size: 0.8rem; font-weight: bold; }
          ul { line-height: 1.8; }
        </style>
      </head>
      <body>
        <div class="card">
          <span class="badge">ONLINE 24/7 (FREE TIER)</span>
          <h1>Google Spark MCP Skill Registry</h1>
          <p>This server provides on-demand agent skills to <strong>Google Spark</strong> over the Model Context Protocol (MCP).</p>
          <p><strong>Available Skills:</strong> ${registry.getCount()} skills ready</p>
          <hr style="border-color: #334155; margin: 1.5rem 0;" />
          <p><strong>MCP Connection Endpoints:</strong></p>
          <ul>
            <li><strong>Primary MCP Endpoint:</strong> <code>https://spark-skills-mcp.onrender.com/mcp</code></li>
            <li><strong>SSE Endpoint:</strong> <code>https://spark-skills-mcp.onrender.com/sse</code></li>
            <li><strong>Health Check:</strong> <code>https://spark-skills-mcp.onrender.com/health</code></li>
            <li><strong>Skills Catalog (JSON):</strong> <code>https://spark-skills-mcp.onrender.com/api/skills</code></li>
          </ul>
        </div>
      </body>
    </html>
  `);
});

app.listen(port, () => {
  console.log(`[MCP Server] Listening on port ${port}`);
  console.log(`[MCP Server] /mcp endpoint ready`);
  console.log(`[MCP Server] /sse endpoint ready`);
  console.log(`[MCP Server] Total Skills Loaded: ${registry.getCount()}`);
});
