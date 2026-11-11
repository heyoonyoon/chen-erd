import { describe, expect, it } from 'vitest';
import { parseCliArgs } from './args';
import { CliError } from './errors';

const NO_OPTIONS = { server: undefined, title: undefined, output: undefined, relayout: false, json: false, lang: undefined };

function usageError(argv: string[]): string {
  try {
    parseCliArgs(argv);
  } catch (err) {
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).exitCode).toBe(2);
    return (err as CliError).message;
  }
  throw new Error(`오류가 나지 않음: ${argv.join(' ')}`);
}

describe('parseCliArgs', () => {
  it('인자가 없거나 help, --help, -h면 도움말이다', () => {
    for (const argv of [[], ['help'], ['--help'], ['-h'], ['push', '--help']]) {
      expect(parseCliArgs(argv).command, argv.join(' ')).toBe('help');
    }
  });

  it('--version과 -v는 버전이다', () => {
    expect(parseCliArgs(['--version']).command).toBe('version');
    expect(parseCliArgs(['-v']).command).toBe('version');
  });

  it('명령과 위치 인자, 옵션을 나눈다', () => {
    expect(parseCliArgs(['new'])).toEqual({ command: 'new', args: [], options: NO_OPTIONS });
    expect(parseCliArgs(['new', 'a.mdl', '--title', '수강 신청', '--json'])).toEqual({
      command: 'new',
      args: ['a.mdl'],
      options: { ...NO_OPTIONS, title: '수강 신청', json: true },
    });
    expect(parseCliArgs(['pull', 'abc123', '-o', 'out.mdl', '--server', 'http://localhost:8787'])).toEqual({
      command: 'pull',
      args: ['abc123'],
      options: { ...NO_OPTIONS, output: 'out.mdl', server: 'http://localhost:8787' },
    });
    expect(parseCliArgs(['push', '--relayout', 'https://modelll.app/r/abc123', 'a.mdl'])).toEqual({
      command: 'push',
      args: ['https://modelll.app/r/abc123', 'a.mdl'],
      options: { ...NO_OPTIONS, relayout: true },
    });
    expect(parseCliArgs(['validate', 'a.mdl', '--lang', 'ko']).options.lang).toBe('ko');
    expect(parseCliArgs(['syntax'])).toEqual({ command: 'syntax', args: [], options: NO_OPTIONS });
  });

  it("'-'는 표준 입력을 뜻하는 위치 인자다", () => {
    expect(parseCliArgs(['new', '-']).args).toEqual(['-']);
    expect(parseCliArgs(['push', 'abc123', '-']).args).toEqual(['abc123', '-']);
    expect(parseCliArgs(['validate', '-']).args).toEqual(['-']);
  });

  it('모르는 명령과 옵션을 알린다', () => {
    expect(usageError(['pulll', 'abc'])).toContain('unknown command "pulll"');
    // MCP 서버는 CLI에 없다(서버의 /mcp를 쓴다)
    expect(usageError(['mcp'])).toContain('unknown command "mcp"');
    expect(usageError(['pull', 'abc', '--force'])).toContain('--force');
  });

  it('위치 인자의 수가 맞지 않으면 사용법을 알린다', () => {
    expect(usageError(['pull'])).toBe('usage: modelll pull <room> [-o file]');
    expect(usageError(['push', 'abc123'])).toBe('usage: modelll push <room> <file|-> [--relayout]');
    expect(usageError(['new', 'a.mdl', 'b.mdl'])).toContain('usage: modelll new');
    expect(usageError(['validate'])).toContain('usage: modelll validate');
    expect(usageError(['syntax', 'extra'])).toContain('usage: modelll syntax');
  });

  it('그 명령에 없는 옵션은 받지 않는다', () => {
    expect(usageError(['pull', 'abc123', '--relayout'])).toContain('--relayout is not an option of "pull"');
    expect(usageError(['push', 'abc123', 'a.mdl', '--title', 'x'])).toContain('--title is not an option of "push"');
    expect(usageError(['new', '-o', 'x'])).toContain('--output is not an option of "new"');
    expect(usageError(['validate', 'a.mdl', '--server', 'http://x'])).toContain('--server is not an option of "validate"');
  });
});
