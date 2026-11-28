import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const output = new URL('../dist/client/', import.meta.url);
mkdirSync(output, { recursive: true });

cpSync(new URL('../assets/', import.meta.url), new URL('assets/', output), {
  recursive: true,
});

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let k = 0; k < 8; k++)
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  const result = Buffer.alloc(8 + body.length);
  result.writeUInt32BE(data.length, 0);
  body.copy(result, 4);
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
  return result;
}

for (const size of [192, 512]) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  const colors = [
    [255, 65, 65], [255, 153, 40], [255, 220, 50],
    [45, 205, 100], [50, 150, 255], [175, 85, 240]
  ];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const radius = Math.hypot(x / size - 0.5, y / size - 0.7);
      const band = Math.floor((0.4 - radius) / 0.043);
      const color = y / size <= 0.7 && band >= 0 && band < 6
        ? colors[band] : [15, 35, 70];
      const p = y * (size * 3 + 1) + 1 + x * 3;
      raw.set(color, p);
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;

  writeFileSync(new URL(`icon-${size}.png`, output), Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]));
}

const manifest = {
  id: '/',
  name: 'Rainbow Sports Billing',
  short_name: 'Rainbow Billing',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  background_color: '#ffffff',
  theme_color: '#16559c',
  icons: [192, 512].map(size => ({
    src: `/icon-${size}.png`,
    sizes: `${size}x${size}`,
    type: 'image/png'
  }))
};

writeFileSync(
  new URL('manifest.json', output),
  JSON.stringify(manifest, null, 2)
);

let html = readFileSync(
  new URL('../index.html', import.meta.url), 'utf8'
);

html = html.replace('</head>', `
<link rel="manifest" href="/manifest.json">
<link rel="apple-touch-icon" href="/icon-192.png">
<meta name="theme-color" content="#16559c">
</head>`);

writeFileSync(new URL('index.html', output), html);import { cpSync, mkdirSync } from 'node:fs';

const output = new URL('../dist/client/', import.meta.url);
mkdirSync(output, { recursive: true });
cpSync(new URL('../index.html', import.meta.url), new URL('index.html', output));
cpSync(new URL('../assets/', import.meta.url), new URL('assets/', output), {
  recursive: true,
});
