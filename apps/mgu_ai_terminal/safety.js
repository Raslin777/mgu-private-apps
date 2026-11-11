'use strict';
// Safety checks shared by the app and the root helper (which re-checks every
// command on the privileged side). These are filters, not a sandbox: the
// on-screen approval is the real boundary. A deny rule can never be approved.

const MAX_PROMPT = 4000;
const MAX_COMMAND = 4000;

const SECRETS = [
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/,
    /\bsk-[A-Za-z0-9_-]{20,}/,
    /\bgh[pousr]_[A-Za-z0-9]{30,}/,
    /\bAKIA[0-9A-Z]{16}\b/
];

// Word stems, so "flashing", "overwritten" and "disabled" match too.
const VEHICLE_VERB = '(?:re-?flash|flash|re-?program|cod(?:e|ing)|eras|wip|unlock|disabl|bypass|delet|reset|overwrit|writ)\\w{0,4}';
const VEHICLE_NOUN = '(?:ecus?|dme|dde|egs|dsc|abs|airbags?|srs|immobili[sz]er|vin|odometer|mileage|bootloader|firmware|swfl|btld|cafd)';
const VEHICLE = new RegExp('\\b' + VEHICLE_VERB + '\\b[^.\\n]{0,60}\\b' + VEHICLE_NOUN + '\\b|\\b' +
    VEHICLE_NOUN + '\\b[^.\\n]{0,60}\\b' + VEHICLE_VERB + '\\b', 'i');

function checkPrompt(text) {
    if (typeof text !== 'string') return { ok: false, reason: 'Enter a request' };
    const clean = text.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').trim();
    if (!clean) return { ok: false, reason: 'Enter a request' };
    if (clean.length > MAX_PROMPT) return { ok: false, reason: 'Request is longer than ' + MAX_PROMPT + ' characters' };
    if (SECRETS.some(r => r.test(clean))) return { ok: false, reason: 'Request contains a key or password; remove it' };
    if (VEHICLE.test(clean)) {
        return { ok: false, reason: 'Control-unit coding, flashing and safety-system changes are outside AI Terminal' };
    }
    return { ok: true, text: clean };
}

const SHELLS = '(?:sudo\\s+)?(?:sh|bash|ash|dash|zsh|node|python[0-9.]*|perl)\\b';
const SYSTEM_DIRS = '(?:bin|boot|dev|etc|lib|lib64|opt|proc|root|sbin|sys|usr|var|home|run|data|mnt)';
const END = '(?=\\s|$|;|&|\\|)';

// [pattern, reason]. Matched against the command with whitespace collapsed.
const DENY = [
    [new RegExp('\\brm\\b[^|;&]*\\s(?:--no-preserve-root|/\\*?' + END + '|/' + SYSTEM_DIRS + '/?\\*?' + END + ')'), 'deletes a system directory'],
    [/\b(?:mkfs(?:\.\w+)?|mke2fs|wipefs|blkdiscard|fdisk|sfdisk|sgdisk|parted|hdparm)\b/, 'changes disks or partitions'],
    [/\bdd\b[^|;&]*\bof=\/dev\//, 'writes directly to a device'],
    [/>\s*\/dev\/(?:sd|mmcblk|nvme|mtd|ubi|block|disk|mem|kmem)/, 'writes directly to a device'],
    [/\b(?:flashcp|flash_erase(?:all)?|nandwrite|ubiformat|ubiupdatevol|fw_setenv|fastboot|swupdate)\b/, 'writes firmware or boot settings'],
    [/:\s*\(\s*\)\s*\{/, 'is a fork bomb'],
    [new RegExp('\\b(?:curl|wget|fetch|nc|ncat)\\b[^;&]*\\|\\s*' + SHELLS), 'downloads and runs code in one step'],
    [new RegExp('\\bbase64\\b[^;&]*\\|\\s*' + SHELLS), 'runs hidden (encoded) code'],
    [/\/etc\/(?:shadow|gshadow|sudoers)\b/, 'touches the password or sudo database'],
    [/(?:^|[\s\/"'=])\.ssh(?:\/|\b)|\bauthorized_keys\b|\bid_(?:rsa|dsa|ecdsa|ed25519)\b|\bssh_host_\w*key\b/, 'touches SSH keys'],
    [/\.(?:pem|key|p12|pfx)\b/, 'touches a key or certificate file'],
    [/\bauth\.json\b|mgu-ai-root\/token|\broot_key\b|\brootkey\.js\b|(?:^|[\s\/"'=])\.\.\/config\.json\b/, 'touches stored credentials'],
    [/\b(?:passwd|chpasswd|usermod|useradd|userdel|visudo)\b/, 'changes user accounts'],
    [/\bsystemctl\s+(?:stop|disable|mask|kill)\b[^;&|]*\b(?:recmgr|oapcontroller|hmi|winston|sshd?|dropbear|systemd\S*|mgu-deploy\S*|mgu-ai-root\S*)/, 'stops a service the head unit depends on'],
    [/\bkill(?:all5)?\s+(?:-\S+\s+)*1(?=\s|$)/, 'kills the init process'],
    [new RegExp('\\b(?:chmod|chown|chgrp)\\s+(?:\\S+\\s+)*-[A-Za-z]*R[A-Za-z]*\\s+(?:\\S+\\s+)*/(?:' + SYSTEM_DIRS + ')?/?' + END), 'changes permissions across a system directory'],
    [new RegExp('\\bmv\\s+(?:-\\S+\\s+)*/(?:' + SYSTEM_DIRS + ')/?' + END), 'moves a system directory'],
    [/\b(?:cansend|cangen|canplayer|isotpsend|cansequence)\b/, 'writes to the vehicle bus']
];

// [pattern, label]. Allowed with approval, but called out on the review screen.
const FLAGS = [
    [/\b(?:reboot|shutdown|poweroff|halt)\b|\binit\s+[06]\b/, 'RESTARTS THE HEAD UNIT'],
    [/\bmount\b[^;&|]*\bremount\b/, 'REMOUNTS A FILE SYSTEM'],
    [/\brm\s+(?:\S+\s+)*-[A-Za-z]*[rRf]/, 'DELETES FILES'],
    [/\bsystemctl\s+(?:start|stop|restart|enable|disable|mask|daemon-reload)\b/, 'CHANGES A SERVICE'],
    [/\b(?:curl|wget|nc|ncat|scp|sftp|ssh|rsync|ftp|tftp)\b/, 'USES THE NETWORK'],
    [/\b(?:iptables|ip6tables|nft|setenforce)\b/, 'CHANGES SECURITY SETTINGS']
];

function checkCommand(command, options) {
    options = options || {};
    const deny = reason => ({ action: 'deny', reason: reason, flags: [] });
    if (typeof command !== 'string' || !command.trim()) return deny('the command is empty');
    if (command.length > MAX_COMMAND) return deny('the command is longer than ' + MAX_COMMAND + ' characters');
    if (/[\x00-\x08\x0b-\x1f\x7f]/.test(command)) return deny('the command contains control characters');
    const flat = command.replace(/\s+/g, ' ').trim();
    if (!options.root && /(?:^|[\s;&|(])(?:sudo|su|doas)(?=\s|$)/.test(flat)) {
        return deny('it switches user; root commands must be requested as root');
    }
    const paths = options.protectedPaths || [];
    for (let i = 0; i < paths.length; i++) {
        if (paths[i] && flat.indexOf(paths[i]) >= 0) return deny('it touches stored credentials');
    }
    for (let i = 0; i < DENY.length; i++) {
        if (DENY[i][0].test(flat)) return deny('it ' + DENY[i][1]);
    }
    const flags = [];
    if (options.root) flags.push('RUNS AS ROOT');
    FLAGS.forEach(f => { if (f[0].test(flat)) flags.push(f[1]); });
    return { action: 'ask', reason: '', flags: flags };
}

// Literal secrets never go back to the model or onto the screen.
function redact(text, secrets) {
    let out = String(text);
    (secrets || []).forEach(secret => {
        if (typeof secret === 'string' && secret.length >= 8) out = out.split(secret).join('[redacted]');
    });
    return out;
}

module.exports = { checkPrompt, checkCommand, redact, MAX_PROMPT, MAX_COMMAND };
