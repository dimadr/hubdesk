const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const sourceRoot = process.env.HUBDESK_REGRESSION_SOURCE_ROOT || root;
const frontendRequire = createRequire(path.join(root, 'frontend/package.json'));
const mobileRequire = createRequire(path.join(root, 'mobile/package.json'));
const ts = frontendRequire('typescript');

function loadTs(relative, overrides = {}, requireFrom = frontendRequire) {
  const filename = path.join(sourceRoot, relative);
  const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filename,
  });
  const module = { exports: {} };
  const requireModule = (name) => Object.hasOwn(overrides, name) ? overrides[name] : requireFrom(name);
  const execute = vm.runInThisContext(`(function(require, module, exports) {\n${result.outputText}\n})`, { filename });
  execute(requireModule, module, module.exports);
  return module.exports;
}

const dates = () => loadTs('frontend/src/utils/dates.ts');

for (const [zone, day, label] of [
  ['UTC', '2026-09-30', '30.09.2026'],
  ['Europe/Moscow', '2026-10-01', '01.10.2026'],
  ['America/New_York', '2026-09-30', '30.09.2026'],
]) {
  test(`M05 grouping and table agree in ${zone}`, () => {
    const previous = process.env.TZ;
    process.env.TZ = zone;
    try {
      const { localDateKey, formatLocalDate } = dates();
      assert.equal(localDateKey('2026-09-30T22:30:00Z'), day);
      assert.equal(formatLocalDate('2026-09-30T22:30:00Z'), label);
      assert.equal(localDateKey('2026-10-01'), '2026-10-01');
      assert.equal(localDateKey(null), '');
      assert.equal(localDateKey('invalid'), '');
    } finally { process.env.TZ = previous; }
  });
}

test('M05 Moscow month and year boundaries use explicit UTC and inclusive microseconds', () => {
  const previous = process.env.TZ;
  process.env.TZ = 'Europe/Moscow';
  try {
    const { localMonthUtcRange, localDayUtcRange, localDateKey } = dates();
    assert.deepEqual(localMonthUtcRange(2026, 9), {
      from: '2026-09-30T21:00:00.000Z', to: '2026-10-31T20:59:59.999999Z',
    });
    assert.deepEqual(localDayUtcRange('2026-10-01'), {
      from: '2026-09-30T21:00:00.000Z', to: '2026-10-01T20:59:59.999999Z',
    });
    assert.equal(localDateKey('2026-12-31T22:30:00Z'), '2027-01-01');
    assert.equal(localMonthUtcRange(2026, 11).to, '2026-12-31T20:59:59.999999Z');
  } finally { process.env.TZ = previous; }
});

test('M05 local DST days span 23 or 25 hours, not a hardcoded UTC day', () => {
  const previous = process.env.TZ;
  process.env.TZ = 'America/New_York';
  try {
    const { localDayUtcRange } = dates();
    assert.deepEqual(localDayUtcRange('2026-03-08'), {
      from: '2026-03-08T05:00:00.000Z', to: '2026-03-09T03:59:59.999999Z',
    });
    assert.deepEqual(localDayUtcRange('2026-11-01'), {
      from: '2026-11-01T04:00:00.000Z', to: '2026-11-02T04:59:59.999999Z',
    });
  } finally { process.env.TZ = previous; }
});

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const tick = () => new Promise(setImmediate);

function mobile(phase = 'unlocked') {
  const axios = mobileRequire('axios');
  const client = loadTs('mobile/src/api/client.ts', {
    '@react-native-async-storage/async-storage': { getItem: async () => null, setItem: async () => {} },
  }, mobileRequire);
  client.api.defaults.baseURL = client.sessionApi.defaults.baseURL = 'http://example.test/api';
  const user = { user_id: 7, email: 'mobile@example.test', name: 'Test', role: 'engineer', status: 'active' };
  const saved = { refresh: 'synthetic-refresh-credential', clears: 0 };
  const storage = {
    clearDeviceSession: async () => { saved.clears += 1; saved.refresh = null; },
    isQuickUnlockEnabled: async () => true,
    loadLockTimeout: async () => 60,
    loadRefreshToken: async () => saved.refresh,
    loadSavedUser: async () => user,
    loadSessionId: async () => 7,
    migrateLegacyAuth: async () => {},
    saveDeviceSession: async () => {},
    saveLockTimeout: async () => {},
  };
  const { useAuthStore: store } = loadTs('mobile/src/store/authStore.ts', {
    'react-native': { Platform: { OS: 'android' } },
    'expo-local-authentication': {
      hasHardwareAsync: async () => true,
      isEnrolledAsync: async () => true,
      authenticateAsync: async () => ({ success: true }),
    },
    '../api/client': client,
    '../security/sessionStorage': storage,
  }, mobileRequire);
  store.setState({ token: phase === 'locked' ? null : 'expired-access', user, phase,
    quickUnlockEnabled: true, currentSessionId: 7 });
  client.setAccessToken(store.getState().token);
  const error = (config, status) => new axios.AxiosError(
    status ? 'Synthetic HTTP error' : 'Network Error', status ? 'ERR_BAD_RESPONSE' : 'ERR_NETWORK',
    config, undefined, status ? { status, data: {}, headers: {}, config } : undefined,
  );
  const response = (config, data) => ({ status: 200, statusText: 'OK', headers: {}, config, data });
  return { client, store, saved, error, response, auth: { ...user, token: 'renewed-access' } };
}

for (const phase of ['locked', 'unlocked']) {
  for (const status of [undefined, 429, 500]) {
    test(`M06 ${phase}: transient ${status || 'ERR_NETWORK'} preserves credential`, async () => {
      const c = mobile(phase);
      c.client.sessionApi.defaults.adapter = async (config) => { throw c.error(config, status); };
      await assert.rejects(c.store.getState().refreshAccessToken(phase === 'locked'));
      assert.equal(c.saved.clears, 0);
      assert.equal(c.saved.refresh, 'synthetic-refresh-credential');
      assert.equal(c.store.getState().phase, phase);
      assert.equal(c.store.getState().currentSessionId, 7);
    });
  }
}

for (const status of [401, 403]) {
  test(`M06 definitive refresh ${status} clears credential`, async () => {
    const c = mobile();
    c.client.sessionApi.defaults.adapter = async (config) => { throw c.error(config, status); };
    assert.equal(await c.store.getState().refreshAccessToken(), null);
    assert.equal(c.saved.clears, 1);
    assert.equal(c.saved.refresh, null);
    assert.equal(c.store.getState().phase, 'signed_out');
  });
}

test('M06 actual Axios 401 interceptor does not turn refresh network failure into logout', async () => {
  const c = mobile();
  c.client.api.defaults.adapter = async (config) => { throw c.error(config, 401); };
  c.client.sessionApi.defaults.adapter = async (config) => { throw c.error(config); };
  await assert.rejects(c.client.api.get('/tickets'), { code: 'ERR_NETWORK' });
  assert.equal(c.saved.clears, 0);
  assert.equal(c.store.getState().phase, 'unlocked');
});

test('M06 locked request never refreshes or destroys the saved session', async () => {
  const c = mobile('locked');
  let refreshes = 0;
  c.client.api.defaults.adapter = async (config) => { throw c.error(config, 401); };
  c.client.sessionApi.defaults.adapter = async (config) => { refreshes += 1; throw c.error(config); };
  await assert.rejects(c.client.api.get('/tickets'));
  assert.equal(refreshes, 0);
  assert.equal(c.saved.clears, 0);
  assert.equal(c.store.getState().phase, 'locked');
});

test('M06 a late successful refresh cannot undo device locking', async () => {
  const c = mobile();
  const pending = deferred();
  c.client.sessionApi.defaults.adapter = async (config) => { await pending.promise; return c.response(config, c.auth); };
  const refresh = c.store.getState().refreshAccessToken();
  await tick();
  c.store.getState().lock();
  pending.resolve();
  await assert.rejects(refresh);
  assert.equal(c.store.getState().phase, 'locked');
  assert.equal(c.store.getState().token, null);
  assert.equal(c.saved.clears, 0);
});

test('M06 parallel Axios 401s share one refresh and retry successfully', async () => {
  const c = mobile();
  const pending = deferred();
  let refreshes = 0;
  c.client.api.defaults.adapter = async (config) => {
    if (!config._authRetried) throw c.error(config, 401);
    assert.equal(config.headers.Authorization, 'Bearer renewed-access');
    return c.response(config, []);
  };
  c.client.sessionApi.defaults.adapter = async (config) => {
    refreshes += 1;
    await pending.promise;
    return c.response(config, c.auth);
  };
  const requests = [c.client.api.get('/tickets'), c.client.api.get('/tickets')];
  await tick();
  assert.equal(refreshes, 1);
  pending.resolve();
  assert.equal((await Promise.all(requests)).length, 2);
  assert.equal(c.store.getState().phase, 'unlocked');
  assert.equal(c.saved.clears, 0);
});

test('M06 revoked refresh through actual Axios interceptor signs out', async () => {
  const c = mobile();
  c.client.api.defaults.adapter = async (config) => { throw c.error(config, 401); };
  c.client.sessionApi.defaults.adapter = async (config) => { throw c.error(config, 401); };
  await assert.rejects(c.client.api.get('/tickets'));
  assert.equal(c.saved.clears, 1);
  assert.equal(c.store.getState().phase, 'signed_out');
});

function statsCase(get) {
  return loadTs('frontend/src/store/ticketStats.ts', { '../api/client': { api: { get } } }).useTicketStatsStore;
}
const auth = (role, token = 'synthetic-web-session') => ({ token, user: { role } });
const report = { total: 5, by_status: [{ label: 'ASSIGNED', count: 3 }, { label: 'COMPLETED', count: 2 }],
  by_priority: [{ label: 'high', count: 1 }, { label: 'critical', count: 2 }, { label: 'low', count: 2 }] };

test('M09 inaccessible roles neither request nor retain shared aggregates', async () => {
  let calls = 0;
  const store = statsCase(async () => { calls += 1; return { data: report }; });
  await store.getState().load(auth('admin'));
  assert.deepEqual(store.getState().stats, { total: 5, open: 3, urgent: 3 });
  for (const role of ['engineer', 'customer', 'viewer', 'storekeeper', 'metrologist']) {
    await store.getState().load(auth(role));
    assert.equal(store.getState().stats, null);
    assert.equal(store.getState().scope, null);
  }
  assert.equal(calls, 1);
});

for (const action of ['logout', 'role switch']) {
  test(`M09 a late response cannot repopulate aggregates after ${action}`, async () => {
    const pending = deferred();
    const store = statsCase(() => pending.promise);
    const request = store.getState().load(auth('admin'));
    if (action === 'logout') store.getState().reset();
    else await store.getState().load(auth('engineer'));
    pending.resolve({ data: report });
    await request;
    assert.equal(store.getState().stats, null);
    assert.equal(store.getState().scope, null);
    assert.equal(store.getState().loading, false);
  });
}

test('M09 changing authorized accounts ignores the older response', async () => {
  const first = deferred(), second = deferred();
  let calls = 0;
  const store = statsCase(() => (++calls === 1 ? first.promise : second.promise));
  const oldRequest = store.getState().load(auth('admin', 'old-session'));
  const newRequest = store.getState().load(auth('dispatcher', 'new-session'));
  second.resolve({ data: { total: 0, by_status: [], by_priority: [] } });
  await newRequest;
  first.resolve({ data: report });
  await oldRequest;
  assert.equal(store.getState().scope, 'new-session');
  assert.deepEqual(store.getState().stats, { total: 0, open: 0, urgent: 0 });
});

test('M09 a report error clears previously loaded values instead of showing false zeroes', async () => {
  let fail = false;
  const store = statsCase(async () => { if (fail) throw new Error('Synthetic 403'); return { data: report }; });
  await store.getState().load(auth('admin'));
  fail = true;
  await store.getState().load(auth('admin'));
  assert.equal(store.getState().stats, null);
  assert.equal(store.getState().loading, false);
});
