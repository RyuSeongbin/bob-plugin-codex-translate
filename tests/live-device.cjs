// Probe only device-code issuance. Does not print the code or retain any credentials.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const files = {};
const context = { exports: {}, require: () => ({}), $option: {},
    $data: { fromUTF8: value => ({ toUTF8: () => value }) },
    $file: { read: name => files[name] ? { toUTF8: () => JSON.stringify(files[name]) } : null,
        write: ({ path, data }) => { files[path] = JSON.parse(data.toUTF8()); return true; },
        delete: name => { delete files[name]; } },
    $http: { request: async options => {
        const response = await fetch(options.url, { method: options.method, headers: options.header,
            body: JSON.stringify(options.body), redirect: 'error', signal: AbortSignal.timeout(20000) });
        return { response: { statusCode: response.status }, data: await response.json().catch(() => ({})) };
    } }
};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../plugin/auth.js'), 'utf8'), context);
context.exports.validate(result => {
    if (result.error && result.error.troubleshootingLink === 'https://auth.openai.com/codex/device' && files['$sandbox/device-login.json']) {
        console.log('OpenAI 已返回有效设备码；插件登录入口请求通过。验证码仅在内存中，未输出、未落盘。');
    } else {
        console.error(result.error ? result.error.message : '未取得设备码'); process.exitCode = 1;
    }
});
