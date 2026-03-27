import { mkdir, mkdtemp } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

function candidateRoots() {
  const roots = []

  if (process.env.FACEBONK_TEST_TMPDIR) {
    roots.push(process.env.FACEBONK_TEST_TMPDIR)
  }

  roots.push(resolve(process.cwd(), 'tmp'))
  roots.push(tmpdir())

  return roots
}

export async function createTempDir(prefix) {
  const roots = candidateRoots()
  let lastError = null

  for (const root of roots) {
    try {
      await mkdir(root, { recursive: true })
      return await mkdtemp(join(root, prefix))
    } catch (error) {
      lastError = error
    }
  }

  throw lastError ?? new Error('Failed to create temp dir')
}
