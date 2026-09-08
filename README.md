# Google Spark MCP Skills Registry

A 24/7 [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server providing on-demand agent skills to **Google Spark (Gemini Spark)**.

Hosted on [Render](https://render.com) for always-on availability, allowing Spark to dynamically query and apply skills anytime—even when your personal computer is turned off.

---

## Features

- **24/7 Cloud Availability**: Hosted on Render as a lightweight Node.js web service.
- **On-Demand Dynamic Loading**: When you tell Spark *"use ui-ux-pro-max"* or *"audit with ponytail"*, Spark calls `get_skill` to fetch that specific skill's guidelines in real time.
- **63+ Portable Upstream Skills Included**:
  - **`ui-ux-pro-max` + CKM Suite**: 7 design & styling skills (79 design styles, 192 palettes, 22 stacks).
  - **`obra/superpowers`**: 14 core agent workflows (TDD, systematic debugging, planning, worktrees).
  - **`mattpocock/skills`**: 35+ architecture and code quality skills (code review, specs, tickets).
  - **`DietrichGebert/ponytail`**: 6 anti-overengineering and debt-tracking skills.
  - **`heygen-hyperframes`**: Video generation quickstart workflow.

---

## MCP Tools Exposed to Google Spark

| Tool | Parameters | Description |
|---|---|---|
| `list_skills` | `category` *(optional)* | Lists available skills with descriptions and categories. |
| `get_skill` | `skill_name` *(required)* | Fetches the full prompt instructions, rules, and reference files for a skill. |
| `search_skills` | `query` *(required)* | Searches skills across names, descriptions, and tags. |

---

## Local Development & Testing

```bash
# 1. Install dependencies
npm install

# 2. Run in development mode
npm run dev

# 3. Build production bundle
npm run build

# 4. Start production server
npm start
```

### Endpoints
- **Web Status Page**: `http://localhost:10000/`
- **Health Check**: `http://localhost:10000/health`
- **REST Skill Catalog**: `http://localhost:10000/api/skills`
- **MCP SSE Connection**: `http://localhost:10000/sse`
- **MCP Message Handler**: `http://localhost:10000/messages`

---

## Deploying to Render (1-Click Blueprint)

1. Push this repository to GitHub.
2. In [Render Dashboard](https://dashboard.render.com), click **New +** > **Blueprint**.
3. Select this repository. Render will automatically read `render.yaml` and configure:
   - **Type**: Web Service
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Health Check**: `/health`
4. Once deployed, Render will provide a public HTTPS URL (e.g. `https://spark-skills-mcp.onrender.com`).

---

## Connecting to Google Spark

1. Open **Gemini Web** (`gemini.google.com`).
2. Go to **Settings** > **Extensions / MCP Servers** > **Add MCP Server**.
3. Enter your Render SSE URL:
   ```
   https://your-spark-skills.onrender.com/sse
   ```
4. Save and authorize.

Now, whenever you chat with Spark, you can say:
> *"List the skills you have access to through MCP."*  
> *"Build this feature. Use the systematic-debugging skill."*  
> *"Redesign this UI using ui-ux-pro-max."*
