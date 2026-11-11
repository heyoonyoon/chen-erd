/**
 * modelll CLI 진입점. 방의 다이어그램을 텍스트로 내려받고(pull) 올린다(push). 'modelll mcp'는 같은 일을 MCP 도구로 내놓는다.
 * 빌드하면 dist/cli/modelll.js 한 파일이 된다.
 * 환경변수: MODELLL_SERVER(기본 https://modelll.app), MODELLL_LANG(검증 결과의 언어. ko 또는 en).
 */
import { promises as fs } from 'node:fs';
import { fileError, type CliIo } from './commands';
import { runCli } from './run';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks).toString('utf8');
}

const io: CliIo = {
  env: process.env,
  out: (text) => void process.stdout.write(`${text}\n`),
  err: (text) => void process.stderr.write(`${text}\n`),
  async readText(file) {
    try {
      const text = file === '-' ? await readStdin() : await fs.readFile(file, 'utf8');
      // 메모장 등이 맨 앞에 붙이는 BOM은 뗀다
      return text.replace(/^﻿/, '');
    } catch (err) {
      throw fileError(file === '-' ? '<stdin>' : file, err);
    }
  },
  async writeText(file, text) {
    try {
      await fs.writeFile(file, text, 'utf8');
    } catch (err) {
      throw fileError(file, err);
    }
  },
  fetch: (url, init) => fetch(url, init),
};

// 받는 쪽이 먼저 닫은 파이프(modelll syntax | head)는 오류가 아니다
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code !== 'EPIPE') throw err;
});

// 출력이 파이프로 다 나간 뒤에 끝나도록 exit를 부르지 않고 종료 코드만 정한다
process.exitCode = await runCli(process.argv.slice(2), io);
