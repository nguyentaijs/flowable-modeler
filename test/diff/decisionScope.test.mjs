import test from 'node:test';
import assert from 'node:assert/strict';
import { inScope, scopeFolder, describeScope } from '../../src/core/decisionScope.mjs';

const bpmn = '/ws/a/flow/x.bpmn';

test('sameFolder: only the directory of the .bpmn', () => {
  const same = (dmn) => inScope({ scope: 'sameFolder' }, bpmn, dmn);
  assert.ok(same('/ws/a/flow/x.dmn'));
  assert.ok(!same('/ws/b/flow/x.dmn'));
  assert.ok(!same('/ws/a/flow/sub/x.dmn'));
  assert.ok(!same('/ws/a/x.dmn'));
});

test('workspace (default): everything', () => {
  assert.ok(inScope({ scope: 'workspace' }, bpmn, '/ws/b/other/x.dmn'));
  assert.ok(inScope({}, bpmn, '/ws/b/other/x.dmn'), 'no setting = workspace');
});

test('path: relative to the .bpmn folder, subfolders included', () => {
  // [folder setting, .dmn path, expected]
  const cases = [
    ['.', '/ws/a/flow/x.dmn', true],
    ['.', '/ws/a/flow/sub/deep/x.dmn', true],
    ['.', '/ws/a/x.dmn', false],
    ['..', '/ws/a/x.dmn', true],
    ['..', '/ws/a/flow/x.dmn', true],
    ['..', '/ws/b/x.dmn', false],
    ['../dmn', '/ws/a/dmn/x.dmn', true],
    ['../dmn', '/ws/a/dmn2/x.dmn', false], // same prefix, not inside
    ['/ws/shared/', '/ws/shared/x.dmn', true],
    ['/ws/shared', '/ws/sharedother/x.dmn', false],
    ['', '/ws/a/flow/x.dmn', true], // empty = current folder
    ['C:\\proj\\dmn','/C:/proj/dmn/x.dmn', true], // a Windows path, backslashes
  ];
  for (const [path, dmn, expected] of cases) assert.equal(inScope({ scope: 'path', path }, bpmn, dmn), expected, `${path} -> ${dmn}`);
});

test('scopeFolder resolves the folder of a path scope', () => {
  assert.equal(scopeFolder(bpmn, ''), '/ws/a/flow');
  assert.equal(scopeFolder(bpmn, './../dmn/'), '/ws/a/dmn');
  assert.equal(scopeFolder(bpmn, '/ws/x/../shared'), '/ws/shared');
});

test('Windows: paths compare case-insensitively when asked', () => {
  assert.ok(!inScope({ scope: 'sameFolder' }, '/c:/Ws/A/x.bpmn', '/c:/ws/a/x.dmn'));
  assert.ok(inScope({ scope: 'sameFolder', ignoreCase: true }, '/c:/Ws/A/x.bpmn', '/c:/ws/a/x.dmn'));
});

test('describeScope', () => {
  assert.equal(describeScope({}), 'in this workspace');
  assert.equal(describeScope({ scope: 'sameFolder' }), 'in the same folder');
  assert.equal(describeScope({ scope: 'path', path: '../dmn' }), 'in or below "../dmn"');
});
