// Protocol reference: Hermes auth_codex.py; device login needs no loopback listener.
var service = require('./service');
var clientId = 'app_EMoamEEZ73f0CkXaXp7hrann';
var issuer = 'https://auth.openai.com';
var tokenUrl = issuer + '/oauth/token';
var refreshFlight = null;
var loginFlight = null;

function error(message) { return { type: 'secretKey', message: message }; }
function load(path) {
    var data = $file.read(path);
    if (!data) return null;
    try { return JSON.parse(data.toUTF8()); }
    catch (_) { throw error('登录数据损坏，请重新登录。'); }
}
function save(path, value) {
    if (!$file.write({ path: path, data: $data.fromUTF8(JSON.stringify(value)) })) {
        throw error('无法保存登录凭据，请检查 Bob 插件沙盒的写入权限。');
    }
    var readback = load(path);
    if (!readback || JSON.stringify(readback) !== JSON.stringify(value)) throw error('登录凭据保存后校验失败，请重新登录。');
}
async function post(url, body, form) {
    var response;
    try {
        response = await $http.request({ method: 'POST', url: url, timeout: 20,
            header: { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json', Accept: 'application/json' }, body: body });
    } catch (_) { throw { type: 'network', message: '登录请求网络失败，请检查网络后重试。' }; }
    var status = response.response && response.response.statusCode;
    if (response.error || !status) throw { type: 'network', message: '登录请求网络失败，请检查网络后重试。' };
    return { status: status, data: response.data };
}
function assertSuccess(response, stage) {
    if (response.status === 429) throw error('OpenAI 暂时限制登录请求，请稍后重试。');
    if (response.status !== 200 || !response.data || typeof response.data !== 'object') {
        throw error(stage + '失败（HTTP ' + response.status + '）。请确认账号允许设备码登录，再重试。');
    }
    return response.data;
}
function credentials(tokens, previousRefresh) {
    if (typeof tokens.access_token !== 'string') throw error('登录响应缺少 Access Token，请重新登录。');
    var result = service.tokenCredentials(tokens.access_token, '');
    if (typeof result.account_id !== 'string' || !result.account_id ||
        typeof result.expires_at !== 'number' || !isFinite(result.expires_at) || result.expires_at <= Date.now() / 1000 + 60) {
        throw error('登录响应缺少账号或有效期，无法确认可用的 Codex 登录。');
    }
    result.refresh_token = tokens.refresh_token || previousRefresh;
    if (typeof result.refresh_token !== 'string' || !result.refresh_token) throw error('登录响应缺少刷新令牌，请重新登录。');
    return result;
}
function pendingMessage(pending) {
    return { type: 'secretKey', message: '请打开下方登录链接，在 OpenAI 页面输入验证码：' + pending.user_code +
        '。完成浏览器授权后，回到 Bob 再点击 Verify。设备码约 15 分钟有效；不要向他人提供验证码。',
        troubleshootingLink: issuer + '/codex/device' };
}
async function login() {
    var pending = load('$sandbox/device-login.json');
    if (!pending || pending.expires_at <= Date.now() / 1000) {
        var device = assertSuccess(await post(issuer + '/api/accounts/deviceauth/usercode', { client_id: clientId }), '申请设备码');
        if (typeof device.user_code !== 'string' || !device.user_code ||
            typeof device.device_auth_id !== 'string' || !device.device_auth_id) throw error('设备码响应不完整，请重试。');
        pending = { user_code: device.user_code, device_auth_id: device.device_auth_id,
            expires_at: Date.now() / 1000 + 900, next_poll_at: Date.now() / 1000 + Math.max(3, Number(device.interval) || 5) };
        save('$sandbox/device-login.json', pending);
        throw pendingMessage(pending);
    }
    if (Date.now() / 1000 < pending.next_poll_at) throw pendingMessage(pending);
    // One poll per Verify click: no long-running background polling or local service.
    pending.next_poll_at = Date.now() / 1000 + 5;
    save('$sandbox/device-login.json', pending);
    var poll = await post(issuer + '/api/accounts/deviceauth/token', { device_auth_id: pending.device_auth_id, user_code: pending.user_code });
    if (poll.status === 403 || poll.status === 404) throw pendingMessage(pending);
    var code = assertSuccess(poll, '确认登录');
    if (typeof code.authorization_code !== 'string' || !code.authorization_code ||
        typeof code.code_verifier !== 'string' || !code.code_verifier) throw error('授权响应不完整，请重新登录。');
    var tokens = assertSuccess(await post(tokenUrl, { grant_type: 'authorization_code', code: code.authorization_code,
        code_verifier: code.code_verifier, client_id: clientId, redirect_uri: issuer + '/deviceauth/callback' }, true), '交换登录令牌');
    save('$sandbox/oauth.json', credentials(tokens));
    $file.delete('$sandbox/device-login.json');
}
async function refresh() {
    var stored = load('$sandbox/oauth.json');
    if (!stored || stored.expires_at > Date.now() / 1000 + 120) return;
    if (!stored.refresh_token) throw error('登录凭据已过期，请重新登录。');
    if (!refreshFlight) refreshFlight = (async function () {
        var response = await post(tokenUrl, { grant_type: 'refresh_token', refresh_token: stored.refresh_token, client_id: clientId }, true);
        if (response.status === 400 || response.status === 401 || response.status === 403) {
            throw error('登录授权已失效。请在“登录 · ChatGPT 账号”选择“重新登录或更换账号”，再点击 Verify。');
        }
        save('$sandbox/oauth.json', credentials(assertSuccess(response, '续期登录'), stored.refresh_token));
    })();
    try { await refreshFlight; } finally { refreshFlight = null; }
}
async function validate(completion) {
    try {
        var action = $option.login_action || 'check';
        var pending = load('$sandbox/device-login.json');
        if (action === 'login' && !pending) $file.delete('$sandbox/oauth.json');
        if (!load('$sandbox/oauth.json') || action === 'login') {
            if (!loginFlight) loginFlight = login();
            try { await loginFlight; } finally { loginFlight = null; }
        }
        translate({ text: 'Hello', detectFrom: 'en', detectTo: 'zh-Hans',
            onCompletion: function (value) {
                completion(value.error ? { result: false, error: value.error } : { result: true });
            } });
    } catch (failure) {
        completion({ result: false, error: failure.type ? failure : error('登录失败，请重新登录后重试。') });
    }
}
async function translate(query) {
    var canceled = false;
    var subscription = query.cancelSignal && query.cancelSignal.subscribe(function () { canceled = true; });
    try { await refresh(); }
    catch (failure) {
        if (subscription) subscription.dispose();
        query.onCompletion({ error: failure.type ? failure : error('登录续期失败，请重新登录后重试。') });
        return;
    }
    if (subscription) subscription.dispose();
    if (canceled) {
        query.onCompletion({ error: { type: 'network', message: '翻译已取消。' } });
        return;
    }
    service.translate(query);
}
exports.validate = validate;
exports.translate = translate;
