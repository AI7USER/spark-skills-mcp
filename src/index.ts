import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { SkillRegistry } from "./registry.js";
import { createMcpServer } from "./tools.js";

dotenv.config();

// In-memory circular log buffer for remote inspection
const logs: string[] = [];
const logMsg = (type: string, ...args: any[]) => {
  const formattedArgs = args.map((a) => {
    if (a instanceof Error) return `${a.name}: ${a.message}\n${a.stack}`;
    if (typeof a === "object" && a !== null) {
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    }
    return String(a);
  });
  const line = `[${new Date().toISOString()}] [${type}] ${formattedArgs.join(" ")}`;
  logs.push(line);
  if (logs.length > 300) logs.shift();
};

const origLog = console.log;
const origErr = console.error;
console.log = (...args) => {
  logMsg("LOG", ...args);
  origLog(...args);
};
console.error = (...args) => {
  logMsg("ERR", ...args);
  origErr(...args);
};

const app = express();

// Full permissive CORS for web clients (including Gemini)
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "HEAD", "OPTIONS", "DELETE"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "mcp-session-id",
      "mcp-protocol-version",
      "accept",
      "last-event-id",
    ],
    exposedHeaders: ["mcp-session-id", "mcp-protocol-version", "content-type"],
  })
);

// Express JSON body parser for MCP JSON-RPC payloads
app.use(express.json({ limit: "10mb" }));

// Request logging middleware
app.use((req, res, next) => {
  const method = req.method;
  const url = req.url;
  const sessionId = req.headers["mcp-session-id"];
  const userAgent = req.headers["user-agent"];
  const rpcMethod = req.body?.method;

  console.log(`[REQ] ${method} ${url}`, {
    sessionId: sessionId || undefined,
    rpcMethod: rpcMethod || undefined,
    userAgent: userAgent || undefined,
    contentType: req.headers["content-type"] || undefined,
    accept: req.headers["accept"] || undefined,
  });
  next();
});

const port = process.env.PORT || 10000;
const skillsPath = process.env.SKILLS_DIR || path.resolve(process.cwd(), "skills");

const registry = new SkillRegistry(skillsPath);
registry.loadSkills();

// Active Streamable HTTP session registry
interface StreamableSession {
  transport: StreamableHTTPServerTransport;
  server: Server;
  lastActive: number;
}
const streamableSessions = new Map<string, StreamableSession>();

// Active legacy SSE session registry
interface SseSession {
  transport: SSEServerTransport;
  server: Server;
}
const sseSessions = new Map<string, SseSession>();

// Periodic session cleanup (every 10 minutes)
setInterval(() => {
  const now = Date.now();
  const maxIdleMs = 60 * 60 * 1000; // 1 hour
  for (const [sid, session] of streamableSessions.entries()) {
    if (now - session.lastActive > maxIdleMs) {
      console.log(`[Session Cleanup] Expiring idle session: ${sid}`);
      session.transport.close().catch(() => {});
      session.server.close().catch(() => {});
      streamableSessions.delete(sid);
    }
  }
}, 10 * 60 * 1000);

// 1. Health check for Render and monitoring
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    uptimeSeconds: Math.floor(process.uptime()),
    skillsCount: registry.getCount(),
    activeStreamableSessions: streamableSessions.size,
    activeSseSessions: sseSessions.size,
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

app.get("/api/logs", (req, res) => {
  res.json(logs);
});

app.get("/api/skills/:name", (req, res) => {
  const skill = registry.getSkill(req.params.name);
  if (!skill) {
    return res.status(404).json({ error: "Skill not found" });
  }
  res.json(skill);
});

// 3. RFC 9728 OAuth Protected Resource Metadata (Signals no OAuth login required)
const oauthMetadataHandler = (req: express.Request, res: express.Response) => {
  res.json({
    resource: "https://spark-skills-mcp.onrender.com/mcp",
    authorization_servers: [],
    scopes_supported: [],
    resource_name: "Google Spark Skills Registry",
    resource_documentation: "https://spark-skills-mcp.onrender.com",
  });
};

app.get("/.well-known/oauth-protected-resource", oauthMetadataHandler);
app.get("/.well-known/oauth-protected-resource/mcp", oauthMetadataHandler);
app.get("/.well-known/oauth-protected-resource/sse", oauthMetadataHandler);
app.get("/.well-known/oauth-authorization-server", (req, res) => {
  res.status(404).end();
});

// 4. Handle HEAD probes from Google (Vital: Google verifies endpoint with HEAD /mcp)
app.head(["/mcp", "/sse", "/"], (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("mcp-protocol-version", "2024-11-05");
  res.status(200).end();
});

// 5. MCP Streamable HTTP POST Handler (/mcp)
app.post("/mcp", async (req: express.Request, res: express.Response) => {
  const sessionId =
    (req.headers["mcp-session-id"] as string) || (req.query.sessionId as string);

  try {
    // A. Request has an active session ID -> Route to existing session transport
    if (sessionId && streamableSessions.has(sessionId)) {
      const session = streamableSessions.get(sessionId)!;
      session.lastActive = Date.now();
      await session.transport.handleRequest(req, res, req.body);
      return;
    }

    // B. Initialization request -> Create new stateful session with UUID
    const isInit =
      isInitializeRequest(req.body) || req.body?.method === "initialize";

    if (!sessionId && isInit) {
      let createdSessionId: string | undefined;

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
        onsessioninitialized: (sid) => {
          createdSessionId = sid;
          streamableSessions.set(sid, {
            transport,
            server,
            lastActive: Date.now(),
          });
          console.log(`[StreamableHTTP] Session registered: ${sid}`);
        },
      });

      transport.onclose = () => {
        if (createdSessionId && streamableSessions.has(createdSessionId)) {
          console.log(`[StreamableHTTP] Session closed: ${createdSessionId}`);
          streamableSessions.delete(createdSessionId);
        }
      };

      const server = createMcpServer(registry);
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    }

    // C. Non-init request without session ID -> Run via one-off stateless transport
    if (!sessionId) {
      console.log(`[StreamableHTTP] Handling stateless one-off request: ${req.body?.method}`);
      const statelessTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });

      const server = createMcpServer(registry);
      await server.connect(statelessTransport);
      await statelessTransport.handleRequest(req, res, req.body);

      res.on("close", () => {
        statelessTransport.close().catch(() => {});
        server.close().catch(() => {});
      });
      return;
    }

    // D. Session ID was provided but not found -> 404 per MCP specification
    console.warn(`[StreamableHTTP] Unknown session ID received: ${sessionId}`);
    res.status(404).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Session not found" },
      id: req.body?.id || null,
    });
  } catch (err) {
    console.error("[StreamableHTTP POST Error]:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: req.body?.id || null,
      });
    }
  }
});

// 6. MCP Streamable HTTP GET Handler (/mcp) - For SSE streams associated with a session
app.get("/mcp", async (req: express.Request, res: express.Response) => {
  const sessionId =
    (req.headers["mcp-session-id"] as string) || (req.query.sessionId as string);

  if (sessionId && streamableSessions.has(sessionId)) {
    const session = streamableSessions.get(sessionId)!;
    session.lastActive = Date.now();
    await session.transport.handleRequest(req, res);
    return;
  }

  // If no session ID, client must start session via POST initialize
  res.status(400).json({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "Bad Request: Session must be initialized via POST /mcp before opening GET stream",
    },
    id: null,
  });
});

// 7. MCP Streamable HTTP DELETE Handler (/mcp) - Terminate session
app.delete("/mcp", async (req: express.Request, res: express.Response) => {
  const sessionId =
    (req.headers["mcp-session-id"] as string) || (req.query.sessionId as string);

  if (sessionId && streamableSessions.has(sessionId)) {
    const session = streamableSessions.get(sessionId)!;
    await session.transport.handleRequest(req, res);
    session.transport.close().catch(() => {});
    session.server.close().catch(() => {});
    streamableSessions.delete(sessionId);
    return;
  }

  res.status(404).json({
    jsonrpc: "2.0",
    error: { code: -32001, message: "Session not found" },
    id: null,
  });
});

// 8. Legacy SSE Transport Fallback (/sse and /messages)
app.get("/sse", async (req: express.Request, res: express.Response) => {
  console.log("[Legacy SSE] Client opened GET /sse connection");
  try {
    const transport = new SSEServerTransport("/messages", res);
    const server = createMcpServer(registry);
    await server.connect(transport);

    sseSessions.set(transport.sessionId, { transport, server });
    console.log(`[Legacy SSE] Session created: ${transport.sessionId}`);

    res.on("close", () => {
      console.log(`[Legacy SSE] Connection closed: ${transport.sessionId}`);
      transport.close().catch(() => {});
      server.close().catch(() => {});
      sseSessions.delete(transport.sessionId);
    });
  } catch (err) {
    console.error("[Legacy SSE Error]:", err);
    if (!res.headersSent) {
      res.status(500).end();
    }
  }
});

app.post("/messages", async (req: express.Request, res: express.Response) => {
  const sessionId = req.query.sessionId as string;
  if (!sessionId || !sseSessions.has(sessionId)) {
    return res.status(404).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Session not found" },
      id: null,
    });
  }

  try {
    const session = sseSessions.get(sessionId)!;
    await session.transport.handlePostMessage(req, res, req.body);
  } catch (err) {
    console.error("[Legacy SSE Message Error]:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

// 9. Root status page
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
          <p><strong>Active Sessions:</strong> ${streamableSessions.size} Streamable HTTP / ${sseSessions.size} SSE</p>
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
