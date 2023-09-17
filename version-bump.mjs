import { readFileSync, writeFileSync } from 'fs';

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

