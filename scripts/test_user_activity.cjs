const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { test } = require('node:test');
const root = path.resolve(__dirname, '..');
const ts = createRequire(path.join(root, 'frontend/package.json'))('typescript');

function load(relative, context = {}, overrides = {}) {
  const filename = path.join(root, relative);
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename,
  });
  const module = { exports: {} };
  vm.runInNewContext(outputText, { module, exports: module.exports, Date, Intl,
    require: name => overrides[name], ...context }, { filename });
  return module.exports;
}

for (const client of ['frontend', 'mobile']) {
  const { createActivityReporter } = load(`${client}/src/utils/userActivity.ts`, {}, { '../api/client': { api: {} } });
  test(`${client}: actions are throttled; quiet time does not send a heartbeat`, async () => {
    let time = 0;
    let sent = 0;
    const report = createActivityReporter(async () => { sent++; }, () => time);
    await Promise.all([report(), report(), report()]);
    assert.equal(sent, 1);
    time = 59_999;
    await report();
    assert.equal(sent, 1);
    time = 120_000;
    assert.equal(sent, 1);
    await report();
    assert.equal(sent, 2);
  });
  test(`${client}: failed telemetry never blocks work or retries continuously`, async () => {
    let time = 0;
    let sent = 0;
    const report = createActivityReporter(async () => { sent++; throw Error('Synthetic outage'); }, () => time);
    await report();
    await report();
    assert.equal(sent, 1);
    time = 60_000;
    await report();
    assert.equal(sent, 2);
  });
}

test('web: hidden tabs, background requests and disposed listeners do not report activity', async () => {
  let time = 0;
  let sent = 0;
  const listeners = new Map();
  const document = { visibilityState: 'hidden',
    addEventListener: (event, fn) => listeners.set(event, fn),
    removeEventListener: event => listeners.delete(event) };
  const FakeDate = class extends Date { static now() { return time; } };
  const api = { post: async url => { assert.equal(url, '/activity'); sent++; }, get: async () => ({ data: [] }) };
  const { trackUserActivity } = load('frontend/src/utils/userActivity.ts', { document, Date: FakeDate }, { '../api/client': { api } });
  const dispose = trackUserActivity();
  assert.equal(sent, 0);
  document.visibilityState = 'visible';
  listeners.get('visibilitychange')();
  assert.equal(sent, 1);
  time = 60_000;
  await api.get('/tickets');
  assert.equal(sent, 1);
  listeners.get('pointerdown')();
  assert.equal(sent, 2);
  document.visibilityState = 'hidden';
  time = 120_000;
  listeners.get('keydown')();
  assert.equal(sent, 2);
  dispose();
  assert.equal(listeners.size, 0);
});

test('date is displayed in Moscow time independently of the computer timezone', () => {
  const { formatLastActivity } = load('frontend/src/utils/userActivity.ts', {}, { '../api/client': { api: {} } });
  assert.match(formatLastActivity('2026-11-06T23:30:00Z'), /07\.11\.2026.*02:30/);
  assert.equal(formatLastActivity(null), 'Нет данных');
  assert.equal(formatLastActivity('invalid'), 'Нет данных');
});

test('Android: background, locked, signed-out and not-ready states do not report', () => {
  const filename = path.join(root, 'mobile/App.tsx');
  const ast = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let statement;
  function visit(node) {
    if (ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.name.getText(ast) === 'reportActivity')) statement = node;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(statement);
  const callback = statement.declarationList.declarations[0].initializer;
  assert.ok(!callback.arguments[1].getText(ast).match(/\buser\b/), 'background token refresh must not restart activity tracking');
  const { outputText } = ts.transpileModule(statement.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } });
  for (const [ready, phase, user, state, expected] of [
    [true, 'unlocked', { user_id: 1 }, 'active', 1], [true, 'locked', { user_id: 1 }, 'active', 0],
    [true, 'unlocked', { user_id: 1 }, 'background', 0], [false, 'unlocked', { user_id: 1 }, 'active', 0],
    [true, 'signed_out', null, 'active', 0],
  ]) {
    let sent = 0;
    const report = vm.runInNewContext(`${outputText}; reportActivity;`, { useCallback: fn => fn,
      ready, phase, activityUserId: user?.user_id, AppState: { currentState: state }, activityReporter: () => sent++ });
    report();
    assert.equal(sent, expected);
  }
});
