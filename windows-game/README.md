# NEON RUSH for Windows

This folder packages the shared NEON RUSH WebGL game as a native Windows
installer named **`setup.exe`**.

The game source is not duplicated here. `scripts/copy-game.cjs` copies the
canonical build from `../app/src/main/assets/game` before every start/build.

## Run locally

```powershell
cd windows-game
npm ci
npm start
```

## Build the installer

Run on Windows:

```powershell
cd windows-game
npm ci
npm run dist
```

Output:

```text
windows-game/dist-windows/setup.exe
```

GitHub Actions runs the same command in `.github/workflows/windows.yml` and
uploads the result as the **`neon-rush-windows-setup`** artifact. The artifact
ZIP contains `setup.exe`, a SHA-256 file and build information.

## Notes

- The game runs fully offline after installation.
- Best score and settings stay in the Electron per-user profile.
- The installer is unsigned, like the existing Luncher Windows build, so
  Windows SmartScreen may show **More info → Run anyway** on first launch.
