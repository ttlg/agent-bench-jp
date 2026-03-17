#!/usr/bin/env node

import { program } from 'commander';
import * as fs from 'fs';
import * as path from 'path';

interface Options {
  ext?: string;
  sort?: boolean;
  total?: boolean;
}

interface FileStats {
  filePath: string;
  lineCount: number;
}

function countLines(filePath: string): number {
  const content = fs.readFileSync(filePath, 'utf-8');
  return content.split('\n').length;
}

function getFiles(dirPath: string, options: Options, fileList: string[] = []): string[] {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') {
      continue;
    }

    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      getFiles(fullPath, options, fileList);
    } else {
      if (options.ext) {
        const ext = options.ext.startsWith('.') ? options.ext : `.${options.ext}`;
        if (path.extname(entry.name) === ext) {
          fileList.push(fullPath);
        }
      } else {
        fileList.push(fullPath);
      }
    }
  }

  return fileList;
}

function run() {
  program
    .name('lc')
    .description('Count lines of code in a directory')
    .argument('[dir]', 'Directory path', '.')
    .option('--ext <extension>', 'Filter by file extension (e.g., .ts)')
    .option('--sort', 'Sort by line count descending')
    .option('--total', 'Show total line count')
    .action((dir, options: Options) => {
      const targetDir = path.resolve(process.cwd(), dir);
      
      if (!fs.existsSync(targetDir)) {
        console.error(`Error: Directory ${dir} does not exist.`);
        process.exit(1);
      }

      if (!fs.statSync(targetDir).isDirectory()) {
        console.error(`Error: ${dir} is not a directory.`);
        process.exit(1);
      }

      const files = getFiles(targetDir, options);
      const stats: FileStats[] = [];
      let totalLines = 0;

      for (const file of files) {
        try {
          const lines = countLines(file);
          stats.push({
            filePath: path.relative(process.cwd(), file),
            lineCount: lines
          });
          totalLines += lines;
        } catch (error) {
          // ignore unreadable files or binary files
        }
      }

      if (options.sort) {
        stats.sort((a, b) => b.lineCount - a.lineCount);
      }

      // Formatting
      let maxPathLength = 0;
      for (const stat of stats) {
        if (stat.filePath.length > maxPathLength) {
          maxPathLength = stat.filePath.length;
        }
      }

      maxPathLength = Math.max(maxPathLength, 15);

      for (const stat of stats) {
        const pathStr = stat.filePath.padEnd(maxPathLength, ' ');
        const countStr = stat.lineCount.toString().padStart(6, ' ');
        console.log(`${pathStr}  ${countStr}`);
      }

      if (options.total) {
        const separatorLength = maxPathLength + 8;
        console.log('─'.repeat(separatorLength));
        
        const spaces = ' '.repeat(Math.max(0, maxPathLength - 4));
        const countStr = totalLines.toString().padStart(6, ' ');
        console.log(`合計${spaces}  ${countStr}`);
      }
    });

  program.parse();
}

run();