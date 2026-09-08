import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { SkillMetadata, SkillDetail } from "./types.js";

export class SkillRegistry {
  private skillsDir: string;
  private skillsMap: Map<string, SkillDetail> = new Map();

  constructor(skillsDir?: string) {
    this.skillsDir = skillsDir || path.resolve(process.cwd(), "skills");
  }

  public loadSkills(): number {
    this.skillsMap.clear();

    if (!fs.existsSync(this.skillsDir)) {
      console.warn(`[SkillRegistry] Directory not found: ${this.skillsDir}`);
      return 0;
    }

    const entries = fs.readdirSync(this.skillsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".")) continue;

      const skillDir = path.join(this.skillsDir, entry.name);
      const skillMdPath = path.join(skillDir, "SKILL.md");

      if (!fs.existsSync(skillMdPath)) continue;

      try {
        const rawContent = fs.readFileSync(skillMdPath, "utf-8");
        const { frontmatter, body } = this.parseFrontmatter(rawContent);

        const skillName = (frontmatter.name || entry.name).toLowerCase().trim();
        const description = frontmatter.description || "No description provided.";
        const category = frontmatter.category || this.inferCategory(entry.name);
        const tags = Array.isArray(frontmatter.tags) ? frontmatter.tags : [];

        // Check for supplementary reference files (e.g., data/, references/)
        const supplementaryFiles = this.loadSupplementaryFiles(skillDir);

        const stat = fs.statSync(skillMdPath);

        const skillDetail: SkillDetail = {
          name: skillName,
          description,
          category,
          tags,
          version: frontmatter.version || "1.0.0",
          instructions: body.trim(),
          fileCount: 1 + Object.keys(supplementaryFiles).length,
          totalSizeBytes: stat.size,
          supplementaryFiles: Object.keys(supplementaryFiles).length > 0 ? supplementaryFiles : undefined,
        };

        this.skillsMap.set(skillName, skillDetail);
      } catch (err) {
        console.error(`[SkillRegistry] Failed to parse skill in ${entry.name}:`, err);
      }
    }

    console.log(`[SkillRegistry] Loaded ${this.skillsMap.size} skills from ${this.skillsDir}`);
    return this.skillsMap.size;
  }

  private parseFrontmatter(content: string): { frontmatter: Record<string, any>; body: string } {
    const trimmed = content.trim();
    if (!trimmed.startsWith("---")) {
      return { frontmatter: {}, body: content };
    }

    const secondDashes = trimmed.indexOf("\n---", 3);
    if (secondDashes === -1) {
      return { frontmatter: {}, body: content };
    }

    const rawYaml = trimmed.substring(3, secondDashes).trim();
    const body = trimmed.substring(secondDashes + 4).trim();

    try {
      const parsed = parseYaml(rawYaml) || {};
      return { frontmatter: parsed, body };
    } catch {
      return { frontmatter: {}, body };
    }
  }

  private inferCategory(dirName: string): string {
    if (dirName.startsWith("ckm-") || dirName === "ui-ux-pro-max") return "design-ui";
    if (dirName.startsWith("ponytail")) return "code-quality";
    if (dirName.startsWith("dart-") || dirName.startsWith("flutter-")) return "flutter";
    if (dirName.includes("test") || dirName === "tdd") return "testing";
    if (dirName.includes("review") || dirName === "qa") return "code-review";
    if (dirName.includes("video") || dirName.includes("hyperframes")) return "media-video";
    return "engineering";
  }

  private loadSupplementaryFiles(skillDir: string): { [relPath: string]: string } {
    const files: { [relPath: string]: string } = {};

    const scan = (currentDir: string, baseDir: string) => {
      const items = fs.readdirSync(currentDir, { withFileTypes: true });
      for (const item of items) {
        if (item.name.startsWith(".")) continue;
        if (item.name === "node_modules") continue;

        const fullPath = path.join(currentDir, item.name);
        const relPath = path.relative(baseDir, fullPath).replace(/\\/g, "/");

        if (item.isDirectory()) {
          scan(fullPath, baseDir);
        } else if (item.isFile() && item.name !== "SKILL.md") {
          // Only read text/markdown/json files under 100KB to avoid excessive payloads
          const stat = fs.statSync(fullPath);
          if (stat.size < 100 * 1024) {
            try {
              files[relPath] = fs.readFileSync(fullPath, "utf-8");
            } catch {
              // Ignore binary or unreadable files
            }
          }
        }
      }
    };

    scan(skillDir, skillDir);
    return files;
  }

  public listSkills(category?: string): SkillMetadata[] {
    const result: SkillMetadata[] = [];
    for (const skill of this.skillsMap.values()) {
      if (!category || skill.category?.toLowerCase() === category.toLowerCase()) {
        result.push({
          name: skill.name,
          description: skill.description,
          category: skill.category,
          tags: skill.tags,
          version: skill.version,
          fileCount: skill.fileCount,
          totalSizeBytes: skill.totalSizeBytes,
        });
      }
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }

  public getSkill(name: string): SkillDetail | null {
    const key = name.toLowerCase().trim();
    return this.skillsMap.get(key) || null;
  }

  public searchSkills(query: string): SkillMetadata[] {
    const q = query.toLowerCase().trim();
    if (!q) return this.listSkills();

    const result: SkillMetadata[] = [];
    for (const skill of this.skillsMap.values()) {
      const matchName = skill.name.toLowerCase().includes(q);
      const matchDesc = skill.description.toLowerCase().includes(q);
      const matchCategory = skill.category?.toLowerCase().includes(q);
      const matchTags = skill.tags?.some((t) => t.toLowerCase().includes(q));

      if (matchName || matchDesc || matchCategory || matchTags) {
        result.push({
          name: skill.name,
          description: skill.description,
          category: skill.category,
          tags: skill.tags,
          version: skill.version,
        });
      }
    }
    return result;
  }

  public getCount(): number {
    return this.skillsMap.size;
  }
}
