'use client'

import { useEffect } from 'react'
import { maplibreGL } from '@maplibre/maplibre-gl-leaflet'
import { setWorkerUrl } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useMap } from 'react-leaflet'

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

    const layer = maplibreGL({
      style: LIBERTY_STYLE_URL,
      interactive: false,
      attributionControl: { customAttribution: ATTRIBUTION },
    })

    layer.addTo(map)

    return () => {
      if (map.hasLayer(layer)) map.removeLayer(layer)
    }
  }, [map])

  return null
}
