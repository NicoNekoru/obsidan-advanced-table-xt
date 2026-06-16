import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

let manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const { minAppVersion, version } = manifest;

let targetVersion;

// eslint-disable-next-line no-undef
switch (process.argv[2])
{
	case '--major':
		targetVersion = version.replace(/(\d+)\.\d+\.\d+/, (version, major) => `${Number(major) + 1}.0.0`);
		break;
	case '--minor':
		targetVersion = version.replace(/(\d+)\.(\d+)\.\d+/, (version, major, minor) => `${major}.${Number(minor) + 1}.0`);
		break;
	default:
		targetVersion = version.replace(/(\d+)\.(\d+)\.(\d+)/, (version, major, minor, patch) => `${major}.${minor}.${Number(patch) + 1}`);
}

manifest.version = targetVersion;
writeFileSync('manifest.json', JSON.stringify(manifest, null, '\t'));

let versions = JSON.parse(readFileSync('versions.json', 'utf8'));
versions[targetVersion] = minAppVersion;
writeFileSync('versions.json', JSON.stringify(versions, null, '\t'));

console.log('building');
execSync('pnpm run build', { stdio: 'inherit' });

console.log('updating git');
// Cross-platform: run each command separately with the platform's default shell
// (bash/sh on macOS/Linux, cmd on Windows) instead of forcing powershell.exe.
try
{
	execSync('git commit -am "version bump"', { stdio: 'inherit' });
}
catch
{
	console.log('nothing to commit');
}
execSync('git push', { stdio: 'inherit' });
execSync(
	`gh release create ${targetVersion} main.js styles.css manifest.json --generate-notes`,
	{ stdio: 'inherit' }
);