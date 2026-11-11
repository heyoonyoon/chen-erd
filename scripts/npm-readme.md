# modelll

Command-line client and MCP server for [modelll](https://modelll.app), a real-time collaborative editor for Chen-notation ER diagrams.

A diagram lives in a room with a shareable URL. This tool reads and writes a room as plain text without coordinates: the server places new shapes automatically and keeps the positions people have already arranged, and everyone who has the room open in a browser sees each change live. No account is needed.

Requires Node.js 20 or newer.

## Use it from an AI assistant (MCP)

Run it as a local MCP server over stdio:

```sh
claude mcp add modelll -- npx -y modelll mcp
```

For clients configured with JSON:

```json
{
  "mcpServers": {
    "modelll": { "command": "npx", "args": ["-y", "modelll", "mcp"] }
  }
}
```

Or connect to the hosted server, with nothing to install (Streamable HTTP, no sign-in):

```sh
claude mcp add --transport http modelll https://modelll.app/mcp
```

In a client that asks for a server URL (a custom connector, for example), enter `https://modelll.app/mcp`.

Both offer the same tools:

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
npx modelll mcp                         # run the MCP server on stdin/stdout
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
| `--server <url>` | Server to use for bare room ids, `new` and `mcp`. Default: `$MODELLL_SERVER`, then `https://modelll.app` |
| `--json` | Print the result of `new`, `push` and `validate` as JSON |
| `--lang <ko\|en>` | Language of validation messages. Default: `$MODELLL_LANG`, then `$LANG` |

modelll is open source and can be self-hosted; point `--server` at your own instance.

## License

MIT
