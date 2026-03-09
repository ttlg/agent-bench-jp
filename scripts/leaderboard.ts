import { readdir, readFile, writeFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface Judgment {
  correctness: number;
  code_quality: number;
  robustness: number;
  design: number;
  comprehension: number;
  total: number;
  reasoning: string;
  judge?: string;
}

interface AgentScores {
  agent: string;
  tasks: number;
  correctness: number;
  code_quality: number;
  robustness: number;
  design: number;
  comprehension: number;
  total: number;
}

async function main() {
  const runsDir = join(__dirname, "..", "runs");
  const resultsDir = join(__dirname, "..", "results");

  const agents = new Map<string, { scores: Judgment[]; tasks: number }>();

  // Scan all run directories
  const dates = await readdir(runsDir).catch(() => []);
  for (const date of dates) {
    if (date.startsWith(".")) continue;
    const datePath = join(runsDir, date);
    const tasks = await readdir(datePath).catch(() => []);

    for (const task of tasks) {
      if (task.startsWith(".")) continue;
      const judgmentsPath = join(datePath, task, "judgments");
      const files = await readdir(judgmentsPath).catch(() => []);

      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        const agentName = file.replace(".json", "");
        const content = await readFile(join(judgmentsPath, file), "utf-8");
        const judgment: Judgment = JSON.parse(content);

        if (!agents.has(agentName)) {
          agents.set(agentName, { scores: [], tasks: 0 });
        }
        const entry = agents.get(agentName)!;
        entry.scores.push(judgment);
        entry.tasks++;
      }
    }
  }

  // Calculate averages
  const leaderboard: AgentScores[] = [];
  for (const [agent, data] of agents) {
    const avg = (field: keyof Judgment) =>
      data.scores.reduce((sum, s) => sum + (s[field] as number), 0) /
      data.scores.length;

    leaderboard.push({
      agent,
      tasks: data.tasks,
      correctness: Math.round(avg("correctness") * 100) / 100,
      code_quality: Math.round(avg("code_quality") * 100) / 100,
      robustness: Math.round(avg("robustness") * 100) / 100,
      design: Math.round(avg("design") * 100) / 100,
      comprehension: Math.round(avg("comprehension") * 100) / 100,
      total: Math.round(avg("total") * 100) / 100,
    });
  }

  // Sort by total descending
  leaderboard.sort((a, b) => b.total - a.total);

  // Assign ranks
  const result = {
    updated: new Date().toISOString().split("T")[0],
    tasks_evaluated: Math.max(...leaderboard.map((a) => a.tasks)),
    leaderboard: leaderboard.map((entry, i) => ({
      rank: i + 1,
      ...entry,
    })),
  };

  // Write JSON
  await writeFile(
    join(resultsDir, "leaderboard.json"),
    JSON.stringify(result, null, 2) + "\n"
  );

  // Print table
  console.log("\n## Agent Bench JP Leaderboard\n");
  console.log(
    "| Rank | Agent | Tasks | Correctness | Quality | Robustness | Design | Comprehension | Total |"
  );
  console.log(
    "|---:|---|---:|---:|---:|---:|---:|---:|---:|"
  );
  for (const entry of result.leaderboard) {
    console.log(
      `| ${entry.rank} | ${entry.agent} | ${entry.tasks} | ${entry.correctness} | ${entry.code_quality} | ${entry.robustness} | ${entry.design} | ${entry.comprehension} | **${entry.total}** |`
    );
  }
  console.log(
    `\n*Updated: ${result.updated}, ${result.tasks_evaluated} task(s) evaluated.*\n`
  );
}

main().catch(console.error);
