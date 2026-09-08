import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { SkillRegistry } from "./registry.js";

export function createMcpServer(registry: SkillRegistry): Server {
  const server = new Server(
    {
      name: "spark-skills-registry",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // List available tools for Google Spark
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "list_skills",
          description: "List all available AI agent skills in the registry with their categories and descriptions.",
          inputSchema: {
            type: "object",
            properties: {
              category: {
                type: "string",
                description: "Optional category filter (e.g. 'design-ui', 'code-quality', 'engineering', 'testing')",
              },
            },
          },
        },
        {
          name: "get_skill",
          description: "Fetch the complete instructions, rules, patterns, and guidelines for a specific skill by name.",
          inputSchema: {
            type: "object",
            properties: {
              skill_name: {
                type: "string",
                description: "The name of the skill to fetch (e.g. 'ui-ux-pro-max', 'ponytail-review', 'systematic-debugging')",
              },
            },
            required: ["skill_name"],
          },
        },
        {
          name: "search_skills",
          description: "Search for relevant skills by keyword across names, descriptions, and tags.",
          inputSchema: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "Keyword or topic to search for (e.g. 'accessibility', 'refactor', 'diagram')",
              },
            },
            required: ["query"],
          },
        },
      ],
    };
  });

  // Handle tool invocations from Google Spark
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === "list_skills") {
      const category = (args?.category as string) || undefined;
      const skills = registry.listSkills(category);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                total: skills.length,
                skills: skills.map((s) => ({
                  name: s.name,
                  category: s.category,
                  description: s.description,
                })),
              },
              null,
              2
            ),
          },
        ],
      };
    }

    if (name === "get_skill") {
      const skillName = (args?.skill_name as string) || "";
      const skill = registry.getSkill(skillName);

      if (!skill) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Skill '${skillName}' not found in registry. Use list_skills or search_skills to find available skills.`,
            },
          ],
        };
      }

      let responseText = `# Skill: ${skill.name}\n\n**Category**: ${skill.category || "General"}\n**Description**: ${skill.description}\n\n---\n\n## Instructions\n\n${skill.instructions}`;

      if (skill.supplementaryFiles && Object.keys(skill.supplementaryFiles).length > 0) {
        responseText += `\n\n---\n\n## Supplementary Reference Files (${Object.keys(skill.supplementaryFiles).length} files included):\n`;
        for (const [filePath, content] of Object.entries(skill.supplementaryFiles)) {
          responseText += `\n### File: ${filePath}\n\`\`\`\n${content.slice(0, 5000)}\n\`\`\`\n`;
        }
      }

      return {
        content: [
          {
            type: "text",
            text: responseText,
          },
        ],
      };
    }

    if (name === "search_skills") {
      const query = (args?.query as string) || "";
      const matches = registry.searchSkills(query);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                query,
                matchCount: matches.length,
                results: matches,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    return {
      isError: true,
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
    };
  });

  return server;
}
