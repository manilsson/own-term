// Packaging for macOS with Electron Forge: `npm run release` builds, signs and publishes a version
// (docs/releasing.md). The zip is what the app's updater downloads; the dmg is for first installs.

const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

/** The certificate every release is signed with; Squirrel only installs an update signed like the running app. */
const identity = process.env.OWN_TERM_SIGN_IDENTITY ?? ''

module.exports = {
  packagerConfig: {
    name: 'Own Term',
    // What macOS keys the app's permissions, keychain items and update checks to; fixed for good.
    appBundleId: 'se.mnilsson.ownterm',
    appCategoryType: 'public.app-category.developer-tools',
    icon: './build/icon',
    // node-pty runs its spawn helper from a real path; the zsh files are copied out at launch (main.cjs).
    asar: { unpack: '**/node-pty/build/Release/**' },
    // Only the main process, the built renderer and production dependencies ship.
    ignore: [
      /^\/(src|site|docs|scripts|build|out|\.vercel|\.claude)(\/|$)/,
      /^\/(index\.html|tsconfig\.json|vite\.config\.mts|forge\.config\.cjs|RELEASE_NOTES\.md|CLAUDE\.md|README\.md)$/,
      /^\/\./,
      /^\/node_modules\/\.vite(\/|$)/,
      // Other platforms' prebuilt binaries.
      /^\/node_modules\/node-pty\/prebuilds\/(?!darwin-arm64)/,
      /\.map$/,
    ],
  },
  hooks: {
    // A plain deep codesign with the self-signed identity: without a Team ID the hardened runtime's
    // library validation can't be satisfied, and Squirrel only needs the signature to match.
    postPackage: async (_config, result) => {
      if (!identity || result.platform !== 'darwin') return
      for (const dir of result.outputPaths) {
        for (const app of fs.readdirSync(dir).filter(name => name.endsWith('.app'))) {
          execFileSync('codesign', ['--force', '--deep', '--sign', identity, path.join(dir, app)], { stdio: 'inherit' })
        }
      }
    },
  },
  rebuildConfig: {},
  makers: [
    // The update manifest is written by scripts/release.mjs, which knows where the zip is published.
    { name: '@electron-forge/maker-zip', platforms: ['darwin'] },
    { name: '@electron-forge/maker-dmg', platforms: ['darwin'], config: { name: 'Own Term' } },
  ],
  plugins: [{ name: '@electron-forge/plugin-auto-unpack-natives', config: {} }],
}
