import { copyFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const dist = path.join(
  path.dirname(require.resolve('maplibre-gl/package.json')),
  'dist',
)
const destination = path.join(process.cwd(), 'public', 'maplibre')

mkdirSync(destination, { recursive: true })

copyFileSync(
  path.join(dist, 'maplibre-gl-worker.mjs'),
  path.join(destination, 'maplibre-gl-worker.mjs'),
)

copyFileSync(
  path.join(dist, 'maplibre-gl-shared.mjs'),
  path.join(destination, 'maplibre-gl-shared.mjs'),
)
