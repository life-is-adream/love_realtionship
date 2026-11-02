import {mkdtemp, mkdir, copyFile, readdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const original=path.resolve('relationship-simulator');
const isolated=await mkdtemp(path.join(os.tmpdir(),'heartflow-content-review-'));
await mkdir(path.join(isolated,'scripts'));
await mkdir(path.join(isolated,'long-simulation'));
await mkdir(path.join(isolated,'public','modules','content'),{recursive:true});
await copyFile(path.join(original,'scripts','build-long-index.mjs'),path.join(isolated,'scripts','build-long-index.mjs'));
await copyFile(path.join(original,'validate-long-simulation.mjs'),path.join(isolated,'validate-long-simulation.mjs'));
for(const file of await readdir(path.join(original,'long-simulation')))if(file.endsWith('.md'))await copyFile(path.join(original,'long-simulation',file),path.join(isolated,'long-simulation',file));
const build=spawnSync(process.execPath,['scripts/build-long-index.mjs'],{cwd:isolated,encoding:'utf8'});
console.log('BUILD_EXIT='+build.status); if(build.status!==0){console.log(build.stderr);process.exit(1)}
const validation=spawnSync(process.execPath,['validate-long-simulation.mjs'],{cwd:isolated,encoding:'utf8'});
console.log('LONG_VALIDATION_EXIT='+validation.status);if(validation.status!==0){console.log(validation.stderr);process.exit(1)}
const summary=JSON.parse(validation.stdout).summary;delete summary.generatedAt;console.log('LONG_CONTENT='+JSON.stringify(summary));
const manifestAt=base=>path.join(base,'public','modules','content','long-content-manifest.js');
const loaded=async file=>{const text=await readFile(file,'utf8');return JSON.parse(text.match(/export const \w+ = ([\s\S]+);\s*$/)[1]);};
const built=await loaded(manifestAt(isolated)),published=await loaded(manifestAt(original));delete built.generatedAt;delete published.generatedAt;assert.deepEqual(built,published);
let chunks=0;for(const file of await readdir(path.join(isolated,'public','modules','content','long-content'))){const rel=path.join('public','modules','content','long-content',file);assert.deepEqual(await loaded(path.join(isolated,rel)),await loaded(path.join(original,rel)));chunks++;}
console.log('MANIFEST_MATCH=true');console.log('CHUNKS_MATCH='+chunks);console.log('SOURCE_AND_PUBLISHED_FILES_UNCHANGED=true');
