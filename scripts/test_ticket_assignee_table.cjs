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

function loadTs(relative, overrides = {}) {
  const filename = path.join(sourceRoot, relative);
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React, esModuleInterop: true }, fileName: filename,
  });
  const module = { exports: {} };
  const requireModule = name => Object.hasOwn(overrides, name) ? overrides[name] : frontendRequire(name);
  vm.runInThisContext(`(function(require,module,exports){${outputText}\n})`, { filename })(requireModule, module, module.exports);
  return module.exports;
}

const wrapper = ({ children }) => children;
const { TableView } = loadTs('frontend/src/components/TicketGrid/TableView.tsx', {
  '../../api/client': { api: {} },
  './RowStyles': { RowStyle: ({ children }) => React.createElement('tr', null, children) },
  '../TicketOverdue': { isTicketOverdue: () => false, TicketOverdue: () => null },
  './ColumnHeader': { ColumnHeader: ({ label }) => React.createElement('th', null, label) },
  '../../store/tickets': { useTicketStore: select => select({ updateTicket: () => {} }) },
  '../../utils/dates': loadTs('frontend/src/utils/dates.ts'),
  '@dnd-kit/core': { DndContext: wrapper, closestCenter: () => {} },
  '@dnd-kit/sortable': { SortableContext: wrapper, horizontalListSortingStrategy: () => {}, arrayMove: () => [] },
});

const users = ['admin', 'admin', 'dispatcher', 'engineer', 'viewer', 'viewer'].map((role, index) => ({
  id: index + 1, email: `user-${index + 1}@example.test`, name: `User ${index + 1}`, role,
  status: index === 4 ? 'rejected' : 'active',
}));
const ticket = { id: 100, number: 1000, subject: 'Assignment regression', body: '', status: 'ASSIGNED',
  priority: 'medium', assignee_id: 3, created_at: '2026-10-28T10:00:00Z', resolution_deadline: null };

function render(rows, role = 'admin', assignee = 3) {
  return renderToStaticMarkup(React.createElement(TableView, {
    users: rows, role, tickets: [{ ...ticket, assignee_id: assignee }], currentUserId: 1,
  })).match(/<select[^>]*class="assignee-select"[^>]*>([\s\S]*?)<\/select>/)[1];
}
function optionValues(html) {
  return [...html.matchAll(/<option value="([^"]*)"/g)].map(match => match[1]);
}

test('inline table respects all server-allowed roles and displays an already assigned dispatcher', () => {
  const html = render(users.map(user => ({ ...user, can_be_assignee: true })));
  assert.deepEqual(optionValues(html), ['', '1', '2', '3', '4', '6']);
  assert.match(html, /<option value="3" selected="">User 3<\/option>/);
});

test('inline table preserves the personal dispatcher self-assignment grant', () => {
  const html = render(users.map(user => ({ ...user, can_be_assignee: [3, 4].includes(user.id) })), 'dispatcher');
  assert.deepEqual(optionValues(html), ['', '3', '4']);
  assert.match(html, /<option value="3" selected="">User 3<\/option>/);
});

test('inline table does not grant other admins non-engineer targets', () => {
  assert.deepEqual(optionValues(render(users.map(user => ({ ...user, can_be_assignee: user.id === 4 })))), ['', '4']);
});

test('an explicit server denial overrides director and engineer fallback rules', () => {
  assert.deepEqual(optionValues(render(users.map(user => ({ ...user, can_be_assignee: false })), 'director')), ['']);
});

test('legacy responses preserve engineer-only administrator options', () => {
  assert.deepEqual(optionValues(render(users)), ['', '4']);
});

test('legacy responses preserve director options while excluding inactive users', () => {
  assert.deepEqual(optionValues(render(users, 'director')), ['', '1', '2', '3', '4', '6']);
});
