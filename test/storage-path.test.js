import { join, resolve } from 'path'
import { homedir, tmpdir } from 'os'
import test from 'brittle'
import { defaultStorageDir } from '../cli/storage-path.js'

test('defaultStorageDir matches Pear dev-style storage in development', async (t) => {
  const actual = defaultStorageDir({
    env: {},
    platform: 'linux',
    pearStorage: null
  })

  t.is(actual, join(tmpdir(), 'pear', 'facebonk'))
})

test('defaultStorageDir prefers FACEBONK_DIR override', async (t) => {
  const actual = defaultStorageDir({
    env: { FACEBONK_DIR: './custom-facebonk' },
    platform: 'linux',
    pearStorage: null
  })

  t.is(actual, resolve('./custom-facebonk'))
})

test('defaultStorageDir prefers Pear storage when available', async (t) => {
  const actual = defaultStorageDir({
    env: {},
    platform: 'linux',
    pearStorage: '/pear/runtime/storage'
  })

  t.is(actual, '/pear/runtime/storage')
})

test('defaultStorageDir uses Pear production-style mac storage in production', async (t) => {
  const actual = defaultStorageDir({
    env: { NODE_ENV: 'production' },
    platform: 'darwin',
    pearStorage: null
  })

  t.is(actual, join(homedir(), 'Library', 'Application Support', 'facebonk'))
})
