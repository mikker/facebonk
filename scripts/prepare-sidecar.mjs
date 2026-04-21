import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'

const args = new Set(process.argv.slice(2))
const explicitTargetIndex = process.argv.indexOf('--target')
const explicitTarget =
  explicitTargetIndex !== -1 ? process.argv[explicitTargetIndex + 1] : null
const root = resolve(dirname(new URL(import.meta.url).pathname), '..')
const release = args.has('--release')
const target =
  explicitTarget ||
  process.env.TAURI_ENV_TARGET_TRIPLE ||
  process.env.CARGO_BUILD_TARGET ||
  inferTargetTriple()
const runtimePackage = currentBareRuntimePackageName()

if (!target || !runtimePackage) {
  console.error('Failed to determine the target for the Bare sidecar build.')
  process.exit(1)
}

const extension = process.platform === 'win32' ? '.exe' : ''
const builtBinary = join(
  root,
  'bare',
  'node_modules',
  runtimePackage,
  'bin',
  `bare${extension}`
)
const bundledBinary = join(
  root,
  'tauri',
  'binaries',
  `bare-${target}${extension}`
)
const stagedResourcesDir = join(root, 'tauri', 'resources')
const stagedBackendDir = join(stagedResourcesDir, 'bare')

mkdirSync(dirname(bundledBinary), { recursive: true })
chmodSync(builtBinary, 0o755)

const shouldCopy =
  !existsSync(bundledBinary) ||
  !readFileSync(builtBinary).equals(readFileSync(bundledBinary))

if (shouldCopy) {
  copyFileSync(builtBinary, bundledBinary)
  if (process.platform !== 'win32') chmodSync(bundledBinary, 0o755)
  console.log(`Prepared bare sidecar: ${bundledBinary}`)
} else {
  console.log(`Bare sidecar already up to date: ${bundledBinary}`)
}

if (!release) {
  mkdirSync(stagedResourcesDir, { recursive: true })
  mkdirSync(stagedBackendDir, { recursive: true })
  writeFileIfChanged(join(stagedBackendDir, '.keep'), '')
  copyFileIfChanged(join(root, 'pear.app.json'), join(stagedResourcesDir, 'pear.app.json'))
  console.log('Prepared placeholder packaged resources for debug builds.')
  process.exit(0)
}

rmSync(stagedBackendDir, { recursive: true, force: true })
mkdirSync(stagedResourcesDir, { recursive: true })
cpSync(join(root, 'bare'), stagedBackendDir, { recursive: true, dereference: true })
copyFileSync(join(root, 'pear.app.json'), join(stagedResourcesDir, 'pear.app.json'))
prunePrebuilds(stagedBackendDir)
pruneUnusedBareRuntimePackages(stagedBackendDir)

console.log(`Prepared backend resources: ${stagedBackendDir}`)

function inferTargetTriple() {
  if (process.platform === 'darwin' && process.arch === 'arm64') return 'aarch64-apple-darwin'
  if (process.platform === 'darwin' && process.arch === 'x64') return 'x86_64-apple-darwin'
  if (process.platform === 'linux' && process.arch === 'arm64') return 'aarch64-unknown-linux-gnu'
  if (process.platform === 'linux' && process.arch === 'x64') return 'x86_64-unknown-linux-gnu'
  if (process.platform === 'win32' && process.arch === 'x64') return 'x86_64-pc-windows-msvc'
  if (process.platform === 'win32' && process.arch === 'arm64') return 'aarch64-pc-windows-msvc'
  return null
}

function prunePrebuilds(stagedDir) {
  const keep = currentPrebuildName()
  if (!keep) return

  const nodeModules = join(stagedDir, 'node_modules')
  if (!existsSync(nodeModules)) return

  for (const packageName of readdirSync(nodeModules)) {
    const prebuildsDir = join(nodeModules, packageName, 'prebuilds')
    if (!existsSync(prebuildsDir)) continue

    for (const entry of readdirSync(prebuildsDir)) {
      if (entry !== keep) {
        rmSync(join(prebuildsDir, entry), { recursive: true, force: true })
      }
    }
  }
}

function pruneUnusedBareRuntimePackages(stagedDir) {
  const nodeModules = join(stagedDir, 'node_modules')
  if (!existsSync(nodeModules)) return

  for (const packageName of readdirSync(nodeModules)) {
    if (
      packageName === 'bare' ||
      packageName === 'bare-runtime' ||
      packageName.startsWith('bare-runtime-')
    ) {
      rmSync(join(nodeModules, packageName), { recursive: true, force: true })
    }
  }

  rmSync(join(nodeModules, '.bin', 'bare'), { force: true })
  rmSync(join(nodeModules, '.bin', 'bare.cmd'), { force: true })
}

function currentPrebuildName() {
  if (process.platform === 'darwin' && process.arch === 'arm64') return 'darwin-arm64'
  if (process.platform === 'darwin' && process.arch === 'x64') return 'darwin-x64'
  if (process.platform === 'linux' && process.arch === 'arm64') return 'linux-arm64'
  if (process.platform === 'linux' && process.arch === 'x64') return 'linux-x64'
  if (process.platform === 'win32' && process.arch === 'arm64') return 'win32-arm64'
  if (process.platform === 'win32' && process.arch === 'x64') return 'win32-x64'
  return null
}

function currentBareRuntimePackageName() {
  if (process.platform === 'darwin' && process.arch === 'arm64') return 'bare-runtime-darwin-arm64'
  if (process.platform === 'darwin' && process.arch === 'x64') return 'bare-runtime-darwin-x64'
  if (process.platform === 'linux' && process.arch === 'arm64') return 'bare-runtime-linux-arm64'
  if (process.platform === 'linux' && process.arch === 'x64') return 'bare-runtime-linux-x64'
  if (process.platform === 'win32' && process.arch === 'arm64') return 'bare-runtime-win32-arm64'
  if (process.platform === 'win32' && process.arch === 'x64') return 'bare-runtime-win32-x64'
  return null
}

function writeFileIfChanged(destination, contents) {
  if (existsSync(destination) && readFileSync(destination, 'utf8') === contents) return
  writeFileSync(destination, contents)
}

function copyFileIfChanged(source, destination) {
  if (existsSync(destination) && readFileSync(source).equals(readFileSync(destination))) return
  copyFileSync(source, destination)
}
