var service = require('./service');
var auth = require('./auth');

function supportLanguages() { return service.languages; }
function pluginTimeoutInterval() { return 120; }
function translate(query) { auth.translate(query); }
function pluginValidate(completion) {
    auth.validate(completion);
}
