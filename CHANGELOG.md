# Changelog

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
