'use strict';
const fs = require('fs');
const path = require('path');

// config.json is written from the phone page (link.js) or, as a fallback, by
// provision.sh over SSH. Keys are never typed on the head unit and never
// leave this file except in provider requests.
const PROVIDERS = ['anthropic', 'openai'];
const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5-5';

function file(dataDir) { return path.join(dataDir, 'config.json'); }
function key(value) { return typeof value === 'string' && /^\S{8,400}$/.test(value); }

function validate(raw) {
    if (!raw || typeof raw !== 'object') throw new Error('config.json is not an object');
    if (PROVIDERS.indexOf(raw.provider) < 0) throw new Error('config.json: provider must be anthropic or openai');
    const config = {
        provider: raw.provider,
        anthropicKey: key(raw.anthropicKey) ? raw.anthropicKey : null,
        anthropicModel: typeof raw.anthropicModel === 'string' && raw.anthropicModel ? raw.anthropicModel : DEFAULT_ANTHROPIC_MODEL,
        openaiKey: key(raw.openaiKey) ? raw.openaiKey : null,
        openaiModel: typeof raw.openaiModel === 'string' && raw.openaiModel ? raw.openaiModel : null,
        rootToken: key(raw.rootToken) ? raw.rootToken : null,
        allowRoot: raw.allowRoot === true || (raw.allowRoot === undefined && key(raw.rootToken)),
        maxSteps: Number.isInteger(raw.maxSteps) && raw.maxSteps >= 1 && raw.maxSteps <= 40 ? raw.maxSteps : 12
    };
    ready(config, config.provider);
    return config;
}

function ready(config, provider) {
    if (provider === 'anthropic' && !config.anthropicKey) throw new Error('No Anthropic API key in config.json');
    if (provider === 'openai' && !config.openaiKey) throw new Error('No OpenAI API key in config.json');
    if (provider === 'openai' && !config.openaiModel) throw new Error('Set openaiModel in config.json');
}

function load(dataDir) {
    const target = file(dataDir);
    let stat;
    try { stat = fs.statSync(target); }
    catch (e) { throw new Error('Not set up. Scan the code with your phone to add an API key.'); }
    if (process.platform !== 'win32' && (stat.mode & 63)) throw new Error('config.json must be mode 0600');
    let raw;
    try { raw = JSON.parse(fs.readFileSync(target, 'utf8')); }
    catch (e) { throw new Error('config.json is not valid JSON'); }
    return validate(raw);
}

// Switching provider on the head unit only changes the "provider" field.
function setProvider(dataDir, provider) {
    const target = file(dataDir);
    const raw = JSON.parse(fs.readFileSync(target, 'utf8'));
    raw.provider = provider;
    const config = validate(raw);
    const temporary = target + '.' + require('crypto').randomBytes(16).toString('hex');
    fs.writeFileSync(temporary, JSON.stringify(raw, null, 2) + '\n', { mode: 384, flag: 'wx' });
    try { fs.renameSync(temporary, target); }
    finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    return config;
}

// Settings sent from the phone page. Fields that are left out keep their
// saved value, so a provider can be switched without typing a key again.
function update(dataDir, changes) {
    const target = file(dataDir);
    let raw = {};
    try { raw = JSON.parse(fs.readFileSync(target, 'utf8')); } catch (e) { raw = {}; }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) raw = {};
    if (!changes || typeof changes !== 'object') throw new Error('No settings sent');
    if (PROVIDERS.indexOf(changes.provider) < 0) throw new Error('Choose Claude or OpenAI');
    raw.provider = changes.provider;
    ['anthropicKey', 'openaiKey'].forEach(name => {
        if (changes[name] === undefined) return;
        if (!key(changes[name])) throw new Error('That API key does not look right');
        raw[name] = changes[name];
    });
    if (changes.openaiModel !== undefined) {
        if (typeof changes.openaiModel !== 'string' || !/^[\w.:\/-]{1,100}$/.test(changes.openaiModel)) throw new Error('That model id does not look right');
        raw.openaiModel = changes.openaiModel;
    }
    if (changes.allowRoot !== undefined) raw.allowRoot = changes.allowRoot === true;
    const config = validate(raw);
    const temporary = target + '.' + require('crypto').randomBytes(16).toString('hex');
    fs.writeFileSync(temporary, JSON.stringify(raw, null, 2) + '\n', { mode: 384, flag: 'wx' });
    try { fs.renameSync(temporary, target); }
    finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    return config;
}

function other(provider) { return provider === 'anthropic' ? 'openai' : 'anthropic'; }
function secrets(config) { return [config.anthropicKey, config.openaiKey, config.rootToken].filter(Boolean); }

module.exports = { load, setProvider, update, validate, other, secrets, file, DEFAULT_ANTHROPIC_MODEL };
