#!/usr/bin/env node
import { mkdir, readFile } from 'fs/promises'
import { extname, isAbsolute, resolve } from 'path'
import process from 'process'
import { IdentityManager } from './src/index.js'
import { defaultStorageDir } from './src/storage-path.js'

function usage() {
  return `
facebonk [--dir PATH] <command>

Commands:
  init
  serve
  whoami
  profile show
  profile set [--name NAME] [--bio BIO] [--avatar PATH] [--clear-avatar]
  link create [--expires-ms N]
  link join <invite>
  devices list
  devices revoke <writerKey>
`.trim()
}

function parseArgs(argv) {
  const args = [...argv]
  let baseDir = defaultStorageDir()

  while (args[0] === '--dir' || args[0] === '--storage') {
    args.shift()
    const value = args.shift()
    if (!value) {
      throw new Error('--dir/--storage requires a value')
    }
    baseDir = isAbsolute(value) ? value : resolve(process.cwd(), value)
  }

  return { baseDir, args }
}

function getArgv() {
  if (globalThis.Bare && Array.isArray(globalThis.Bare.argv)) {
    return globalThis.Bare.argv.slice(2)
  }

  return process.argv.slice(2)
}

async function ensureBaseDir(path) {
  await mkdir(path, { recursive: true })
}

function isUsageError(error) {
  if (!error || typeof error.message !== 'string') return false

  return (
    error.message.startsWith('Unknown command:') ||
    error.message.includes('requires a value') ||
    error.message.includes('requires an invite string') ||
    error.message.includes('requires a writer key') ||
    error.message.includes('profile set --')
  )
}

function formatRuntimeError(error, baseDir) {
  const message = error?.message ?? String(error)

  if (message.includes('File descriptor could not be locked')) {
    return [
      `Data dir is already open: ${baseDir}`,
      'Stop the other facebonk process using that directory, or pass `--dir PATH`.'
    ].join('\n')
  }

  return message
}

function formatProfile(profile) {
  if (!profile) {
    return 'No shared profile set.'
  }

  const lines = [
    `displayName: ${profile.displayName ?? ''}`,
    `bio: ${profile.bio ?? ''}`,
    `updatedAt: ${profile.updatedAt ?? ''}`
  ]

  if (profile.avatar) {
    lines.push(`avatarMimeType: ${profile.avatarMimeType ?? ''}`)
    lines.push(`avatarBlobKey: ${Buffer.from(profile.avatar.key).toString('hex')}`)
    lines.push(`avatarBytes: ${profile.avatar.byteLength}`)
  } else {
    lines.push('avatar: ')
  }

  return lines.join('\n')
}

function formatSummary(summary) {
  if (!summary) {
    return 'No identity initialized.'
  }

  const lines = [
    `identityKey: ${summary.identityKey}`,
    `writerKey: ${summary.writerKey}`,
    '',
    formatProfile(summary.profile),
    '',
    'devices:'
  ]

  for (const device of summary.devices) {
    lines.push(`- ${device.writerKey} (${device.roles.join(', ')})`)
  }

  return lines.join('\n')
}

async function promptForProfile() {
  const { createInterface } = await import('readline/promises')
  const { stdin: input, stdout: output } = await import('process')
  const rl = createInterface({ input, output })

  try {
    const displayName = await rl.question('Display name: ')
    const bio = await rl.question('Bio: ')
    return { displayName, bio }
  } finally {
    rl.close()
  }
}

function inferMimeType(filePath) {
  const extension = extname(filePath).toLowerCase()

  if (extension === '.png') return 'image/png'
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  if (extension === '.webp') return 'image/webp'
  if (extension === '.gif') return 'image/gif'
  if (extension === '.avif') return 'image/avif'
  if (extension === '.svg') return 'image/svg+xml'

  return null
}

async function interactive(manager) {
  const { createInterface } = await import('readline/promises')
  const { stdin: input, stdout: output } = await import('process')
  const rl = createInterface({ input, output })

  try {
    await manager.initIdentity()

    while (true) {
      console.log('\n1. Show active identity')
      console.log('2. Edit profile')
      console.log('3. Create link invite')
      console.log('4. List devices')
      console.log('5. Exit')

      const answer = (await rl.question('Choose an action: ')).trim()

      if (answer === '1') {
        console.log(formatSummary(await manager.getSummary()))
        continue
      }

      if (answer === '2') {
        const displayName = await rl.question('Display name: ')
        const bio = await rl.question('Bio: ')
        const identity = await manager.getActiveIdentity()
        await identity.setProfile({ displayName, bio })
        console.log('Profile updated.')
        continue
      }

      if (answer === '3') {
        const identity = await manager.getActiveIdentity()
        const invite = await identity.createLinkInvite()
        console.log(invite)
        continue
      }

      if (answer === '4') {
        const identity = await manager.getActiveIdentity()
        const devices = await identity.listDevices()
        for (const device of devices) {
          console.log(`${device.writerKey} (${device.roles.join(', ')})`)
        }
        continue
      }

      if (answer === '5') {
        return
      }
    }
  } finally {
    rl.close()
  }
}

async function serve(manager) {
  const identity = await manager.initIdentity()
  const identityKey = identity.key.toString('hex')

  console.log(`Serving identity ${identityKey}`)
  console.log('Press Ctrl+C to stop.')

  await new Promise((resolve) => {
    let settled = false

    const finish = () => {
      if (settled) return
      settled = true
      process.off('SIGINT', finish)
      process.off('SIGTERM', finish)
      resolve()
    }

    process.on('SIGINT', finish)
    process.on('SIGTERM', finish)
  })
}

async function main() {
  const { baseDir, args } = parseArgs(getArgv())
  await ensureBaseDir(baseDir)

  const manager = new IdentityManager(baseDir)
  await manager.ready()

  try {
    if (args.length === 0) {
      await interactive(manager)
      return
    }

    const [command, subcommand, ...rest] = args

    if (command === 'init') {
      const profile = await manager.initIdentity()
      console.log(profile.key.toString('hex'))
      return
    }

    if (command === 'serve') {
      await serve(manager)
      return
    }

    if (command === 'whoami') {
      console.log(formatSummary(await manager.getSummary()))
      return
    }

    if (command === 'profile' && subcommand === 'show') {
      const identity = await manager.getActiveIdentity()
      console.log(formatProfile(await identity?.getProfile()))
      return
    }

    if (command === 'profile' && subcommand === 'set') {
      let displayName
      let bio
      let avatarPath
      let clearAvatar = false

      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === '--name') {
          displayName = rest[++i]
          if (displayName === undefined) {
            throw new Error('profile set --name requires a value')
          }
          continue
        }

        if (rest[i] === '--bio') {
          bio = rest[++i]
          if (bio === undefined) {
            throw new Error('profile set --bio requires a value')
          }
          continue
        }

        if (rest[i] === '--avatar') {
          avatarPath = rest[++i]
          if (avatarPath === undefined) {
            throw new Error('profile set --avatar requires a value')
          }
          continue
        }

        if (rest[i] === '--clear-avatar') {
          clearAvatar = true
        }
      }

      if (displayName === undefined && bio === undefined && avatarPath === undefined && !clearAvatar) {
        const prompted = await promptForProfile()
        displayName = prompted.displayName
        bio = prompted.bio
      }

      const identity = await manager.initIdentity()
      let profile = await identity.getProfile()

      if (displayName !== undefined || bio !== undefined) {
        profile = await identity.setProfile({ displayName, bio })
      }

      if (avatarPath !== undefined) {
        const resolvedPath = isAbsolute(avatarPath) ? avatarPath : resolve(process.cwd(), avatarPath)
        const bytes = await readFile(resolvedPath)
        profile = await identity.setAvatar(bytes, {
          mimeType: inferMimeType(resolvedPath)
        })
      } else if (clearAvatar) {
        profile = await identity.clearAvatar()
      }

      console.log(formatProfile(profile))
      return
    }

    if (command === 'link' && subcommand === 'create') {
      let expiresInMs

      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === '--expires-ms') {
          expiresInMs = Number(rest[++i])
        }
      }

      const identity = await manager.initIdentity()
      const invite = await identity.createLinkInvite({ expiresInMs })
      console.log(invite)
      return
    }

    if (command === 'link' && subcommand === 'join') {
      const invite = rest[0]
      if (!invite) {
        throw new Error('link join requires an invite string')
      }

      const identity = await manager.joinIdentity(invite)
      console.log(identity.key.toString('hex'))
      return
    }

    if (command === 'devices' && subcommand === 'list') {
      const identity = await manager.getActiveIdentity()
      if (!identity) {
        console.log('No identity initialized.')
        return
      }

      const devices = await identity.listDevices()
      for (const device of devices) {
        console.log(`${device.writerKey} (${device.roles.join(', ')})`)
      }
      return
    }

    if (command === 'devices' && subcommand === 'revoke') {
      const writerKey = rest[0]
      if (!writerKey) {
        throw new Error('devices revoke requires a writer key')
      }

      const identity = await manager.getActiveIdentity()
      if (!identity) {
        throw new Error('No identity initialized.')
      }

      const revoked = await identity.revokeDevice(writerKey)
      console.log(revoked ? 'revoked' : 'not-found')
      return
    }

    throw new Error(`Unknown command: ${args.join(' ')}`)
  } finally {
    await manager.close()
  }
}

main().catch((error) => {
  const { baseDir } = parseArgs(getArgv())
  console.error(formatRuntimeError(error, baseDir))

  if (isUsageError(error)) {
    console.error('')
    console.error(usage())
  }

  process.exitCode = 1
})
