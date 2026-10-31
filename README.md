# Flowable Design Local

Edit **Flowable Community 7.2.0** BPMN and DMN files visually in VS Code, and see how a real process run went on the diagram. Edits are written back as **only what you changed**, so git diffs stay small.

Built for files exported by Flowable Design: it uses JUEL expressions (not FEEL), writes only `flowable:` extension tags, and passes everything else (`design:*` and so on) through untouched. It never creates custom tags or namespaces.

- [BPMN editor](#bpmn-editor) with a Flowable-aware properties panel
- [DMN editor](#dmn-editor) for decision tables, with a "Used by" list
- [Diagnostics](#diagnostics) in the Problems panel
- [Navigation](#navigation) from a DMN task to its decision
- [Run visualization](#run-visualization): the latest process run, read from your Flowable database
- [Minimal diffs](#minimal-diffs): small, reviewable changes in git

## Requirements

- VS Code 1.90 or newer.
- Run visualization only: the **Docker CLI**, and a Flowable history database (MySQL by default, or PostgreSQL) running in a Docker container. DMN rule hits need DMN history to be enabled.
- Everything else works without Docker or a database.

## Getting started

1. Open a `.bpmn`, `.bpmn20.xml` or `.dmn` file. The visual editors are the default for these files. Use *Reopen Editor With… → Text Editor* to see the XML.
2. Edit. Every change is a text edit on the file, so VS Code's undo, redo, save, dirty marker and git diff all work as usual.
3. To see a process run: run **Flowable: Configure Database Connection**, then **Flowable: Visualize Latest Run** (see [Run visualization](#run-visualization)).

## Features

### BPMN editor

For `*.bpmn` and `*.bpmn20.xml`.

- Diagram editor based on bpmn-js, with a properties panel on the right. Drag the divider to resize it; double-click resets it.
- Palette entries for service task, script task, user task, call activity and DMN task.
- DMN tasks (`serviceTask` with `flowable:type="dmn"`) are drawn with the business-rule icon. Their fields show as fixed named values: decision table key, throw error on no hits, fallback to default tenant, same deployment. An **Open ↗** button jumps to the decision table.
- Properties panel groups: General (id and name), Script, Called process (in and out parameters), Sub process, Multi-instance (parallel or sequential), Fields (key/value list for service tasks), Condition and default flow for sequence flows, plus every Flowable attribute of the element, taken from the Flowable 7.2.0 schema.

### DMN editor

For `*.dmn`.

- Decision table grid: hit policy and aggregation, input and output columns (label, expression or result variable, type, allowed values), and rules with a description column.
- Add and remove rules and columns. Reorder rules and columns by dragging the `⋮⋮` grip.
- Rule cells are written as CDATA, like Flowable's own files.
- **Used by**: under each decision, the DMN tasks in the workspace's `.bpmn` files that refer to it. Click an entry to open that process. It updates as files change, including unsaved edits.

### Diagnostics

Problems for BPMN and DMN files appear in the Problems panel as you type. See [Validators](#validators) for what is checked and how to switch a check off.

### Navigation

- **Open ↗** in the properties panel of a DMN task opens its decision. If several `.dmn` files define the same decision id, you pick one.
- **Ctrl+Click** a `decisionTableReferenceKey` value in the XML text of a `.bpmn` to open the decision. **F12** (Go to Definition) jumps to the `<decision>` in the `.dmn` text.
- **Cross-file check**: a DMN task whose `decisionTableReferenceKey` matches no decision id in the workspace's `.dmn` files gets a warning. Files are matched by decision id, never by file name, wherever they are in the workspace.

### Run visualization

Draws a process run from the Flowable database on its diagram. It reads only the history tables (`ACT_HI_*`, `ACT_DMN_HI_DECISION_EXECUTION`, `ACT_RE_PROCDEF`, `ACT_GE_BYTEARRAY`) through `docker exec ... mysql` (or `psql`), so no database driver is needed. It never writes to the database.

1. **Flowable: Configure Database Connection**: engine, container, user and database name. The defaults are the standalone Flowable docker values: MySQL, user `flowable`, database `flowable`, password `flowable`.
2. **Flowable: Set Database Password** if yours differs. It is kept in VS Code's secret storage, never in settings.
3. **Flowable: Visualize Latest Run** (also a button on `.bpmn` editors), or **Flowable: Visualize a Run...** to pick from recent runs. When a `.bpmn` is active, only runs of its process id are considered.

The run view shows:

- An **instance tree** with the parent process and each called process; click one to switch diagrams.
- The **diagram** with executed steps in green, running steps in orange, failed steps in red and steps that were not reached faded. Loops show `xN`, and each task shows its duration.
- A **banner** with status, start, duration and outcome (from the variable `decisionResult`, `bauDecisionResult` or `challengerDecisionResult`), plus **Variables** (final values) and **Open model**.
- **Click a step** for the time of each run. For a DMN task you also get the inputs, the result and the matched rule rows highlighted in the decision table (taken from the workspace's `.dmn`). For a call activity there is a link to the called instance.

The BPMN files of a run are found by process id anywhere in the workspace, or only in `flowableModeler.run.bpmnFolder`. If a process id is defined in several files, the first one found is used.

### Minimal diffs

The editor serializes the diagram, compares it with the file element by element, and applies only the differences as text edits. Parts you didn't touch keep their exact text, including comments, CDATA, ordering and all `design:*` content. Before writing, it checks that the patched text equals what the editor produced; if not, it refuses to write and logs the details to the "Flowable Modeler" output channel.

## Commands

Open the Command Palette (Ctrl+Shift+P) and type "Flowable".

| Command | What it does |
|---|---|
| **Flowable: Configure Database Connection** | Asks for engine, container, user and database name (container names are suggested from `docker ps`), saves them to settings, then tests the connection |
| **Flowable: Set Database Password** | Stores the password in VS Code's secret storage; leave it empty to go back to the default `flowable` |
| **Flowable: Visualize Latest Run** | Opens the newest process run. Also a button in the title bar of `.bpmn` editors |
| **Flowable: Visualize a Run...** | Lists recent runs (id, process, start, running or done) and opens the one you pick |

Other interactions: **Open ↗** (DMN task panel), **Ctrl+Click** and **F12** on a `decisionTableReferenceKey` (see [Navigation](#navigation)).

## Extension settings

Set these in VS Code settings (user, workspace or folder).

| Setting | Type | Default | What it does |
|---|---|---|---|
| `flowableModeler.disabledValidators` | array of strings | `[]` | Names of validators to switch off, for example `["juel-syntax", "dmn-reference"]`. Names are listed under [Validators](#validators). |
| `flowableModeler.passThroughNamespaces` | array of strings | `["design"]` | XML namespace prefixes that are kept as-is and never reported |
| `flowableModeler.run.engine` | `mysql` \| `postgres` | `mysql` | Database engine of the Flowable history |
| `flowableModeler.run.container` | string | `""` | Docker container running the database. Empty: the running database container is detected, and remembered |
| `flowableModeler.run.dbUser` | string | `flowable` | Database user |
| `flowableModeler.run.dbName` | string | `flowable` | Database name |
| `flowableModeler.run.dockerPath` | string | `docker` | Docker CLI to run |
| `flowableModeler.run.dbCommand` | string | `""` | Full command that reads SQL on stdin and prints plain rows. Overrides container, user and name |
| `flowableModeler.run.bpmnFolder` | string | `""` | Workspace folder searched for the run's `.bpmn` files. Empty: the whole workspace |
| `flowableModeler.run.listLimit` | number | `10` | How many runs **Visualize a Run...** lists |

**Database password**: not a setting. It comes from **Flowable: Set Database Password** (secret storage), then the `DB_PASSWORD` environment variable, then the default `flowable`.

Example `settings.json`:

```json
{
  "flowableModeler.run.engine": "mysql",
  "flowableModeler.run.container": "flowable-db",
  "flowableModeler.run.dbUser": "flowable",
  "flowableModeler.run.dbName": "flowable",
  "flowableModeler.run.bpmnFolder": "src/main/resources/processes",
  "flowableModeler.disabledValidators": ["flowable-child-elements"]
}
```

To use a database that is not reached with `docker exec` plus the standard client, give the whole command instead (it must read SQL on stdin and print plain rows):

```json
{
  "flowableModeler.run.dbCommand": "docker exec -i my-db mysql -u flowable -pflowable -N -B -r flowable"
}
```

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
| `juel-syntax` | BPMN | error | `${...}` expressions have balanced brackets, quotes and blocks (condition, loop cardinality, completion condition, timers and attribute values) |
| `dmn-decision-table` | DMN | error / warning | Valid hit policy and aggregation, columns have expressions and names, every rule has one cell per column |
| `dmn-entries` | DMN | warning | Balanced quotes in cells; a literal that is not in the column's allowed values |
| `dmn-reference` | BPMN | warning | A DMN task's `decisionTableReferenceKey` matches a decision id in a workspace `.dmn` file |

## Troubleshooting

The **Flowable Modeler** output channel (View → Output) holds the details: every change sent and applied by the editors (first place to look if an edit is refused: "patched text does not match the modeler output"), and for runs the database command used (password hidden) and any run error.

| Symptom | What to check |
|---|---|
| `cannot start "docker"` | The Docker CLI is not installed or not on PATH; set `flowableModeler.run.dockerPath` |
| "No running database container found" | Start the database container, or set `flowableModeler.run.container` or `flowableModeler.run.dbCommand` |
| Access denied / authentication failed | Run **Flowable: Set Database Password**; check `dbUser` and `dbName` |
| "No process instances found" or "No run of process ... found" | The history tables are empty, or (with a `.bpmn` active) that process has no run; switch to a non-BPMN editor to see the latest run of any process |
| "no .bpmn with process id ... in the workspace" | The run's process is not in the workspace or `bpmnFolder`; the instance is listed but has no diagram |
| DMN task shows no matched rule rows | DMN history is not enabled in the engine, or the `.dmn` file is not in the workspace |
| "Used by (scanning the workspace...)" | The first workspace scan has not finished yet; it fills in by itself |

## Known limitations

- Targets Flowable Community **7.2.0** only. Work-only tags (`static-process-key`, `decisionReferenceType`, `work-form-field-validation`, `is-default-flow`) are not recognised by the engine; they are passed through, never created.
- Camunda attributes are not supported. For example, `asyncBefore` is only read from the Camunda namespace in 7.2.0, so it is not offered.
- Run visualization: sequence flows are inferred from the steps that ran (history does not store them); only final variable values exist; Java-serialized `Map` variables cannot be decoded (a readable `<name>Json` twin or recovered strings are shown instead); the MySQL and PostgreSQL paths are checked against made-up rows only, not yet against a live Flowable database.
- Only decision tables are editable in the DMN editor.

## Roadmap

| Area | Idea |
|---|---|
| Multi-instance | Edit the `flowable:collection` child (class or delegate expression) and variable aggregation |
| BPMN coverage | Boundary and intermediate events, event-based gateway, execution and task listeners, timers |
| DMN | More hit-policy and cell checks, for example overlapping rules under UNIQUE; multiple decisions, item definitions and the decision requirements diagram |
| Navigation | Select the exact DMN task when opening a process from "Used by"; jump from a call activity to its process; warn about the same decision id in several files |
| Validation | Authoritative check with Flowable's own process validator (needs a Java 17 runtime) |
| Tooling | "Strip design:*" command; save and reopen a run without the database |

## Contributing

Build, test, project layout and the extension points are described in `CONTRIBUTING.md` in the source repository.
