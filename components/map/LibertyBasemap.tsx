'use client'

import { useEffect } from 'react'
import { maplibreGL } from '@maplibre/maplibre-gl-leaflet'
import { setWorkerUrl, type StyleSpecification } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useMap } from 'react-leaflet'
import { getPlayAreaNavigationBounds } from '@/lib/geo/playArea'

// Local copy of OpenFreeMap's Liberty style. Hosting the style document here
// lets us make small compatibility/decluttering tweaks while its vector tiles,
// sprites, and fonts continue to come from OpenFreeMap.
const LIBERTY_STYLE_URL = '/maps/liberty.json'
const ATTRIBUTION =
  '<a href="https://openfreemap.org/">OpenFreeMap</a> | ' +
  '&copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> ' +
  'Data from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'

export function LibertyBasemap() {
  const map = useMap()

  useEffect(() => {
    map.attributionControl.setPrefix(false)
    setWorkerUrl('/maplibre/maplibre-gl-worker.mjs')

    const controller = new AbortController()
    let layer: ReturnType<typeof maplibreGL> | null = null

    const addLayer = async () => {
      const response = await fetch(LIBERTY_STYLE_URL, {
        cache: 'force-cache',
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`map_style_${response.status}`)
      const style = (await response.json()) as StyleSpecification
      const [[south, west], [north, east]] = getPlayAreaNavigationBounds()
      const sourceBounds: [number, number, number, number] = [west, south, east, north]

      // MapLibre's source bounds are stronger than a visual mask: the renderer
      // does not request vector/raster tiles that sit fully beyond this box.
      for (const source of Object.values(style.sources)) {
        if (
          source.type === 'vector' ||
          source.type === 'raster' ||
          source.type === 'raster-dem'
        ) {
          source.bounds = sourceBounds
        }
      }
      if (controller.signal.aborted) return

      layer = maplibreGL({
        style,
        interactive: false,
        renderWorldCopies: false,
        attributionControl: { customAttribution: ATTRIBUTION },
      })
      layer.addTo(map)
    }

    void addLayer().catch(() => {
      // An aborted fetch means the map unmounted. Other style failures leave
      // the existing dark map background in place instead of retrying an
      // unrestricted source.
    })

    return () => {
      controller.abort()
      if (layer && map.hasLayer(layer)) map.removeLayer(layer)
    }
  }, [map])

  return null
}
