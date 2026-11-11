/**
 * 명령줄 인자를 명령과 옵션으로 푸는 순수 함수. 잘못 적은 명령은 CliError(종료 코드 2)로 알린다.
 */
import { parseArgs } from 'node:util';
import { CliError } from './errors';

export type CommandName = 'new' | 'pull' | 'push' | 'validate' | 'syntax' | 'help' | 'version';

export interface CliOptions {
  /** --server: 방 id만 적었을 때와 new에서 쓸 서버 */
  server?: string;
  /** --title: new에서 제목을 넣거나 바꾼다 */
  title?: string;
  /** -o, --output: pull 결과를 쓸 파일 */
  output?: string;
  /** --relayout: push에서 전체를 다시 배치한다 */
  relayout: boolean;
  /** --json: 결과를 JSON 한 덩어리로 낸다 */
  json: boolean;
  /** --lang: 검증 결과의 언어(ko, en) */
  lang?: string;
}

export interface ParsedArgs {
  command: CommandName;
  /** 명령 뒤에 온 위치 인자 */
  args: string[];
  options: CliOptions;
}

interface CommandSpec {
  /** 위치 인자의 최소, 최대 개수 */
  min: number;
  max: number;
  /** 사용법 한 줄 */
  usage: string;
  /** 이 명령에서만 뜻이 있는 옵션 */
  options: Array<'server' | 'title' | 'output' | 'relayout'>;
}

export const COMMANDS: Record<Exclude<CommandName, 'help' | 'version'>, CommandSpec> = {
  new: { min: 0, max: 1, usage: 'modelll new [file|-] [--title T]', options: ['server', 'title'] },
  pull: { min: 1, max: 1, usage: 'modelll pull <room> [-o file]', options: ['server', 'output'] },
  push: { min: 2, max: 2, usage: 'modelll push <room> <file|-> [--relayout]', options: ['server', 'relayout'] },
  validate: { min: 1, max: 1, usage: 'modelll validate <file|->', options: [] },
  syntax: { min: 0, max: 0, usage: 'modelll syntax', options: [] },
};

const SPECIFIC_OPTIONS = ['server', 'title', 'output', 'relayout'] as const;

function isCommand(name: string): name is keyof typeof COMMANDS {
  return Object.hasOwn(COMMANDS, name);
}

export function parseCliArgs(argv: string[]): ParsedArgs {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        server: { type: 'string' },
        title: { type: 'string' },
        output: { type: 'string', short: 'o' },
        relayout: { type: 'boolean' },
        json: { type: 'boolean' },
        lang: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    });
  } catch (err) {
    throw new CliError(`${(err as Error).message} (run "modelll help")`, 2);
  }
  const { values, positionals } = parsed;
  const options: CliOptions = {
    server: values.server,
    title: values.title,
    output: values.output,
    relayout: values.relayout === true,
    json: values.json === true,
    lang: values.lang,
  };

  if (values.help) return { command: 'help', args: [], options };
  if (values.version) return { command: 'version', args: [], options };
  const [name, ...args] = positionals;
  if (name === undefined || name === 'help') return { command: 'help', args: [], options };
  if (name === 'version') return { command: 'version', args: [], options };
  if (!isCommand(name)) throw new CliError(`unknown command "${name}" (run "modelll help")`, 2);

  const spec = COMMANDS[name];
  if (args.length < spec.min || args.length > spec.max) throw new CliError(`usage: ${spec.usage}`, 2);
  for (const option of SPECIFIC_OPTIONS) {
    const given = option === 'relayout' ? options.relayout : options[option] !== undefined;
    if (given && !spec.options.includes(option)) {
      throw new CliError(`--${option} is not an option of "${name}" (usage: ${spec.usage})`, 2);
    }
  }
  return { command: name, args, options };
}
