#!/usr/bin/env node
/**
 * 관리자 비밀번호의 scrypt 해시를 만든다. 서버에는 이 해시만 ADMIN_PASSWORD_HASH 로 넣는다(평문은 어디에도 두지 않는다).
 *
 *   node scripts/admin-password.mjs                         터미널에서 두 번 입력(화면에 보이지 않는다)
 *   printf '%s' "$PW" | node scripts/admin-password.mjs     표준입력으로(파이프)
 *
 * 출력: scrypt$N$r$p$소금$해시  (소금과 해시는 base64url). .env에 넣을 때는 작은따옴표로 감싼다($가 들어 있다)
 */
import { randomBytes, scrypt } from 'node:crypto';

const N = 32768;
const r = 8;
const p = 1;
const KEY_LEN = 32;

/** 터미널이면 글자를 보이지 않게 한 줄을 읽는다 */
function readHidden(prompt) {
  return new Promise((resolve, reject) => {
    const { stdin, stderr } = process;
    stderr.write(prompt);
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const finish = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', onData);
      stderr.write('\n');
    };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') {
          finish();
          resolve(value);
          return;
        }
        if (ch === '\u0003') {
          finish();
          reject(new Error('취소했습니다'));
          return;
        }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function readPiped() {
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  return text.replace(/\r?\n$/, '');
}

async function main() {
  let password;
  if (process.stdin.isTTY) {
    password = await readHidden('관리자 비밀번호: ');
    const again = await readHidden('한 번 더: ');
    if (password !== again) throw new Error('두 번 입력한 값이 다릅니다');
  } else {
    password = await readPiped();
  }
  if (password.length < 12) throw new Error('비밀번호는 12자 이상이어야 합니다');
  if (password.length > 1024) throw new Error('비밀번호가 너무 깁니다');
  const salt = randomBytes(16);
  const key = await new Promise((resolve, reject) =>
    scrypt(password, salt, KEY_LEN, { N, r, p, maxmem: 256 * N * r }, (err, k) => (err ? reject(err) : resolve(k))),
  );
  process.stdout.write(`scrypt$${N}$${r}$${p}$${salt.toString('base64url')}$${key.toString('base64url')}\n`);
}

main().catch((err) => {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
});
