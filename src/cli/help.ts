/**
 * 도움말 글자. 사람과 AI 에이전트가 함께 읽으므로 짧게 쓴다.
 */
import { COMMANDS } from './args';
import { DEFAULT_SERVER } from './room';

export const HELP_TEXT = `modelll - read and write Chen-notation ER diagrams on modelll as text

Usage:
  ${COMMANDS.new.usage}
      Create a room from a model file (stdin with "-", empty when omitted) and print its URL.
  ${COMMANDS.pull.usage}
      Print the room's diagram as model text, or write it to a file.
  ${COMMANDS.push.usage}
      Make the room match the model file. People who have the room open see the change live.
      Shapes that stay keep their position; --relayout arranges everything again.
  ${COMMANDS.validate.usage}
      Check a model file without contacting a server. Exits 1 on a syntax error or a validation error.
  ${COMMANDS.syntax.usage}
      Print a reference of the model text format.
  modelll help | --help        Show this help.
  modelll --version            Show the version.

<room> is a room URL (${DEFAULT_SERVER}/r/abc123) or a bare room id.

AI clients that speak MCP can use the same diagrams without this CLI: add the remote MCP server
${DEFAULT_SERVER}/mcp to the client (or <your server>/mcp when self-hosting).

Options:
  --server <url>   Server for bare room ids and "new". Default: $MODELLL_SERVER, then ${DEFAULT_SERVER}.
  --json           Print the result of new, push and validate as JSON.
  --lang <ko|en>   Language of validation messages. Default: $MODELLL_LANG, then $LANG (Korean if it starts with "ko").

Exit status: 0 on success, 1 on failure (syntax error, validation error, network or server error), 2 on wrong usage.
`;
