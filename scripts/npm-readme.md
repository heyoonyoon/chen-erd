# modelll

Command-line client for [modelll](https://modelll.app), a real-time collaborative editor for Chen-notation ER diagrams.

A diagram lives in a room with a shareable URL. This tool reads and writes a room as plain text without coordinates: the server places new shapes automatically and keeps the positions people have already arranged, and everyone who has the room open in a browser sees each change live. No account is needed.

Requires Node.js 20 or newer.

## Use it from an AI assistant

There are two ways to let an assistant draw and edit diagrams.

**CLI.** An assistant that can run commands, such as Claude Code, Cursor or Codex, can use this tool directly. Ask it to run `npx -y modelll syntax` to learn the text format, then to create or change a diagram with `new`, `pull` and `push` (see [Commands](#commands)).

**MCP.** There is nothing to install: modelll hosts a remote MCP server (Streamable HTTP, no sign-in). In a client that supports remote MCP servers, such as claude.ai, ChatGPT or Cursor, add this URL as a remote MCP server or connector:

```
https://modelll.app/mcp
```

In a client that registers servers from the command line, pass the same URL. In Claude Code:

```sh
claude mcp add --transport http modelll https://modelll.app/mcp
```

The MCP server offers these tools:

| Tool | What it does |
| --- | --- |
| `create_diagram` | Create a new diagram from text and return its URL |
| `read_diagram` | Return an existing diagram as text |
| `update_diagram` | Replace a diagram's content with the given full text |
| `validate_diagram` | Check text for syntax and notation problems without saving |
| `diagram_syntax` | Return the full text-format reference |

## Commands

```sh
npx modelll new model.mdl               # create a room from a file and print its URL
npx modelll pull <room> -o model.mdl    # save the room's diagram as text
npx modelll push <room> model.mdl       # make the room match the file
npx modelll validate model.mdl          # check a file without contacting a server
npx modelll syntax                      # print the text-format reference
```

`<room>` is a room URL such as `https://modelll.app/r/abc123`, or the bare id from it. `push` keeps the position of shapes that stay; `--relayout` arranges everything again. Use `-` instead of a file name to read from stdin, and `--json` for machine-readable results.

Install it globally with `npm install -g modelll` to run `modelll` without `npx`.

## Text format

One statement per line. `modelll syntax` prints the complete reference.

```text
title "Company"

entity Employee {
  id key                       # key attribute (underlined)
  name { first, last }         # composite attribute
  phone multi                  # multivalued attribute
}
entity Department { code key, name }
entity Secretary { typing_speed }
entity Engineer { field }
weak entity Dependent { name partial }      # partial key of a weak entity

relationship works_in (Employee N total, Department 1) { since }
relationship manages (Employee 1 as boss, Employee N as report)
identifying relationship has (Employee 1, Dependent N total)

specialization Employee disjoint total { Secretary, Engineer }

note "Draft"
```

## Options

| Option | Meaning |
| --- | --- |
| `--server <url>` | Server to use for bare room ids and `new`. Default: `$MODELLL_SERVER`, then `https://modelll.app` |
| `--json` | Print the result of `new`, `push` and `validate` as JSON |
| `--lang <ko\|en>` | Language of validation messages. Default: `$MODELLL_LANG`, then `$LANG` |

modelll is open source and can be self-hosted; point `--server` at your own instance.

## License

MIT
