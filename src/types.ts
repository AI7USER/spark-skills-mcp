export interface SkillMetadata {
  name: string;
  description: string;
  category?: string;
  tags?: string[];
  version?: string;
  source?: string;
  fileCount?: number;
  totalSizeBytes?: number;
}

export interface SkillDetail extends SkillMetadata {
  instructions: string;
  supplementaryFiles?: { [relativePath: string]: string };
}
