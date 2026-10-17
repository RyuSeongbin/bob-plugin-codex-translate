// Explicitly run this check to send one short translation using the local Codex account.
// Credentials stay in memory: no files, token logging, refresh or API-key fallback.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const auth = JSON.parse(fs.readFileSync(path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'auth.json'), 'utf8'));
const tokens = auth.tokens || {};
if (auth.auth_mode === 'api_key' || !tokens.access_token || !tokens.account_id) throw new Error('需要本机 ChatGPT 模式登录');
const claims = JSON.parse(Buffer.from(tokens.access_token.split('.')[1], 'base64url').toString('utf8'));
const credentials = { access_token: tokens.access_token, account_id: tokens.account_id, expires_at: claims.exp };
const context = { exports: {}, $option: { model: process.env.BOB_CODEX_TEST_MODEL || 'gpt-6.1-sol', reasoning_effort: process.env.BOB_CODEX_TEST_EFFORT || 'low',
    mode: process.env.BOB_CODEX_TEST_MODE || 'translate', system_prompt: 'Return only the result of the requested text task.',
    user_prompt: 'Rewrite as a short, natural English sentence:\n$query.text' },
    $data: { fromBase64: value => ({ toUTF8: () => Buffer.from(value, 'base64').toString('utf8') }) },
    $file: { read: () => ({ toUTF8: () => JSON.stringify(credentials) }) },
    $http: { streamRequest: async options => {
        try {
            const response = await fetch(options.url, { method: options.method, headers: options.header,
                body: JSON.stringify(options.body), signal: AbortSignal.timeout(110000), redirect: 'error' });
            if (!response.ok) {
                const body = await response.json().catch(() => ({}));
                const message = typeof body.error === 'string' ? body.error : ((body.error || {}).message || body.detail || body.message);
                if (message) console.error('服务端诊断：' + String(message)
                    .split(tokens.access_token).join('[redacted]').split(tokens.account_id).join('[redacted]').slice(0, 300));
                options.handler({ response: { statusCode: response.status } });
                return;
            }
            const decoder = new TextDecoder();
            for await (const chunk of response.body) options.streamHandler({ text: decoder.decode(chunk, { stream: true }) });
            options.streamHandler({ text: decoder.decode() });
            options.handler({ response: { statusCode: response.status } });
        } catch (_) { options.handler({ error: { message: '网络请求失败' } }); }
    } } };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../plugin/service.js'), 'utf8'), context);
context.exports.translate({ text: process.env.BOB_CODEX_TEST_TEXT || 'Thank you for your help.', detectFrom: 'en', detectTo: 'ko',
    onCompletion: value => {
        if (value.error) { console.error(value.error.message); process.exitCode = 1; }
        else console.log('Codex 完成文本处理（' + context.$option.mode + '）：' + value.result.content.text);
    } });
