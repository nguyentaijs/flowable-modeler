// package.json is part of the extension's security and behaviour: these tests keep the decisions made there from being undone.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const settings = pkg.contributes.configuration.properties;

test('settings that start a program or choose where the database password goes are ignored from an untrusted workspace, but not from a trusted one', () => {
  const restricted = pkg.capabilities.untrustedWorkspaces.restrictedConfigurations;
  for (const name of ['host', 'port', 'container', 'dockerPath', 'dbCommand']) {
    const key = `flowableModeler.run.${name}`;
    assert.ok(restricted.includes(key), key);
    // machine scope would make VS Code ignore a trusted workspace's .vscode/settings.json too (the credentials "do not stick")
    assert.notEqual(settings[key]?.scope, 'machine', key);
  }
});

test('untrusted workspaces: supported in a limited way, virtual workspaces are not', () => {
  assert.equal(pkg.capabilities.untrustedWorkspaces.supported, 'limited');
  assert.ok(pkg.capabilities.untrustedWorkspaces.description);
  assert.equal(pkg.capabilities.virtualWorkspaces, false);
});

test('decision lookup scope: workspace by default, every scope documented', () => {
  const scope = settings['flowableModeler.decisionScope'];
  assert.equal(scope.default, 'workspace');
  assert.deepEqual([...scope.enum].sort(), ['path', 'sameFolder', 'workspace']);
  assert.equal(scope.enumDescriptions.length, scope.enum.length);
  assert.equal(settings['flowableModeler.decisionPath'].default, '.');
});

test('every command in the manifest is registered by the extension', () => {
  const source = fs.readdirSync(new URL('../../src/extension/', import.meta.url)).map((f) => fs.readFileSync(new URL('../../src/extension/' + f, import.meta.url), 'utf8')).join('\n');
  for (const { command, title } of pkg.contributes.commands) {
    assert.ok(source.includes(`'${command}'`), `${command} (${title}) has no registration`);
    assert.match(title, /^Flowable: /, command);
  }
});
