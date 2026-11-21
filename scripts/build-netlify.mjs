import { cpSync, mkdirSync } from 'node:fs';

const output = new URL('../dist/client/', import.meta.url);
mkdirSync(output, { recursive: true });
cpSync(new URL('../index.html', import.meta.url), new URL('index.html', output));
cpSync(new URL('../assets/', import.meta.url), new URL('assets/', output), {
  recursive: true,
});
