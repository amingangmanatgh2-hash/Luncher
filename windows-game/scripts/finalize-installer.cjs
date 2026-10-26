'use strict';

/*
 * NSIS refuses (warning 9000, promoted to an error by electron-builder) to
 * compile an installer whose output file is literally named setup.exe.
 * electron-builder therefore emits NEON-RUSH-Setup.exe, and this final build
 * step renames the finished installer to the setup.exe name we ship. This is
 * only a file rename after compilation; the installer contents are unchanged.
 */

const fs = require('fs');
const path = require('path');

const outputDirectory = path.resolve(__dirname, '..', 'dist-windows');
const builtInstaller = path.join(outputDirectory, 'NEON-RUSH-Setup.exe');
const builtBlockmap = `${builtInstaller}.blockmap`;
const shippedInstaller = path.join(outputDirectory, 'setup.exe');
const shippedBlockmap = `${shippedInstaller}.blockmap`;

if (!fs.existsSync(builtInstaller)) {
  throw new Error(`electron-builder output not found at ${builtInstaller}`);
}

fs.rmSync(shippedInstaller, { force: true });
fs.rmSync(shippedBlockmap, { force: true });
fs.renameSync(builtInstaller, shippedInstaller);
if (fs.existsSync(builtBlockmap)) {
  fs.renameSync(builtBlockmap, shippedBlockmap);
}

console.log(`Renamed ${builtInstaller} to ${shippedInstaller}`);
