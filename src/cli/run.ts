/**
 * 인자를 풀어 명령을 실행하고 종료 코드를 돌려준다. 프로세스를 직접 건드리지 않아 테스트에서 그대로 부를 수 있다.
 */
import { version } from '../../package.json';
import { parseCliArgs } from './args';
import { runNew, runPull, runPush, runSyntax, runValidate, type CliIo } from './commands';
import { CliError } from './errors';
import { HELP_TEXT } from './help';

export const CLI_VERSION: string = version;

export async function runCli(argv: string[], io: CliIo): Promise<number> {
  try {
    const { command, args, options } = parseCliArgs(argv);
    switch (command) {
      case 'help':
        io.out(HELP_TEXT.replace(/\n+$/, ''));
        return 0;
      case 'version':
        io.out(`modelll ${CLI_VERSION}`);
        return 0;
      case 'new':
        return await runNew(io, args, options);
      case 'pull':
        return await runPull(io, args, options);
      case 'push':
        return await runPush(io, args, options);
      case 'validate':
        return await runValidate(io, args, options);
      case 'syntax':
        return runSyntax(io);
      case 'mcp': {
        // MCP 서버에 필요한 코드는 크다. 다른 명령이 느려지지 않도록 이 명령을 쓸 때만 읽는다
        const { runMcp } = await import('./mcp');
        return await runMcp(io, options);
      }
    }
  } catch (err) {
    if (err instanceof CliError) {
      io.err(`error: ${err.message}`);
      return err.exitCode;
    }
    // 예상하지 못한 오류도 한 줄로 알리고 끝낸다
    io.err(`error: ${(err as Error)?.message ?? String(err)}`);
    return 1;
  }
}
