/**
 * npm에 올릴 CLI 꾸러미를 dist/npm 에 만든다(올리지는 않는다). 실행: npm run pack:cli
 *
 * 저장소의 package.json은 서버와 화면까지 담은 비공개 꾸러미(chen-erd)라서 그대로 올릴 수 없다.
 * 올리는 것은 빌드된 CLI 한 파일(dist/cli/modelll.js)이고, 의존성이 모두 그 안에 들어 있어 dependencies가 없다.
 *
 *   dist/npm/modelll.js      빌드된 CLI
 *   dist/npm/package.json    여기서 만든다(이름 modelll, 버전은 저장소의 것)
 *   dist/npm/README.md       scripts/npm-readme.md
 *   dist/npm/LICENSE
 *
 * 확인: (cd dist/npm && npm pack --dry-run)
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** 저장소 안의 경로 */
const at = (relative) => fileURLToPath(new URL(`../${relative}`, import.meta.url));

const rootPackage = JSON.parse(readFileSync(at('package.json'), 'utf8'));
const bundle = at('dist/cli/modelll.js');

if (!existsSync(bundle)) {
  console.error('dist/cli/modelll.js 가 없습니다. npm run build:cli 를 먼저 실행합니다.');
  process.exit(1);
}
// 예전에 빌드한 파일을 그대로 싸는 일을 막는다
const built = execFileSync(process.execPath, [bundle, '--version'], { encoding: 'utf8' }).trim();
if (built !== `modelll ${rootPackage.version}`) {
  console.error(`빌드된 CLI의 버전(${built})이 package.json의 버전(${rootPackage.version})과 다릅니다. npm run build:cli 를 다시 실행합니다.`);
  process.exit(1);
}

const manifest = {
  name: 'modelll',
  version: rootPackage.version,
  description: 'CLI and MCP server for modelll: create, read and update collaborative Chen-notation ER diagrams as plain text',
  keywords: ['erd', 'er-diagram', 'entity-relationship', 'chen-notation', 'diagram', 'database', 'data-modeling', 'mcp', 'model-context-protocol', 'cli'],
  homepage: 'https://modelll.app',
  repository: { type: 'git', url: 'git+https://github.com/heyoonyoon/modelll.git' },
  bugs: { url: 'https://github.com/heyoonyoon/modelll/issues' },
  license: 'MIT',
  type: 'module',
  bin: { modelll: 'modelll.js' },
  files: ['modelll.js', 'README.md', 'LICENSE'],
  engines: { node: rootPackage.engines?.node ?? '>=20' },
};

const out = at('dist/npm');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
copyFileSync(bundle, at('dist/npm/modelll.js'));
chmodSync(at('dist/npm/modelll.js'), 0o755);
copyFileSync(at('scripts/npm-readme.md'), at('dist/npm/README.md'));
copyFileSync(at('LICENSE'), at('dist/npm/LICENSE'));
writeFileSync(at('dist/npm/package.json'), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`dist/npm: ${manifest.name}@${manifest.version}`);
