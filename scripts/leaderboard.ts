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
  judged_at?: string;
}

interface AgentMeta {
  agent: string;
  model: string;
  effort: string;
  started_at: string;
  completed_at: string;
  duration_seconds: number;
}

interface Scores {
  correctness: number;
  code_quality: number;
  robustness: number;
  design: number;
  comprehension: number;
  total: number;
}

function avgScores(judgments: Judgment[]): Scores {
  const avg = (field: keyof Judgment) =>
    judgments.reduce((sum, s) => sum + (s[field] as number), 0) /
    judgments.length;
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    correctness: round(avg("correctness")),
    code_quality: round(avg("code_quality")),
    robustness: round(avg("robustness")),
    design: round(avg("design")),
    comprehension: round(avg("comprehension")),
    total: round(avg("total")),
  };
}

interface TaskResult {
  taskId: string;
  judges: string[];
  agents: { agent: string; scores: Scores; meta?: AgentMeta }[];
}

async function main() {
  const runsDir = join(__dirname, "..", "runs");
  const resultsDir = join(__dirname, "..", "results");

  // Collect per-task data: taskId -> agent -> judge -> Judgment
  const taskData = new Map<
    string,
    Map<string, Map<string, Judgment>>
  >();
  // Collect per-task meta: taskId -> agent -> AgentMeta
  const taskMeta = new Map<string, Map<string, AgentMeta>>();

  const dates = await readdir(runsDir).catch(() => []);
  for (const date of dates) {
    if (date.startsWith(".")) continue;
    const datePath = join(runsDir, date);
    const tasks = await readdir(datePath).catch(() => []);

    for (const task of tasks) {
      if (task.startsWith(".")) continue;
      const taskId = `${date}/${task}`;
      const taskPath = join(datePath, task);

      // Read agent meta.json files
      const taskEntries = await readdir(taskPath).catch(() => []);
      for (const entry of taskEntries) {
        if (entry.startsWith(".") || entry === "judgments") continue;
        const metaPath = join(taskPath, entry, "meta.json");
        try {
          const metaContent = await readFile(metaPath, "utf-8");
          const meta: AgentMeta = JSON.parse(metaContent);
          if (!taskMeta.has(taskId)) taskMeta.set(taskId, new Map());
          taskMeta.get(taskId)!.set(entry, meta);
        } catch {
          // meta.json not found, skip
        }
      }

      const judgmentsPath = join(taskPath, "judgments");
      const agentDirs = await readdir(judgmentsPath).catch(() => []);

      for (const agentName of agentDirs) {
        if (agentName.startsWith(".")) continue;
        const agentJudgmentsPath = join(judgmentsPath, agentName);
        const judgeFiles = await readdir(agentJudgmentsPath).catch(() => []);

        for (const file of judgeFiles) {
          if (!file.endsWith(".json")) continue;
          const judgeName = file.replace(".json", "");
          const content = await readFile(
            join(agentJudgmentsPath, file),
            "utf-8"
          );
          const judgment: Judgment = JSON.parse(content);

          if (!taskData.has(taskId)) taskData.set(taskId, new Map());
          const agentMap = taskData.get(taskId)!;
          if (!agentMap.has(agentName)) agentMap.set(agentName, new Map());
          agentMap.get(agentName)!.set(judgeName, judgment);
        }
      }
    }
  }

  // Build per-task results
  const taskResults: TaskResult[] = [];
  // For overall aggregation: agent -> all judgments
  const overallAgents = new Map<string, Judgment[]>();
  // For overall: agent -> model/effort from first meta found
  const overallMeta = new Map<string, { model?: string; effort?: string }>();

  for (const [taskId, agentMap] of taskData) {
    const judges = new Set<string>();
    const agents: { agent: string; scores: Scores }[] = [];

    for (const [agentName, judgeMap] of agentMap) {
      const judgments = [...judgeMap.values()];
      for (const j of judgeMap.keys()) judges.add(j);

      const meta = taskMeta.get(taskId)?.get(agentName);
      agents.push({ agent: agentName, scores: avgScores(judgments), ...(meta ? { meta } : {}) });

      if (!overallAgents.has(agentName)) overallAgents.set(agentName, []);
      overallAgents.get(agentName)!.push(...judgments);
      if (meta && !overallMeta.has(agentName)) {
        overallMeta.set(agentName, { model: meta.model, effort: meta.effort });
      }
    }

    agents.sort((a, b) => b.scores.total - a.scores.total);
    taskResults.push({
      taskId,
      judges: [...judges].sort(),
      agents,
    });
  }

  // Build overall leaderboard
  const overall = [...overallAgents.entries()]
    .map(([agent, judgments]) => ({
      agent,
      ...overallMeta.get(agent),
      tasks: new Set(
        taskResults
          .filter((t) => t.agents.some((a) => a.agent === agent))
          .map((t) => t.taskId)
      ).size,
      ...avgScores(judgments),
    }))
    .sort((a, b) => b.total - a.total)
    .map((entry, i) => ({ rank: i + 1, ...entry }));

  const result = {
    updated: new Date().toISOString().split("T")[0],
    tasks_evaluated: taskData.size,
    overall,
    tasks: taskResults,
  };

  const jsonStr = JSON.stringify(result, null, 2) + "\n";
  await writeFile(join(resultsDir, "leaderboard.json"), jsonStr);
  await writeFile(join(__dirname, "..", "docs", "leaderboard.json"), jsonStr);

  // Print overall
  console.log("\n## Overall\n");
  console.log(
    "| Rank | Agent | Tasks | Correctness | Quality | Robustness | Design | Comprehension | Total |"
  );
  console.log("|---:|---|---:|---:|---:|---:|---:|---:|---:|");
  for (const e of overall) {
    console.log(
      `| ${e.rank} | ${e.agent} | ${e.tasks} | ${e.correctness} | ${e.code_quality} | ${e.robustness} | ${e.design} | ${e.comprehension} | **${e.total}** |`
    );
  }

  // Print per-task
  for (const t of taskResults) {
    console.log(`\n## ${t.taskId}\n`);
    console.log(`Judges: ${t.judges.join(", ")}\n`);
    console.log(
      "| Agent | Correctness | Quality | Robustness | Design | Comprehension | Total |"
    );
    console.log("|---|---:|---:|---:|---:|---:|---:|");
    for (const a of t.agents) {
      console.log(
        `| ${a.agent} | ${a.scores.correctness} | ${a.scores.code_quality} | ${a.scores.robustness} | ${a.scores.design} | ${a.scores.comprehension} | **${a.scores.total}** |`
      );
    }
  }

  console.log(`\n*Updated: ${result.updated}*\n`);
}

main().catch(console.error);
