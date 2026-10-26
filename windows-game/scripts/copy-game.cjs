'use strict';

/*
 * Copy the canonical NEON RUSH build into this Electron app.
 *
 * The game source intentionally lives only in the Android assets tree:
 * app/src/main/assets/game. Duplicating it in git would make the browser,
 * Android and Windows builds drift apart, so the Windows package takes a
 * fresh copy every time it starts or is packaged.
 */

const fs = require('fs');
const path = require('path');

const windowsGameRoot = path.resolve(__dirname, '..');
const repositoryRoot = path.resolve(windowsGameRoot, '..');
const source = path.join(repositoryRoot, 'app', 'src', 'main', 'assets', 'game');
const destination = path.join(windowsGameRoot, 'game');
const entryPoint = path.join(source, 'index.html');

if (!fs.existsSync(entryPoint)) {
  throw new Error(`NEON RUSH game not found at ${source}`);
}

fs.rmSync(destination, { recursive: true, force: true });
fs.cpSync(source, destination, { recursive: true });

console.log(`Copied NEON RUSH from ${source} to ${destination}`);
