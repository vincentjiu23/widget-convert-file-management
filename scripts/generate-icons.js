import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="bg" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#1e1b4b"/>
      <stop offset="60%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#030712"/>
    </radialGradient>
    <linearGradient id="glow" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#38bdf8"/>
      <stop offset="50%" stop-color="#818cf8"/>
      <stop offset="100%" stop-color="#c084fc"/>
    </linearGradient>
    <linearGradient id="ringGrad" x1="0%" y1="100%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#06b6d4"/>
      <stop offset="100%" stop-color="#a855f7"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="8" stdDeviation="16" flood-color="#38bdf8" flood-opacity="0.35"/>
    </filter>
  </defs>

  <!-- Background rounded app squircle -->
  <rect x="24" y="24" width="464" height="464" rx="108" fill="url(#bg)" stroke="#334155" stroke-width="4"/>

  <!-- Glowing outer radial track -->
  <circle cx="256" cy="256" r="170" fill="none" stroke="url(#ringGrad)" stroke-width="8" stroke-dasharray="14 10" opacity="0.75" filter="url(#shadow)"/>
  
  <!-- Outer pulse ring -->
  <circle cx="256" cy="256" r="140" fill="none" stroke="#38bdf8" stroke-width="3" opacity="0.4"/>

  <!-- Radial Segment Nodes -->
  <circle cx="256" cy="116" r="18" fill="#38bdf8" filter="url(#shadow)"/>
  <circle cx="396" cy="256" r="18" fill="#818cf8" filter="url(#shadow)"/>
  <circle cx="256" cy="396" r="18" fill="#c084fc" filter="url(#shadow)"/>
  <circle cx="116" cy="256" r="18" fill="#06b6d4" filter="url(#shadow)"/>

  <!-- Intermediate Nodes -->
  <circle cx="355" cy="157" r="10" fill="#60a5fa" opacity="0.8"/>
  <circle cx="355" cy="355" r="10" fill="#a855f7" opacity="0.8"/>
  <circle cx="157" cy="355" r="10" fill="#2dd4bf" opacity="0.8"/>
  <circle cx="157" cy="157" r="10" fill="#38bdf8" opacity="0.8"/>

  <!-- Central Glassmorphic Core Orb -->
  <circle cx="256" cy="256" r="88" fill="#0f172a" fill-opacity="0.85" stroke="url(#glow)" stroke-width="5" filter="url(#shadow)"/>
  <circle cx="256" cy="256" r="80" fill="url(#glow)" fill-opacity="0.15"/>

  <!-- Convert arrows symbol in center -->
  <g fill="none" stroke="#ffffff" stroke-width="12" stroke-linecap="round" stroke-linejoin="round">
    <!-- Top curved arrow pointing right -->
    <path d="M 200 220 A 45 45 0 0 1 310 220"/>
    <polyline points="296 195 315 220 290 238"/>
    <!-- Bottom curved arrow pointing left -->
    <path d="M 312 292 A 45 45 0 0 1 202 292"/>
    <polyline points="216 317 197 292 222 274"/>
  </g>
</svg>`;

async function buildIcons() {
  const buildDir = path.resolve('build');
  if (!fs.existsSync(buildDir)) {
    fs.mkdirSync(buildDir, { recursive: true });
  }

  const svgBuf = Buffer.from(svg);

  // Generate 512x512 master PNG
  const png512 = await sharp(svgBuf).resize(512, 512).png().toBuffer();
  fs.writeFileSync(path.join(buildDir, 'icon.png'), png512);
  console.log('[Icon] Created build/icon.png (512x512)');

  // Generate multi-size PNGs for ICO
  const sizes = [256, 128, 64, 48, 32, 16];
  const pngBuffers = await Promise.all(
    sizes.map(size => sharp(svgBuf).resize(size, size).png().toBuffer())
  );

  // Assemble Windows .ICO structure
  // Header: 6 bytes
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // Reserved
  header.writeUInt16LE(1, 2); // Type 1 = ICO
  header.writeUInt16LE(sizes.length, 4); // Image count

  const dirEntries = [];
  let currentOffset = 6 + sizes.length * 16;

  for (let i = 0; i < sizes.length; i++) {
    const s = sizes[i];
    const buf = pngBuffers[i];
    const entry = Buffer.alloc(16);
    entry.writeUInt8(s === 256 ? 0 : s, 0); // Width (0 for 256)
    entry.writeUInt8(s === 256 ? 0 : s, 1); // Height (0 for 256)
    entry.writeUInt8(0, 2); // Color palette
    entry.writeUInt8(0, 3); // Reserved
    entry.writeUInt16LE(1, 4); // Color planes
    entry.writeUInt16LE(32, 6); // Bits per pixel
    entry.writeUInt32LE(buf.length, 8); // Image data size in bytes
    entry.writeUInt32LE(currentOffset, 12); // Offset in file
    dirEntries.push(entry);
    currentOffset += buf.length;
  }

  const icoBuffer = Buffer.concat([header, ...dirEntries, ...pngBuffers]);
  fs.writeFileSync(path.join(buildDir, 'icon.ico'), icoBuffer);
  console.log('[Icon] Created build/icon.ico with sizes:', sizes.join(', '));
}

buildIcons().catch(err => {
  console.error('[Icon] Error building icons:', err);
  process.exit(1);
});
