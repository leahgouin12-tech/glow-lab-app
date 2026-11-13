# THE GLOW LAB — build source

This is the buildable source of Glow Lab, a local-first personal appearance
platform: one responsive web app that runs on iPhone, Android, Windows and macOS,
works with no network, and keeps every photograph, measurement and log in the
browser or webview storage on the device. No account, no server, no telemetry,
no paid API of any kind.

This repository exists so the iOS build can run at all. GitHub gives macOS
runners to public repositories and not to private ones on the Free plan, so the
Xcode step has to live here. It carries only files this project authored.

What is deliberately not here, and why:

- a 25 MiB archive of Pinterest saves, and the reference image folders in the
  private tree, which are other people's photography. Those are not ours to
  redistribute, so they never enter a public repository.
- the project documentation, research notes and screenshots.
- the scripts that reach Pinterest. The app itself never contacts Pinterest: the
  import feature reads an archive that sits beside it, or links you paste.

Consequence of the missing archive: with no `pinterest-saves.zip` next to it, the
app reads nothing at open, the Discover reference sets that are bundled here
still work, and the importer says there is no archive on this device instead of
pretending otherwise.

## Run it

    npm ci
    npm run dev        # http://localhost:5177
    npm run build      # dist/, then the service worker precache
    npm test           # vitest, real IndexedDB through jsdom

## Install on an iPhone

Two routes, both free:

1. **Home screen (no Apple ID, no re-signing).** This repository publishes
   `dist/` to GitHub Pages on every push to `main`. Open the Pages URL in Safari
   on the iPhone, then Share → Add to Home Screen. It then runs full screen and
   offline; the service worker keeps the whole app cached.
2. **AltStore (a real .ipa).** Run the "iOS unsigned build" workflow, take the
   `GlowLab-unsigned-ipa` artifact, host it, and add its source to AltStore. AltStore
   signs it on the phone with your own Apple ID, every 7 days. The wrapper bundle
   id is `com.glowlab.iphone`; nothing in here ever sees your credentials.

Your data is never in this repository and never in its build output.
