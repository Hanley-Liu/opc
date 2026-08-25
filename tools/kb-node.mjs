#!/usr/bin/env node
import { readdir, readFile, stat, writeFile, mkdir, appendFile } from "node:fs/promises";
import { join } from "node:path";
import os from "node:os";

const HOME = process.env.HOME || os.homedir();
const KNOWLEDGE_BASE = process.env.KB_DIR || join(HOME, ".config/opencode/knowledge");

const command = process.argv[2];
const query = process.argv.slice(3).join(" ");

if (!command || !query) {
  console.log("Usage: kb search <query> | kb list <category> | kb learn <category> <filename> <content>");
  console.log("Categories: core, projects, patterns, snippets, references");
  process.exit(0);
}

async function searchKnowledge(searchQuery) {
  const results = [];
  
  async function searchDir(dir) {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          await searchDir(fullPath);
        } else if (entry.name.endsWith(".md")) {
          const content = await readFile(fullPath, "utf-8");
          const lines = content.split("\n");
          const matches = [];
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(searchQuery.toLowerCase())) {
              matches.push({
                file: fullPath.replace(KNOWLEDGE_BASE + "/", ""),
                line: i + 1,
                text: lines[i].trim().substring(0, 200)
              });
            }
          }
          if (matches.length > 0) {
            results.push({ file: fullPath, matches });
          }
        }
      }
    } catch {}
  }

  await searchDir(KNOWLEDGE_BASE);
  
  if (results.length === 0) {
    console.log(`No results found for: ${searchQuery}`);
  } else {
    for (const r of results) {
      console.log(`\n--- ${r.file.replace(KNOWLEDGE_BASE + "/", "")} ---`);
      for (const m of r.matches.slice(0, 5)) {
        console.log(`  Line ${m.line}: ${m.text}`);
      }
    }
    console.log(`\nTotal: ${results.length} files matched`);
  }
}

async function listCategory(category) {
  const dir = join(KNOWLEDGE_BASE, category);
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    console.log(`Contents of ${category}/:`);
    for (const entry of entries) {
      if (entry.isDirectory()) {
        console.log(`  [dir] ${entry.name}/`);
      } else {
        console.log(`  ${entry.name}`);
      }
    }
  } catch (e) {
    console.log(`Category ${category} not found. Available: core, patterns, projects, snippets, references`);
  }
}

async function learnKnowledge(category, filename, content) {
  const dir = join(KNOWLEDGE_BASE, category);
  await mkdir(dir, { recursive: true });
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeFilename = filename.replace(/[^a-zA-Z0-9-_]/g, "-");
  const filepath = join(dir, `${safeFilename}.md`);
  
  const fullContent = `---
category: ${category}
created: ${new Date().toISOString()}
---

${content}
`;
  
  await writeFile(filepath, fullContent, "utf-8");
  console.log(`Knowledge written to: knowledge/${category}/${safeFilename}.md`);
}

async function setGithubToken(token) {
  const tokenFile = join(KNOWLEDGE_BASE, "core", "github-token.md");
  const content = `# GitHub Token\n\nToken stored for autonomous GitHub operations.\ngithub_token: ${token}\n`;
  await writeFile(tokenFile, content, "utf-8");
  process.env.GITHUB_TOKEN = token;
  console.log("GitHub token saved to knowledge/core/github-token.md");
}

if (command === "search") {
  await searchKnowledge(query);
} else if (command === "list") {
  await listCategory(query);
} else if (command === "learn") {
  const args = process.argv.slice(3);
  if (args.length < 3) {
    console.log("Usage: kb learn <category> <filename> <content>");
    process.exit(1);
  }
  const cat = args[0];
  const fname = args[1];
  const content = args.slice(2).join(" ");
  await learnKnowledge(cat, fname, content);
} else if (command === "github-token") {
  const token = process.argv[3];
  if (!token) {
    console.log("Usage: kb github-token <your-github-token>");
    process.exit(1);
  }
  await setGithubToken(token);
} else {
  console.log(`Unknown command: ${command}`);
  console.log("Commands: search, list, learn");
}
