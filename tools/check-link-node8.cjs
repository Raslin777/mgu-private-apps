'use strict';
// Runs under Node 8: start the phone link, pair over real HTTP, read state, and syntax-check the page script.
var assert = require('assert'), http = require('http'), path = require('path'), vm = require('vm');
var mod = require(path.join(process.argv[2] || path.join(__dirname, '..'), 'apps', 'mgu_ai_terminal', 'link'));
var script = /<script>([\s\S]*)<\/script>/.exec(mod.PAGE)[1];
new vm.Script(script);
var link = new mod.PhoneLink({ port: 0, addresses: function () { return ['127.0.0.1']; }, handlers: {
    state: function () { return { configured: false, status: 'Not set up', lines: [], approval: null }; },
    setup: function () {}, ask: function () {}, stop: function () {}, reset: function () {} } });
function call(method, url, body, token, done) {
    var data = body ? JSON.stringify(body) : null, headers = {};
    if (data) { headers['content-type'] = 'application/json'; headers['content-length'] = Buffer.byteLength(data); }
    if (token) headers['x-link-token'] = token;
    var req = http.request({ host: '127.0.0.1', port: link.port, method: method, path: url, headers: headers }, function (res) {
        var text = ''; res.on('data', function (c) { text += c; }); res.on('end', function () { done(res.statusCode, text); });
    });
    req.end(data);
}
link.start().then(function () {
    call('POST', '/api/pair', { code: link.code }, null, function (status, text) {
        assert.equal(status, 200);
        call('GET', '/api/state', null, JSON.parse(text).token, function (status2, text2) {
            assert.equal(status2, 200);
            assert.equal(JSON.parse(text2).status, 'Not set up');
            link.stop();
            console.log('Node ' + process.version + ': phone link pairing and page script checks passed');
        });
    });
}).catch(function (e) { console.error(e); process.exit(1); });
