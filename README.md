# Timekeeper

A cross-platform desktop app (Windows, macOS, Linux) for tracking work time against project codes.

- **Timer** with a project, description and tags. Starting a new timer stops the running one.
- **Projects, clients and tags.** Each project has a code, a name, an optional client and a color picked from a color picker, presets or a hex value.
- **Rounding** per entry, to the nearest 15 minutes by default. Change the increment (off, 1, 5, 6, 10, 15, 30 min) and the mode (nearest, always up, always down) in Settings. Exact start and end times are always stored, so changing the setting re-rounds past entries.
- **Inline editing** of entries on the Timer screen, with delete and **Undo**. The entry table's columns can be dragged into a new order.
- **Idle detection.** After the idle threshold (5 minutes by default) a system notification says the time is still being counted. On macOS it has Keep, Discard and Discard-and-stop buttons; on Windows and Linux, clicking it opens the prompt. When you come back, a small always-on-top prompt asks what to do with the idle time. Sleep and screen lock count as idle time.
- **Crash-safe timer.** A running timer is saved the moment it starts. If the app closes or the computer restarts, the timer resumes, and any long gap is offered as idle time.
- **Reports** by day, month and year: total hours, hours per day or month, and breakdowns by project, client (pie chart) and tag, with filters.
- **Excel export** of a filtered timesheet: an Entries sheet and a Summary sheet with live `SUMIFS` formulas and project colors.
- **Tray / menu bar** icon with the running time, start/stop and a project switcher. Closing the window keeps the app running in the tray.
- Light and dark themes.

## Development

Requires Node.js 22 or newer.

```bash
npm install
npm run dev        # run with hot reload
npm test           # unit tests (rounding, reports, storage, idle logic, Excel export)
npm run typecheck
```

## Building installers

```bash
npm run dist:win    # NSIS installer, on Windows
npm run dist:mac    # DMG, on macOS
npm run dist:linux  # AppImage and .deb
```

Installers are written to `dist/`. Build each platform on that platform.

**Code signing.** Builds are unsigned by default, so Windows SmartScreen and macOS Gatekeeper show a warning on first launch. To sign:

- **macOS:** an Apple Developer ID certificate in your keychain, plus `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` for notarization. See the [electron-builder code signing docs](https://www.electron.build/code-signing).
- **Windows:** set `CSC_LINK` (path or base64 of a .pfx) and `CSC_KEY_PASSWORD`, or use Azure Trusted Signing.

## Where data lives

All data is in one SQLite file in the OS app-data folder (for example `~/Library/Application Support/Timekeeper/timekeeper.db` on macOS or `%APPDATA%\Timekeeper\timekeeper.db` on Windows). Settings shows the exact path and has a **Back up now** button. Set `TIMEKEEPER_DB` to use a different file.

SQLite runs as WebAssembly ([sql.js](https://sql.js.org)), so there are no native modules to rebuild for each platform. The database is written atomically after every change.

## Project layout

```
src/main/       Electron main process: database, IPC, idle detection, tray, Excel export
src/preload/    The typed bridge exposed to the UI as window.api
src/shared/     Types and pure logic shared by both sides: rounding, reports, time helpers
src/renderer/   React UI: Timer, Reports, Projects, Settings, Export dialog, idle prompt
tests/          Vitest unit tests
resources/      App and tray icons
```

## Known limitations

- **Linux on Wayland:** some Wayland desktops don't report idle time to apps, so idle detection may not fire. Sleep and screen lock are still detected. Settings shows a notice when this applies.
- **Linux tray:** GNOME needs the AppIndicator extension to show tray icons.
- Notification action buttons appear only on macOS. On Windows and Linux, click the notification or answer the prompt that appears when you return.
- "Open at login" is not available on Linux.
