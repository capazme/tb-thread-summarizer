// Generate the Thunderbird update manifest (updates.json) for self-distributed
// auto-updates. The add-on id and minimum Thunderbird version are read from
// manifest.json so they can never drift from the shipped extension.
//
// Usage:
//   node scripts/gen-updates-json.mjs <version> <update_link> [<update_hash>]
//
// Example:
//   node scripts/gen-updates-json.mjs 0.1.3 \
//     https://github.com/capazme/tb-thread-summarizer/releases/download/v0.1.3/tb-thread-summarizer-0.1.3.xpi \
//     sha256:abcd... > updates.json
import { readFileSync } from 'node:fs';

const [version, updateLink, updateHash] = process.argv.slice(2);

if (!version || !updateLink) {
  console.error('Usage: gen-updates-json.mjs <version> <update_link> [<update_hash>]');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const gecko = manifest.browser_specific_settings?.gecko ?? {};
const id = gecko.id;
const strictMinVersion = gecko.strict_min_version;

if (!id) {
  console.error('manifest.json is missing browser_specific_settings.gecko.id');
  process.exit(1);
}

const update = { version, update_link: updateLink };
if (updateHash) update.update_hash = updateHash;
if (strictMinVersion) {
  update.applications = { gecko: { strict_min_version: strictMinVersion } };
}

const manifestOut = { addons: { [id]: { updates: [update] } } };
process.stdout.write(`${JSON.stringify(manifestOut, null, 2)}\n`);
