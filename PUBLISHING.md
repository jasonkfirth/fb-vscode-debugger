# Publishing Guide

The checked-in manifest intentionally keeps `publisher: "local"` so local
testing does not depend on Marketplace metadata.

When you are ready to publish, use `package.marketplace.template.json` as a
reference for the final `package.json` metadata values.

## Before packaging

1. Create or choose your Visual Studio Marketplace publisher.
2. Copy the template fields you want from `package.marketplace.template.json`
   into `package.json`.
3. Replace the placeholder values:
   - `publisher`
   - `repository.url`
   - `homepage`
   - `bugs.url`
4. Make sure the icon, README, changelog, license, and third-party notices are
   all in their final form.

## Install packaging tools

```powershell
npm install -g @vscode/vsce
```

## Validate the extension package contents

```powershell
npm run lint
npm run package:vsix
```

This creates a `.vsix` package in the repository root.

## Install the packaged extension locally

```powershell
code --install-extension .\freebasic-native-debugger-0.1.0.vsix --force
```

## Publish to the Marketplace

Login is handled through `vsce`. You will need a publisher and a Personal
Access Token with Marketplace publishing rights.

Common publish commands:

```powershell
npm run publish:manual
```

Version bump helpers:

```powershell
npm run publish:patch
npm run publish:minor
npm run publish:major
```

## Pre-release packages

```powershell
npm run package:pre-release
```

## Recommended release checklist

- `npm run lint` passes
- local `.vsix` installs cleanly
- compiler discovery works with `fbc` / `fbc.exe`
- missing-tool messages are readable
- compile failures appear in Problems
- launch, run, and basic stepping work on a real `.bas` file
- README screenshots and wording match the shipped behavior
