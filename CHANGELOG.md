# Changelog

## 0.1.6
- Security: the database settings that start a program or choose the server (`run.host`, `run.port`, `run.container`, `run.dockerPath`, `run.dbCommand`) are machine settings and are no longer read from a workspace's `.vscode/settings.json`; the extension declares limited support for untrusted workspaces. Move them to your user settings if you had them in a workspace.
- The webview nonce comes from a cryptographic random source.
- DMN editor: an edit made just before the tab is closed or hidden is no longer lost.
- `run.dbCommand` is split with a real tokenizer (quotes, `\"`, Windows paths); an unclosed quote is reported.
- DMN editor: an emptied input cell is written as the wildcard `<![CDATA[-]]>` and shown with `-` as placeholder; `collection` is a column type; input and output cells get type-based suggestions (operators, `date:toDate('...')`, `${expression}`), and the operator of a cell with a value can be changed from a list.
- DMN editor: decision id, name, hit policy and aggregation share one line.
- Command "Flowable: Configure Lookup Scope (Used By)" (Ctrl+Shift+P) picks the scope and, for `path`, the folder.
- New settings `flowableModeler.decisionScope` (`workspace` default, `sameFolder`, `path`) and `flowableModeler.decisionPath`: which .dmn files a .bpmn file may refer to. Used by "Used by", the missing-decision warning, Open decision and the run view, so identical copies in other folders no longer collide.

## 0.1.5
- An empty .bpmn or .dmn file is filled with a starting model when it is opened: only the essential Flowable namespaces and attributes (taken from the engine's own converters), one process with a start event, or one decision table. The file name gives the id.
- Commands "Flowable: New BPMN File" and "Flowable: New DMN File" (also in the Explorer folder menu): ask for a name, create the file with the starting model and open it in the visual editor.

## 0.1.4
- Run view: a service task field that is an expression such as `${applicationData.profileId}` shows the value it comes to (final variable values; plain variable paths only), with the expression underneath. Each value has a Copy button.

## 0.1.3
- Run view: connect straight to a MySQL or PostgreSQL database by host and port (settings `flowableModeler.run.host` and `run.port`), no Docker needed. Connections are read-only; the drivers are bundled.
- Run view: variables, call activity parameters and service task fields are shown one table per item (name as header, value below).

## 0.1.2
- Run view: removed the outcome tag from the banner (it was specific to one decision model); "Contact the author" link added to the banner.
- README shortened to requirements, features, commands, settings, validators, contact and contributing.
- Run view: clicking a script task lists its output variables (names from `resultVariable` and `setVariable` calls, plus variables written while it ran), with final values.
- Run view: clicking a service task lists its output variables; when none are found it shows the implementation and field inputs instead.
- Run view: clicking a call activity lists its in and out parameters with the values in the called and calling process.
- Run view: the detail panel can be resized and the instance tree can be hidden.

## 0.1.1
- Run view: Java-serialized variables (Groovy maps and lists) are now decoded and shown as JSON instead of "cannot be decoded".
- Run commands use the BPMN open in the visual editor; one shared "Flowable Modeler" output channel; the run panel keeps its state when hidden.
- "Contact the author" link in the editors and README.

## 0.1.0
- Run visualization: configure the Flowable database (MySQL by default, or PostgreSQL, through `docker exec`) and draw the latest process run on its diagram, including called processes, DMN inputs/results and matched rule rows.
- Settings `flowableModeler.run.*`; commands "Configure Database Connection", "Set Database Password", "Visualize Latest Run", "Visualize a Run...".
- `.vsix` packaging (`npm run package`).

## 0.0.1
- BPMN editor, DMN editor, diagnostics, decision navigation, "Used by".
