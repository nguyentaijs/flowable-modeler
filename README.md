# Flowable Design Local

Edit **Flowable Community 7.2.0** BPMN and DMN files visually in VS Code, and see how a real process run went on the diagram. Edits are written back as **only what you changed**, so git diffs stay small.

Built for files exported by Flowable Design: it uses JUEL expressions (not FEEL), writes only `flowable:` extension tags, and passes everything else (`design:*` and so on) through untouched.

## Requirements

- VS Code 1.90 or newer.
- Run visualization only: a Flowable history database (MySQL by default, or PostgreSQL), reached either directly by host and port, or through a Docker container (needs the **Docker CLI**). DMN rule hits need DMN history to be enabled.
- Everything else works without Docker or a database.

## Features

- **BPMN editor** for `*.bpmn` and `*.bpmn20.xml`: a diagram editor with a resizable, Flowable-aware properties panel (general, script, called process, sub process, multi-instance, fields, conditions and every Flowable attribute of the element). Palette entries for service task, script task, user task, call activity and DMN task.
- **DMN editor** for `*.dmn`: a decision table grid with hit policy, aggregation, input and output columns, allowed values and rules. Add, remove and drag to reorder rules and columns. Cells are written as CDATA. Each decision shows a **Used by** list of the BPMN files that refer to it.
- **New files**: **Flowable: New BPMN File** and **Flowable: New DMN File** create a file and open it. An empty `.bpmn` or `.dmn` file you create yourself is also filled with a starting model (one process with a start event, or one decision table), using only the essential Flowable namespaces and attributes.
- **Diagnostics**: problems for BPMN and DMN files appear in the Problems panel as you type (see [Validators](#validators)).
- **Navigation**: **Open ↗** on a DMN task opens its decision. **Ctrl+Click** or **F12** on a `decisionTableReferenceKey` in the XML does the same. A reference that matches no decision in the workspace gets a warning.
- **Run visualization**: draws the latest process run from your Flowable database on its diagram. It shows an instance tree (called processes included), executed, running, failed and skipped steps, loop counts and durations, the final variables, and for DMN tasks the inputs, the result and the matched rule rows. It only reads the history tables, over a direct connection or through `docker exec`, and never writes to the database.
- **Minimal diffs**: the editor compares its output with the file element by element and applies only the differences as text edits. Comments, CDATA, ordering and `design:*` content you didn't touch stay exactly as they were. VS Code's undo, redo, save and git diff work as usual.

## Commands

Open the Command Palette (Ctrl+Shift+P) and type "Flowable".

| Command | What it does |
|---|---|
| **Flowable: New BPMN File** / **New DMN File** | Asks for a name, creates the file with the starting model in the folder picked in the Explorer (or the active file's folder, or the workspace root) and opens it in the visual editor. Also in the Explorer folder right-click menu |
| **Flowable: Configure Database Connection** | Asks for engine, then a direct connection (host and port) or a Docker container (names suggested from `docker ps`), user and database name, saves them to settings, then tests the connection |
| **Flowable: Set Database Password** | Stores the password in VS Code's secret storage; leave it empty to go back to the default `flowable` |
| **Flowable: Visualize Latest Run** | Opens the newest process run. Also a button in the title bar of `.bpmn` editors |
| **Flowable: Visualize a Run...** | Lists recent runs and opens the one you pick |

## Extension settings

| Setting | Type | Default | What it does |
|---|---|---|---|
| `flowableModeler.disabledValidators` | array of strings | `[]` | Names of validators to switch off, for example `["juel-syntax", "dmn-reference"]` |
| `flowableModeler.passThroughNamespaces` | array of strings | `["design"]` | XML namespace prefixes that are kept as-is and never reported |
| `flowableModeler.run.engine` | `mysql` \| `postgres` | `mysql` | Database engine of the Flowable history |
| `flowableModeler.run.host` | string | `""` | Database host for a direct connection (no Docker). When set, container and Docker CLI settings are ignored |
| `flowableModeler.run.port` | number | `0` | Port for a direct connection. 0: 3306 for MySQL, 5432 for PostgreSQL |
| `flowableModeler.run.container` | string | `""` | Docker container running the database (when no host is set). Empty: the running database container is detected, and remembered |
| `flowableModeler.run.dbUser` | string | `flowable` | Database user |
| `flowableModeler.run.dbName` | string | `flowable` | Database name |
| `flowableModeler.run.dockerPath` | string | `docker` | Docker CLI to run |
| `flowableModeler.run.dbCommand` | string | `""` | Full command that reads SQL on stdin and prints plain rows. Overrides container, user and name |
| `flowableModeler.run.bpmnFolder` | string | `""` | Workspace folder searched for the run's `.bpmn` files. Empty: the whole workspace |
| `flowableModeler.run.listLimit` | number | `10` | How many runs **Visualize a Run...** lists |

The database password is not a setting. It comes from **Flowable: Set Database Password** (secret storage), then the `DB_PASSWORD` environment variable, then the default `flowable`.

## Validators

Switch any of them off with `flowableModeler.disabledValidators`.

| Name | Runs on | Severity | Checks |
|---|---|---|---|
| `unique-ids` | BPMN, DMN | error | Element ids are unique in the document |
| `sequence-flow-refs` | BPMN | error | `sourceRef` and `targetRef` point to existing elements |
| `gateway-flows` | BPMN | error / warning | A gateway's `default` is one of its outgoing flows; other outgoing flows have a condition |
| `required-fields` | BPMN | error / warning | Call activity has `calledElement`; script task has a body; DMN task has `decisionTableReferenceKey` |
| `flowable-attributes` | BPMN | error / info | Flowable attributes are known for the element and have valid boolean or enum values |
| `flowable-child-elements` | BPMN | info | Flowable children of `extensionElements` are in the schema (unknown ones are kept, not validated) |
| `juel-syntax` | BPMN | error | `${...}` expressions have balanced brackets, quotes and blocks |
| `dmn-decision-table` | DMN | error / warning | Valid hit policy and aggregation, columns have expressions and names, every rule has one cell per column |
| `dmn-entries` | DMN | warning | Balanced quotes in cells; a literal that is not in the column's allowed values |
| `dmn-reference` | BPMN | warning | A DMN task's `decisionTableReferenceKey` matches a decision id in a workspace `.dmn` file |

## Contact

Questions, feedback or ideas: [Contact the author](https://www.linkedin.com/in/nguyentaijs). The same link sits in the bottom right corner of the BPMN and DMN editors.

## Contributing

Build, test, project layout and the extension points are described in `CONTRIBUTING.md` in the source repository.
