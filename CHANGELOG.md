# Changelog

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
