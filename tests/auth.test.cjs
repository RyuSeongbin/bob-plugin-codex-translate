const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '../plugin');
const jwt = (expiry = Date.now()/1000 + 3600) => 'h.' + Buffer.from(JSON.stringify({ exp: expiry,
    'https://api.openai.com/auth': { chatgpt_account_id: 'oauth-account' } })).toString('base64url') + '.s';
const reply = (data, statusCode = 200) => ({ response: { statusCode }, data });
function harness(responses = [], files = {}, options = {}) {
    const calls = [], translations = [];
    const serviceContext = { exports: {}, $data: { fromBase64: value => ({ toUTF8: () => Buffer.from(value, 'base64').toString() }) } };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'service.js'), 'utf8'), serviceContext);
    const context = { exports: {}, require: () => ({ tokenCredentials: serviceContext.exports.tokenCredentials,
        translate: query => { translations.push(query); query.onCompletion({ result: { content: { text: '你好' } } }); } }),
        $option: options, $data: { fromUTF8: value => ({ toUTF8: () => value }) },
        $file: { read: name => files[name] ? { toUTF8: () => JSON.stringify(files[name]) } : null,
            write: ({ path, data }) => { files[path] = JSON.parse(data.toUTF8()); return true; },
            delete: name => { delete files[name]; } },
        $http: { request: async request => { calls.push(request); assert.ok(responses.length, 'unexpected HTTP');
            const response = responses.shift(); return typeof response === 'function' ? response(request) : response; } }
    };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'auth.js'), 'utf8'), context);
    return { api: context.exports, calls, translations, files, context };
}
function validate(h) { return new Promise(resolve => h.api.validate(resolve)); }
function translate(h, extra = {}) { return new Promise(resolve => h.api.translate({ text: 'Hello', detectFrom: 'en', detectTo: 'ko',
    ...extra, onCompletion: resolve })); }
const pending = () => ({ user_code: 'TEST-CODE', device_auth_id: 'fixture-id', expires_at: Date.now()/1000 + 900, next_poll_at: 0 });
const stored = () => ({ access_token: jwt(1), account_id: 'oauth-account', expires_at: 1, refresh_token: 'own-refresh' });

test('first Verify returns official device link and code, saves pending without a local server', async () => {
    const h = harness([reply({ user_code: 'TEST-CODE', device_auth_id: 'fixture-id', interval: '5' })]);
    const result = await validate(h);
    assert.equal(result.result, false);
    assert.match(result.error.message, /TEST-CODE/);
    assert.equal(result.error.troubleshootingLink, 'https://auth.openai.com/codex/device');
    assert.ok(h.files['$sandbox/device-login.json']);
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].url, 'https://auth.openai.com/api/accounts/deviceauth/usercode');
});
test('second Verify exchanges authorization and saves an independent refresh grant', async () => {
    const h = harness([reply({ authorization_code: 'one-time-code', code_verifier: 'server-verifier' }),
        reply({ access_token: jwt(), refresh_token: 'own-refresh' })], { '$sandbox/device-login.json': pending() });
    const result = await validate(h);
    assert.equal(result.result, true);
    assert.equal(h.calls[1].body.grant_type, 'authorization_code');
    assert.equal(h.calls[1].body.redirect_uri, 'https://auth.openai.com/deviceauth/callback');
    assert.equal(h.files['$sandbox/oauth.json'].refresh_token, 'own-refresh');
    assert.equal(h.files['$sandbox/oauth.json'].account_id, 'oauth-account');
    assert.equal(h.files['$sandbox/device-login.json'], undefined);
    assert.equal(h.translations.length, 1);
});
test('pending authorization does not appear successful or request a second device code', async () => {
    for (const status of [403, 404]) {
        const h = harness([reply({}, status)], { '$sandbox/device-login.json': pending() });
        assert.equal((await validate(h)).result, false);
        assert.equal(h.calls.length, 1);
        assert.equal(h.files['$sandbox/oauth.json'], undefined);
    }
});
test('respects device-code polling interval', async () => {
    const h = harness([], { '$sandbox/device-login.json': { ...pending(), next_poll_at: Date.now()/1000 + 10 } });
    assert.equal((await validate(h)).result, false);
    assert.equal(h.calls.length, 0);
});
test('refreshes only own OAuth credentials and persists rotated refresh token', async () => {
    const h = harness([reply({ access_token: jwt(), refresh_token: 'rotated-refresh' })], { '$sandbox/oauth.json': stored() });
    assert.ok((await translate(h)).result);
    assert.equal(h.calls[0].body.grant_type, 'refresh_token');
    assert.equal(h.files['$sandbox/oauth.json'].refresh_token, 'rotated-refresh');
    assert.equal(h.translations.length, 1);
});
test('concurrent requests share one refresh in the same plugin runtime', async () => {
    const h = harness([reply({ access_token: jwt(), refresh_token: 'rotated-refresh' })], { '$sandbox/oauth.json': stored() });
    const results = await Promise.all([translate(h), translate(h)]);
    assert.ok(results.every(result => result.result));
    assert.equal(h.calls.length, 1);
});
test('legacy manual Token and imported snapshot cannot bypass browser login', async () => {
    const h = harness([reply({ user_code: 'TEST-CODE', device_auth_id: 'fixture-id' })],
        { '$sandbox/credentials.json': stored() }, { login_method: 'device', access_token: 'stale-unused-token' });
    const result = await validate(h);
    assert.equal(result.result, false);
    assert.equal(result.error.troubleshootingLink, 'https://auth.openai.com/codex/device');
    assert.equal(h.calls.length, 1);
});
test('failed refresh cannot send a translation or expose the refresh token', async () => {
    const h = harness([reply({ error: 'own-refresh' }, 401)], { '$sandbox/oauth.json': stored() });
    const result = await translate(h);
    assert.ok(result.error);
    assert.equal(h.translations.length, 0);
    assert.ok(!JSON.stringify(result).includes('own-refresh'));
});
test('failed persistence does not report successful login', async () => {
    const h = harness([reply({ user_code: 'TEST-CODE', device_auth_id: 'fixture-id' })]);
    h.context.$file.write = () => false;
    assert.match((await validate(h)).error.message, /保存/);
});
test('bad exchange payload is not saved', async () => {
    const h = harness([reply({ authorization_code: 'c', code_verifier: 'v' }), reply({ access_token: jwt() })],
        { '$sandbox/device-login.json': pending() });
    assert.equal((await validate(h)).result, false);
    assert.equal(h.files['$sandbox/oauth.json'], undefined);
});
test('cancellation while refreshing does not start a translation', async () => {
    let cancel;
    const h = harness([() => { cancel(); return reply({ access_token: jwt(), refresh_token: 'rotated' }); }],
        { '$sandbox/oauth.json': stored() });
    const result = await translate(h, { cancelSignal: { subscribe: fn => { cancel = fn; return { dispose() {} }; } } });
    assert.ok(result.error);
    assert.equal(h.translations.length, 0);
});
