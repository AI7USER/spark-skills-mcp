import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "node:path";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { SkillRegistry } from "./registry.js";
import { createMcpServer } from "./tools.js";

dotenv.config();

const app = express();
app.use(cors());

const port = process.env.PORT || 10000;
const skillsPath = process.env.SKILLS_DIR || path.resolve(process.cwd(), "skills");

const registry = new SkillRegistry(skillsPath);
registry.loadSkills();

const mcpServer = createMcpServer(registry);

// Store active transport
let transport: SSEServerTransport | null = null;

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

// 3. MCP SSE endpoint (GET /sse)
app.get("/sse", async (req, res) => {
  console.log("[MCP SSE] Client connected from:", req.ip);
  transport = new SSEServerTransport("/messages", res);
  await mcpServer.connect(transport);

  req.on("close", () => {
    console.log("[MCP SSE] Client disconnected");
  });
});

// 4. MCP message endpoint (POST /messages)
app.post("/messages", async (req, res) => {
  if (!transport) {
    return res.status(400).json({ error: "No active SSE transport connection" });
  }
  await transport.handlePostMessage(req, res);
});

// Root status page
app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Google Spark MCP Skills Registry</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; padding: 2rem; }
          .card { background: #1e293b; border-radius: 12px; padding: 1.5rem; max-width: 600px; margin: 0 auto; box-shadow: 0 4px 6px rgba(0,0,0,0.3); }
          h1 { color: #38bdf8; font-size: 1.5rem; }
          code { background: #334155; padding: 2px 6px; border-radius: 4px; color: #a5f3fc; }
          .badge { display: inline-block; background: #059669; color: white; padding: 4px 8px; border-radius: 9999px; font-size: 0.8rem; font-weight: bold; }
        </style>
      </head>
      <body>
        <div class="card">
          <span class="badge">ONLINE 24/7</span>
          <h1>Google Spark MCP Skill Registry</h1>
          <p>This server provides on-demand agent skills to <strong>Google Spark</strong> over the Model Context Protocol (MCP).</p>
          <p><strong>Available Skills:</strong> ${registry.getCount()} skills ready</p>
          <hr style="border-color: #334155; margin: 1rem 0;" />
          <p><strong>Endpoints:</strong></p>
          <ul>
            <li><code>/sse</code> - MCP Server-Sent Events Endpoint</li>
            <li><code>/health</code> - Service Health Check</li>
            <li><code>/api/skills</code> - JSON Catalog of Skills</li>
          </ul>
        </div>
      </body>
    </html>
  `);
});

app.listen(port, () => {
  console.log(`[MCP Server] Listening on http://localhost:${port}`);
  console.log(`[MCP Server] SSE Endpoint: http://localhost:${port}/sse`);
  console.log(`[MCP Server] Health Check: http://localhost:${port}/health`);
  console.log(`[MCP Server] Total Skills Loaded: ${registry.getCount()}`);
});
