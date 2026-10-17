"""Package only public plugin sources; credentials can never enter the release."""
import hashlib
import json
import time
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parent
info = json.loads((root / 'plugin/info.json').read_text())
assert info['category'] == 'translate'
assert info['identifier'] == 'com.bob-plugin-codex-translate'
output = root / 'release' / ('bob-plugin-codex-translate-v' + info['version'] + '.bobplugin')
output.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as package:
    for name in ('info.json', 'main.js', 'service.js', 'auth.js', 'icon.png'):
        package.write(root / 'plugin' / name, name)
with zipfile.ZipFile(output) as package:
    assert set(package.namelist()) == {'info.json', 'main.js', 'service.js', 'auth.js', 'icon.png'}
    assert package.testzip() is None
digest = hashlib.sha256(output.read_bytes()).hexdigest()
(output.parent / 'SHA256SUMS').write_text(digest + '  ' + output.name + '\n')
appcast = { 'identifier': info['identifier'], 'versions': [{
    'version': info['version'],
    'desc': '新增翻译、润色、自定义提示词三种模式，默认翻译；自定义 System Prompt / User Prompt 支持原文及语言变量。保留浏览器登录、GPT-6 Luna 和 Low 默认设置。',
    'sha256': digest,
    'url': info['homepage'] + '/releases/download/v' + info['version'] + '/' + output.name,
    'minBobVersion': info['minBobVersion'], 'timestamp': int(time.time() * 1000)
}] }
(root / 'appcast.json').write_text(json.dumps(appcast, ensure_ascii=False, indent=2) + '\n')
bundle = output.parent / ('bob-plugin-codex-translate-v' + info['version'] + '.zip')
with zipfile.ZipFile(bundle, 'w', zipfile.ZIP_DEFLATED) as package:
    package.write(output, 'release/' + output.name)
    for name in ('README.md',):
        package.write(root / name, name)
with zipfile.ZipFile(bundle) as package:
    assert package.testzip() is None
    assert set(package.namelist()) == {'release/' + output.name, 'README.md'}
print('已生成 ' + str(output))
print('已生成完整安装包 ' + str(bundle))
