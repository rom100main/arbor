# Arbor Third-Party Notices

Arbor includes third-party software and assets under a variety of
open-source licenses. This file records the components, their copyright
notices, and the license text under which each is distributed.

The bundled-assets section is generated from `scripts/licenses/assets.json`. The
npm-dependency section lists the packages in Arbor's production dependency
closure (derived from `package-lock.json`), along with the license under which
each is distributed via the `generate-license-file` npm package. This file is
produced by `scripts/licenses/generate.ts`; do not edit it by hand.

Arbor runs on Electron. Electron's license and Chromium's third-party licenses
are shipped with each build as `LICENSE.electron.txt` and
`LICENSES.chromium.html` by electron-builder, and are not repeated here.
