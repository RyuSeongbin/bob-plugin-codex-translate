const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const test = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../plugin/service.js'), 'utf8');

function runtime(http, credentials, options = {}, files) {
    const context = { exports: {}, $option: options,
        $data: { fromBase64: value => ({ toUTF8: () => Buffer.from(value, 'base64').toString('utf8') }) },
        $file: { read: name => files ? (files[name] ? { toUTF8: () => JSON.stringify(files[name]) } : null) : ({ toUTF8: () => JSON.stringify(credentials || {
            access_token: 'fixture-token', account_id: 'fixture-account', expires_at: Date.now() / 1000 + 3600
        }) }) }, $http: { streamRequest: http } };
    vm.runInNewContext(source, context);
    return context.exports;
}
const frame = data => 'data: ' + JSON.stringify(data) + '\n\n';
const done = text => frame({ type: 'response.completed', response: { status: 'completed', output: [
    { type: 'message', content: [{ type: 'output_text', text }] }
] } });

test('reasoning defaults to low and selected levels are sent to Codex', () => {
    for (const effort of [undefined, 'low', 'medium', 'high', 'xhigh']) {
        let completion;
        runtime(options => {
            assert.equal(options.body.reasoning.effort, effort || 'low');
            options.streamHandler({ text: done('你好') });
            options.handler({ response: { statusCode: 200 } });
        }, null, { reasoning_effort: effort, model: 'custom', custom_model: 'gpt-6-luna' }).translate({
            text: 'Hello', detectFrom: 'en', detectTo: 'zh-Hans', onCompletion: value => { completion = value; }
        });
        assert.ok(completion.result);
    }
});
test('invalid reasoning level cannot send a request', () => {
    let completion;
    runtime(() => assert.fail('must not send'), null, { reasoning_effort: 'invalid' }).translate({
        text: 'Hi', detectFrom: 'en', detectTo: 'ko', onCompletion: value => { completion = value; }
    });
    assert.equal(completion.error.type, 'param');
});
test('all seven models including GPT-6 Luna are listed', () => {
    const info = JSON.parse(fs.readFileSync(path.join(__dirname, '../plugin/info.json'), 'utf8'));
    const values = info.options.find(option => option.identifier === 'model').menuValues.map(option => option.value);
    for (const model of ['gpt-6.1-sol', 'gpt-6-sol', 'gpt-6-luna', 'gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']) assert.ok(values.includes(model));
});
test('legacy settings and snapshot cannot be used without OAuth login', () => {
    let completion;
    runtime(() => assert.fail('must not send'), null,
        { login_method: 'manual', access_token: 'legacy-token' }, {
            '$sandbox/credentials.json': { access_token: 'snapshot', account_id: 'a', expires_at: Date.now()/1000 + 3600 }
        }).translate({ text: 'Hi', detectFrom: 'en', detectTo: 'ko', onCompletion: value => { completion = value; } });
    assert.equal(completion.error.type, 'secretKey');
    assert.match(completion.error.message, /Verify/);
});

test('package naming and configuration match requested Papago naming style', () => {
    const info = JSON.parse(fs.readFileSync(path.join(__dirname, '../plugin/info.json'), 'utf8'));
    assert.equal(info.name, 'Codex');
    assert.equal(info.identifier, 'com.bob-plugin-codex-translate');
    assert.ok(!info.options.some(option => ['access_token', 'account_id', 'login_method'].includes(option.identifier)));
    assert.equal(info.options.find(option => option.identifier === 'reasoning_effort').defaultValue, 'low');
    const model = info.options.find(option => option.identifier === 'model');
    assert.equal(model.type, 'menu');
    assert.equal(model.defaultValue, 'gpt-6-luna');
    assert.ok(model.menuValues.some(item => item.value === model.defaultValue));
    assert.equal(fs.readFileSync(path.join(__dirname, '../plugin/icon.png')).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
});

test('SSE handles every split boundary, CRLF, Korean and Chinese', () => {
    const wire = (': keepalive\n\n' + frame({ type: 'response.output_text.delta', delta: '안녕，你好' }) + done('안녕，你好')).replace(/\n/g, '\r\n');
    for (let i = 0; i <= wire.length; i++) {
        const parser = runtime().createParser(() => {});
        parser.push(wire.slice(0, i)); parser.push(wire.slice(i));
        assert.equal(parser.finish(), '안녕，你好');
    }
});
test('partial, failed, malformed and empty streams cannot report success', () => {
    for (const wire of [frame({ type: 'response.output_text.delta', delta: 'partial' }),
        frame({ type: 'response.failed' }), frame({ type: 'response.incomplete' }),
        frame({ type: 'error' }), 'data: {bad}\n\n', done(''),
        frame({ type: 'response.completed', response: { status: 'failed' } })]) {
        const parser = runtime().createParser(() => {});
        parser.push(wire);
        assert.throws(() => parser.finish());
    }
});
test('HTTP success uses fixed Codex endpoint, target language and no persistent conversation', () => {
    let completion, streamed;
    runtime(options => {
        assert.equal(options.url, 'https://chatgpt.com/backend-api/codex/responses');
        assert.equal(options.header.Authorization, 'Bearer fixture-token');
        assert.equal(options.body.store, false);
        assert.equal(options.body.stream, true);
        assert.match(options.body.instructions, /Korean/);
        assert.equal(options.body.input[0].content[0].text, 'Hello');
        assert.equal(options.body.previous_response_id, undefined);
        options.streamHandler({ text: frame({ type: 'response.output_text.delta', delta: '안녕하세요' }) });
        options.streamHandler({ text: done('안녕하세요') });
        options.handler({ response: { statusCode: 200 } });
    }).translate({ text: 'Hello', detectFrom: 'en', detectTo: 'ko',
        onStream: result => { streamed = result.content.text; }, onCompletion: value => { completion = value; } });
    assert.equal(completion.result.content.text, '안녕하세요');
    assert.equal(streamed, '안녕하세요');
});
test('401/403/404/429/network errors do not expose response bodies or tokens', () => {
    for (const status of [400, 401, 403, 404, 429, 500, undefined]) {
        let completion;
        runtime(options => options.handler({ response: { statusCode: status }, error: { message: 'fixture-token' } }))
            .translate({ text: 'Hello', detectFrom: 'en', detectTo: 'ko', onCompletion: value => { completion = value; } });
        assert.ok(completion.error);
        assert.ok(!JSON.stringify(completion).includes('fixture-token'));
    }
});
test('expired credentials and invalid targets stop before HTTP', () => {
    let calls = 0;
    for (const target of ['auto', 'ko']) {
        let completion;
        runtime(() => { calls++; }, { access_token: 'token', account_id: 'account', expires_at: 1 })
            .translate({ text: 'Hello', detectFrom: 'en', detectTo: target, onCompletion: value => { completion = value; } });
        assert.ok(completion.error);
    }
    assert.equal(calls, 0);
});
test('cancellation completes exactly once and disposes subscription', () => {
    let cancel, requests, calls = 0, disposed = 0;
    runtime(options => { requests = options; }).translate({ text: 'Hello', detectFrom: 'en', detectTo: 'ko',
        cancelSignal: { subscribe: callback => { cancel = callback; return { dispose: () => { disposed++; } }; } },
        onCompletion: value => { calls++; assert.ok(value.error); } });
    cancel();
    requests.streamHandler({ text: done('late') });
    requests.handler({ response: { statusCode: 200 } });
    assert.equal(calls, 1); assert.equal(disposed, 1);
});
test('Bob entry points load with documented module exports', () => {
    const context = { require: () => runtime() };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../plugin/main.js'), 'utf8'), context);
    assert.ok(context.supportLanguages().includes('ko'));
    assert.equal(context.pluginTimeoutInterval(), 120);
    assert.equal(typeof context.pluginValidate, 'function');
});
