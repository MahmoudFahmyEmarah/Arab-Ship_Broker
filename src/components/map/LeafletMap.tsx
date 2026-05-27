import React, { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet.markercluster'
import 'leaflet/dist/leaflet.css'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import 'leaflet.markercluster/dist/MarkerCluster.Default.css'
import type { CargoListing, VesselAvailability, SubscriptionTier } from '../../types'
import { supabase } from '../../lib/supabase'
import {
  cargoMarkerHTML, vesselMarkerHTML, clusterHTML,
  TILE_URLS, TILE_ATTRIBUTION, DEFAULT_CENTER, DEFAULT_ZOOM
} from '../../lib/map'

interface Props {
  cargo: CargoListing[]
  vessels: VesselAvailability[]
  selectedCargo?: CargoListing | null
  selectedVessel?: VesselAvailability | null
  tier?: SubscriptionTier
  showCargo?: boolean
  showTonnage?: boolean
  showZones?: boolean
  onCargoClick?: (c: CargoListing) => void
  onVesselClick?: (v: VesselAvailability) => void
}

const LeafletMap: React.FC<Props> = ({
  cargo, vessels, selectedCargo, selectedVessel, tier: _tier,
  showCargo = true, showTonnage = true,
  onCargoClick, onVesselClick
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null)
  const routeLayerRef = useRef<L.LayerGroup | null>(null)
  const cargoMarkersRef = useRef<Map<string, L.Marker>>(new Map())
  const vesselMarkersRef = useRef<Map<string, L.Marker>>(new Map())
  const portsRef = useRef<Map<string, { lat: number; lng: number; name: string }>>(new Map())
  const [zoom, setZoom] = useState(DEFAULT_ZOOM)

  // Initialise map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = L.map(containerRef.current, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      zoomControl: false,
      attributionControl: true,
    })

    L.tileLayer(TILE_URLS.base, { attribution: TILE_ATTRIBUTION, maxZoom: 18 }).addTo(map)
    L.tileLayer(TILE_URLS.seaMap, { maxZoom: 18, opacity: 0.6 }).addTo(map)

    const clusterGroup = L.markerClusterGroup({
      maxClusterRadius: 40,
      iconCreateFunction: (cluster) => {
        const c = cluster.getChildCount()
        const { html, size } = clusterHTML(c)
        return L.divIcon({ html, className: '', iconSize: [size, size], iconAnchor: [size/2, size/2] })
      }
    })
    map.addLayer(clusterGroup)
    clusterRef.current = clusterGroup

    routeLayerRef.current = L.layerGroup().addTo(map)

    map.on('zoomend', () => setZoom(map.getZoom()))
    map.on('click', () => { routeLayerRef.current?.clearLayers() })

    mapRef.current = map

    // Load port coordinates
    supabase.from('ports').select('locode, trade_name, latitude, longitude').then(({ data }) => {
      const m = new Map()
      ;(data ?? []).forEach((p: any) => {
        if (p.latitude && p.longitude) {
          m.set(p.locode, { lat: p.latitude, lng: p.longitude, name: p.trade_name })
        }
      })
      portsRef.current = m
    })

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Render cargo markers
  useEffect(() => {
    if (!mapRef.current || !clusterRef.current) return

    // Remove old cargo markers
    cargoMarkersRef.current.forEach(m => clusterRef.current!.removeLayer(m))
    cargoMarkersRef.current.clear()

    if (!showCargo) return

    cargo.forEach(c => {
      const port = portsRef.current.get(c.load_port_locode ?? '')
      if (!port) return

      const icon = L.divIcon({
        html: cargoMarkerHTML(c, zoom),
        className: '',
        iconSize: zoom <= 6 ? [8, 8] : zoom <= 8 ? [80, 18] : [44, 30],
        iconAnchor: zoom <= 6 ? [4, 4] : zoom <= 8 ? [4, 9] : [22, 30]
      })

      const marker = L.marker([port.lat, port.lng], { icon })
      marker.on('click', () => onCargoClick?.(c))
      clusterRef.current!.addLayer(marker)
      cargoMarkersRef.current.set(c.id, marker)
    })
  }, [cargo, showCargo, zoom])

  // Render vessel markers
  useEffect(() => {
    if (!mapRef.current || !clusterRef.current) return

    vesselMarkersRef.current.forEach(m => clusterRef.current!.removeLayer(m))
    vesselMarkersRef.current.clear()

    if (!showTonnage) return

    vessels.forEach(va => {
      const lat = va.lat
      const lng = va.lng
      let actualLat = lat, actualLng = lng
      if (!actualLat || !actualLng) {
        const port = portsRef.current.get(va.open_port_locode ?? '')
        if (port) { actualLat = port.lat; actualLng = port.lng }
      }
      if (!actualLat || !actualLng) return

      const dwt = va.vessel?.dwcc ?? va.vessel?.dwt_grain
      const size = dwt && dwt < 5000 ? 14 : dwt && dwt < 35000 ? 17 : dwt && dwt < 55000 ? 20 : 24
      const icon = L.divIcon({
        html: vesselMarkerHTML(va, 0),
        className: '',
        iconSize: [size, size],
        iconAnchor: [size/2, size/2]
      })

      const marker = L.marker([actualLat, actualLng], { icon })
      marker.on('click', () => onVesselClick?.(va))
      clusterRef.current!.addLayer(marker)
      vesselMarkersRef.current.set(va.id, marker)
    })
  }, [vessels, showTonnage])

  // Cargo selection — zoom to route
  useEffect(() => {
    if (!mapRef.current || !routeLayerRef.current || !selectedCargo) return
    const map = mapRef.current
    routeLayerRef.current.clearLayers()

    const pol = portsRef.current.get(selectedCargo.load_port_locode ?? '')
    const pod = portsRef.current.get(selectedCargo.disch_port_locode ?? '')
    if (!pol || !pod) return

    map.fitBounds([[pol.lat, pol.lng], [pod.lat, pod.lng]], { padding: [60, 60], maxZoom: 9 })

    L.polyline([[pol.lat, pol.lng], [pod.lat, pod.lng]], {
      color: '#185FA5', weight: 1.5, dashArray: '6,4', opacity: 0.7
    }).addTo(routeLayerRef.current)

    L.circleMarker([pol.lat, pol.lng], { radius: 6, color: '#97C459', fill: false, weight: 1.5 }).addTo(routeLayerRef.current)
    L.circleMarker([pod.lat, pod.lng], { radius: 6, color: '#E24B4A', fill: false, weight: 1.5 }).addTo(routeLayerRef.current)
  }, [selectedCargo])

  // Vessel selection — pan to position
  useEffect(() => {
    if (!mapRef.current || !selectedVessel) return
    const port = portsRef.current.get(selectedVessel.open_port_locode ?? '')
    const lat = selectedVessel.lat ?? port?.lat
    const lng = selectedVessel.lng ?? port?.lng
    if (lat && lng) {
      mapRef.current.flyTo([lat, lng], 10, { duration: 1.2 })
    }
  }, [selectedVessel])

  return (
    <div ref={containerRef} style={{
      width: '100%', height: '100%',
      background: '#0d1b2a',
    }} />
  )
}

export default LeafletMap
