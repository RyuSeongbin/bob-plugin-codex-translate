# Codex — Bob 翻译插件 v0.5.0

通过浏览器授权使用 ChatGPT/Codex 订阅进行翻译、润色或自定义文本处理。仅保留设备码登录，无需 Token、导入脚本或常驻服务。这是第三方插件，目前为预览版。

[GitHub 主页](https://github.com/RyuSeongbin/bob-plugin-codex-translate) · [安装包下载](https://github.com/RyuSeongbin/bob-plugin-codex-translate/releases)

插件标识：`com.bob-plugin-codex-translate`。仓库添加 `bobplugin` 标签，供 Bob 第三方列表抓取；是否已收录以列表实际显示为准。

## 安装与登录

1. 需要 Bob 1.21.0 或以上。双击 `release/bob-plugin-codex-translate-v0.5.0.bobplugin` 安装，在 Bob 中添加 Codex 服务。
2. “登录 · ChatGPT 账号”保持“使用当前账号 / 首次登录”。点击 Verify，提示会显示验证码及 OpenAI 登录链接。
3. 打开 `https://auth.openai.com/codex/device`，输入验证码，完成 ChatGPT 授权。不要向他人提供验证码。
4. 回到 Bob 再点 Verify。插件兑换并保存自己的登录凭据，发送一次短翻译确认模型权限。通过后保存设置即可划词翻译。
5. 更换账号时，选择“重新登录或更换账号”，重复上述流程；成功后选回“使用当前账号 / 首次登录”，否则下次验证会再次开始登录。

设备码约 15 分钟有效。首次 Verify 的未通过状态表示等待授权；每次 Verify 只检查一次授权结果，不持续轮询，不监听本机端口。组织可能禁用设备码登录，此版本不提供其他登录方式。

## 模式

默认“翻译”：按 Bob 的目标语言翻译，原有配置无需更改。

“润色”：修改语法、清晰度和自然表达，保持原语言，不做语言转换；返回的语言标识也使用原语言。提示词要求保留事实、金额、姓名、不确定性和承诺边界，结果仍需自行核对。

“自定义提示词”：使用配置中的 System Prompt 和 User Prompt。两项只在该模式生效，支持以下变量：

| 变量 | 含义 |
|---|---|
| `$query.text` | Bob 选中的原文 |
| `$query.detectFromLang` | 源语言名称，未配置名称映射的语言回传代码 |
| `$query.detectToLang` | 目标语言名称，未配置名称映射的语言回传代码 |
| `$query.detectFrom` | 源语言代码，例如 en、ko |
| `$query.detectTo` | 目标语言代码，例如 zh-Hans、ko |

User Prompt 默认 `$query.text`。如果用户提示词没有该变量，插件会在末尾自动附上原文，避免漏传内容。替换只执行一遍，不再展开原文本身包含的变量。System Prompt 留空时使用简短的文本任务助手提示词。

示例 System Prompt：`你是一名商务邮件编辑。保留原意、姓名、金额和不确定性，只输出修改后的正文。`

示例 User Prompt：

```text
请把下面内容改得简洁、自然，保持原语言：
$query.text
```

Bob 不支持按模式隐藏配置框，自定义提示词输入框始终显示；翻译和润色模式会忽略这两项。Verify 会按当前模式执行一次短文本请求，消耗少量额度。

## 模型与思考等级

候选包含 GPT-6.1 Sol、GPT-6 Sol、GPT-6 Luna、GPT-6 Astra、GPT-5.6 Sol、GPT-5.6 Terra、GPT-5.6 Luna，以及自定义模型。默认 GPT-6 Luna。

思考等级可选 Low、Medium、High、XHigh，默认 Low。日常翻译建议从 Low 开始，复杂长文可提高等级，可能增加等待时间和额度消耗。选中模型和思考等级后点击 Verify 检查组合是否被账号支持。

候选不是账号权限列表，模型可用性以实际请求为准。Bob 没有公开的动态更新下拉选项接口，列表由插件配置提供。

## 升级说明

- v0.3.x / v0.4.x：插件标识不变，安装覆盖升级后，已经通过设备码登录的用户可以继续使用原登录。
- 原手动 Token、Account ID、登录方式选择及导入快照不再被读取，也不会作为后备认证渠道。此前仅通过手动 Token 或导入工具使用的用户，升级后须点击 Verify 完成一次浏览器授权。
- 不自动删除旧版本沙盒文件或其他客户端的登录。新版安装包不附带导入脚本。
- v0.1.0 使用旧标识 `com.seongbin.bob.codex`，当前为 `com.bob-plugin-codex-translate`，需要作为新插件安装，登录成功后停用旧服务以免重复调用。

## 凭据与隐私

插件自己的 Access Token 和 Refresh Token 保存在 Bob 插件沙盒的 `oauth.json`；登录临时状态位于 `device-login.json`。翻译或验证时按需续期，不访问 Codex CLI、Magpie 或 Hermes 的认证存储，不复制其他客户端的 Refresh Token。

Bob 沙盒不等于钥匙串加密，这些凭据以本机明文存储，不要分享沙盒文件。卸载插件时 Bob 会清理对应沙盒；本地删除不等于撤销 OpenAI 服务端授权。

请只配置一个使用同一插件沙盒的设备码登录服务实例；同一运行实例内会合并并发刷新，不同运行上下文之间没有跨进程刷新锁。

翻译固定发往 `https://chatgpt.com/backend-api/codex/responses`；认证固定发往 `https://auth.openai.com`。不经过本项目服务器，不回退到 API Key 或其他模型服务。凭据不会进入构建包或插件日志。

## 验证与已知限制

- v0.5.0 的 29 项自动测试通过，覆盖设备码申请与授权交换、凭据存储及续期、取消、旧认证方式不再生效、模型候选、默认及自定义思考等级、SSE 和 HTTP 错误处理。
- GPT-6 Luna + Low 的润色与自定义模式均已完成真实短句请求：Thank you for you help. → Thank you for your help.
- 先前真实设备码申请已成功，直连 gpt-6.1-sol 的短翻译也已成功；v0.1.0 的 Bob Verify 由用户截图确认通过。
- 新版 Bob 配置页、完整浏览器授权及真实令牌轮换尚未完成人工端到端验证。未逐一测试全部模型和思考等级，也未核对精确扣量。
- 设备码协议参考 Hermes，使用相同的公开 Codex OAuth 客户端标识，不代表插件获得独立的 OpenAI 官方应用认证。登录或后端接口变更可能需要更新插件。

## 开发与资源

运行时无第三方依赖，Node 仅用于开发测试。

```sh
node --test tests/auth.test.cjs tests/service.test.cjs
/usr/bin/python3 build.py
```

`tests/live.cjs` 是开发用的显式短翻译测试，可从本机登录读取凭据并仅在内存中适配测试，不是发布插件的登录方式。`tests/live-device.cjs` 仅检查设备码申请，不输出验证码或保存凭据。

构建白名单仅包含 info.json、main.js、service.js、auth.js 和 icon.png；完整 ZIP 只包含插件安装包和本文。

参考：[Hermes Codex 认证](https://github.com/NousResearch/hermes-agent/blob/59b70c943a5f3504e03dab0b2ed4ceb3a8b32848/hermes_cli/auth_codex.py)、[Bob 配置](https://bobtranslate.com/plugin/quickstart/info.html)、[Bob 验证](https://bobtranslate.com/plugin/quickstart/translate.html)、[Bob 网络](https://bobtranslate.com/plugin/api/http.html)。实现未复制 Hermes 源码。Codex 图标取自本机官方 ChatGPT.app 的 icon-codex-dark-color.png 并缩放至 256×256；图标不代表官方出品。
