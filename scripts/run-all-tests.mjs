import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const scriptsDir = path.resolve(process.cwd(), 'scripts');
const files = fs.readdirSync(scriptsDir)
  .filter(f => f.startsWith('test-') && f.endsWith('.ts'))
  .sort();

console.log(`Found ${files.length} test scripts in scripts/\n`);

const results = [];

for (const file of files) {
  const filePath = path.join(scriptsDir, file);
  const start = Date.now();
  const proc = spawnSync('node', ['--import', 'tsx', filePath], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test' },
    timeout: 15000,
  });
  const duration = Date.now() - start;

  if (proc.status === 0) {
    results.push({ file, status: 'PASS', duration, error: null });
    console.log(`✓ PASS  ${file} (${duration}ms)`);
  } else {
    const errorMsg = (proc.stderr || proc.stdout || 'Unknown error').trim().split('\n').slice(-3).join(' ');
    results.push({ file, status: 'FAIL', duration, error: errorMsg });
    console.log(`✗ FAIL  ${file} (${duration}ms) -> ${errorMsg.slice(0, 80)}`);
  }
}

const passed = results.filter(r => r.status === 'PASS').length;
const failed = results.filter(r => r.status === 'FAIL').length;

console.log(`\n========================================`);
console.log(`Test Summary: ${passed} passed, ${failed} failed out of ${files.length} scripts`);
console.log(`========================================\n`);

if (failed > 0) {
  console.log('Failed scripts:');
  for (const r of results.filter(r => r.status === 'FAIL')) {
    console.log(` - ${r.file}: ${r.error}`);
  }
}
