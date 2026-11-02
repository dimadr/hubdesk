const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const sourceRoot = process.env.HUBDESK_REGRESSION_SOURCE_ROOT || root;
const frontendRequire = createRequire(path.join(root, 'frontend/package.json'));
const React = frontendRequire('react');
const { renderToStaticMarkup } = frontendRequire('react-dom/server');
const ts = frontendRequire('typescript');
const filename = path.join(sourceRoot, 'frontend/src/App.tsx');
const source = fs.readFileSync(filename, 'utf8');
const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const statement = ast.statements.find(node => ts.isVariableStatement(node)
  && node.declarationList.declarations.some(declaration => declaration.name.getText(ast) === 'TicketDetailModal'));
assert.ok(statement, 'Ticket detail component must exist');
const { outputText } = ts.transpileModule(statement.getText(ast), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  fileName: filename,
});
const component = vm.runInNewContext(`${outputText}\nTicketDetailModal;`, {
  React, useState: React.useState, useEffect: React.useEffect,
  isoToLocalDate: () => '', TicketChecklist: () => null,
});
const ticket = { id: 100, number: 1000, subject: 'Status regression', body: '', status: 'ASSIGNED',
  priority: 'medium', assignee_id: 101, created_at: '2026-11-02T10:00:00Z' };

function render(overrides = {}, props = {}) {
  return renderToStaticMarkup(React.createElement(component, {
    ticket: { ...ticket, ...overrides }, role: 'dispatcher', currentUserId: 101,
    onClose() {}, onStatusChange() {}, ...props,
  }));
}
function hasAction(html) { return html.includes('btn btn-success'); }

for (const [status, target] of [['ASSIGNED', 'ACCEPTED'], ['ACCEPTED', 'IN_PROGRESS'], ['IN_PROGRESS', 'COMPLETED']]) {
  test(`personal dispatcher sees ${status} -> ${target} from server capabilities`, () => {
    assert.ok(hasAction(render({ status, allowed_statuses: [target] })));
  });
}
test('another dispatcher with no execution permission has no action', () => {
  assert.ok(!hasAction(render({ allowed_statuses: [] })));
});
test('explicit denial overrides privileged client role', () => {
  const html = render({ allowed_statuses: [] }, { role: 'admin' });
  assert.ok(!hasAction(html));
  assert.ok(html.includes('Указать срок'), 'deadline editing must not depend on available status transitions');
});
test('read-only archive suppresses actions even when server permits transition', () => {
  assert.ok(!hasAction(render({ allowed_statuses: ['ACCEPTED'] }, { readOnly: true })));
});
test('legacy server preserves assigned engineer and administrator actions', () => {
  assert.ok(hasAction(render({}, { role: 'engineer' })));
  assert.ok(hasAction(render({}, { role: 'admin' })));
  assert.ok(!hasAction(render({}, { role: 'dispatcher' })));
});
test('completed ticket cannot be advanced but administrator keeps deadline editing', () => {
  const html = render({ status: 'COMPLETED', allowed_statuses: [] }, { role: 'admin' });
  assert.ok(!hasAction(html));
  assert.ok(html.includes('Указать срок'));
});
