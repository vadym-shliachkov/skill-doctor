## Block and edge types

The diagram is a classic algorithm flowchart: one Start, a top-to-bottom flow of actions and yes/no decisions, one or more Ends. Files sit beside the flow.

### Blocks

| Kind | Shape | Use for | Extra fields |
|---|---|---|---|
| `start` | oval | The single entry point. Label "Start", or how the unit is invoked ("/price-card <card>", "Spawned by /price-set") | — |
| `end` | oval | Every point where the run finishes: normal end, a stop for good, an abort | — |
| `io` | parallelogram | Only the unit's own inputs (arguments, flags, the task it is given) right after Start, and the result it hands back right before an End | `direction`: `in` or `out` |
| `process` | rectangle | One action. A script run is a process with `command`. A point where the unit asks the user is a process with `user: true`, followed by a decision on the answer | `command`, `user`, `loads` (instruction files read at this step), `table` / `list` (`{ "file"?, "lines": [a, b] }`: a table or list in the text this step works through) |
| `decision` | diamond | A yes/no question on a flag, mode, state or answer; the label is the question ("Verdict exists?") | label both outgoing `flow` edges; `table` / `list` as for `process` |
| `subprocess` | box with double side bars | A call to an agent, a skill or a command. Its insides are drawn in its own flowchart, never here | `target` exactly as written (for a group: what runs the branches), `calls`: `agent`, `skill`, `command` or `function` (a stage of a script pipeline: `target` is `"<path>#<function>"`); `targets` (each branch as written, or `{ "target", "role" }`); `parallel`, `count`; `table` / `list` |
| `storage` | cylinder | A file read or written as data | `path` as written, `holds`: what the file contains (at most 120 characters); `schema` (path of a JSON schema for the file) or `fields` (`[{ "name", "holds" }]`, at most 30) |

### Edges

| Kind | From | To | Label |
|---|---|---|---|
| `flow` | start, io, process, decision, subprocess | io, process, decision, subprocess, end | Required on both exits of a decision ("yes" / "no"); otherwise optional |
| `reads` | storage | process, decision, subprocess | Required: what is read, at most 40 characters ("mode, horizons") |
| `writes` | process, subprocess | storage | Required: what is written, at most 40 characters ("final verdict") |

### Rules the validator enforces

1. Exactly one `start`, with one outgoing `flow` and none incoming.
2. At least one `end`; nothing flows out of an `end`.
3. A `decision` has exactly two outgoing `flow` edges with different labels. Write a three-way branch as two decisions.
4. `io`, `process` and `subprocess` have exactly one outgoing `flow`. Work that runs in parallel is one `subprocess` with `parallel: true`.
5. Every block on the flow is reachable from `start` and leads to an `end`.
6. A loop is a decision whose exit points back to an earlier block.
7. A `storage` block has at least one `reads` or `writes` edge and never a `flow` edge.
8. A `table` range holds a Markdown table (header row, `|---|` row, at least one row), a `list` range only list items; both at most 200 lines, inside the file.
9. A `schema` resolves to a JSON schema with `properties`.
10. A `subprocess` with `calls: "function"` names each function as `<path>#<function>`.

Any other combination is rejected.
