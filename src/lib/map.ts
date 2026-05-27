import type { CargoListing, VesselAvailability } from '../types'

// Tabler icon class for cargo by category
export const cargoIconClass = (cargoType: string, _category?: string): string => {
  const unitized = ['BREAK BULK', 'PROJECT']
  if (unitized.includes(cargoType.toUpperCase())) return 'ti-package'
  return 'ti-stack-2'
}

// Scope colour for cargo marker
export const scopeColor = (status: string): string => {
  if (status === 'IN') return '#97C459'
  if (status === 'PARTIAL') return '#EF9F27'
  return '#E24B4A'
}

// Vessel triangle colour by status
export const vesselColor = (status: string, openDate?: string): string => {
  if (openDate && new Date(openDate) < new Date() && status === 'OPEN') return '#E24B4A'
  if (status === 'OPEN') return '#97C459'
  if (status === 'ON SUBS') return '#EF9F27'
  return 'rgba(255,255,255,0.2)'
}

// Vessel triangle size by DWT class
export const vesselSize = (dwt?: number): { width: number; height: number } => {
  if (!dwt) return { width: 10, height: 17 }
  if (dwt < 5000)   return { width: 8,  height: 14 }
  if (dwt < 35000)  return { width: 10, height: 17 }
  if (dwt < 55000)  return { width: 12, height: 20 }
  return { width: 14, height: 24 }
}

// Build cargo divIcon HTML — 3 zoom states
export const cargoMarkerHTML = (cargo: CargoListing, zoom: number): string => {
  const color = scopeColor(cargo.status)
  const wog = cargo.is_wog
    ? `<span style="position:absolute;top:3px;right:3px;width:5px;height:5px;border-radius:50%;background:#EF9F27;"></span>`
    : ''

  if (zoom <= 6) {
    return `<div style="width:8px;height:8px;border-radius:50%;background:${color};border:1px solid rgba(255,255,255,0.3);"></div>`
  }

  if (zoom <= 8) {
    return `<div style="display:flex;align-items:center;gap:4px;padding:2px 6px 2px 4px;background:rgba(10,22,36,0.7);border:0.5px solid rgba(255,255,255,0.12);border-left:2px solid ${color};border-radius:3px;white-space:nowrap;backdrop-filter:blur(2px);position:relative;">
      <span style="width:5px;height:5px;border-radius:50%;background:${color};flex-shrink:0;"></span>
      <span style="font-size:8px;font-weight:500;color:rgba(255,255,255,0.75);font-family:Inter,sans-serif;">${cargo.commodity_name}</span>
      ${wog}
    </div>`
  }

  const icon = cargoIconClass(cargo.cargo_type, cargo.commodity_category)
  return `<div style="width:44px;height:30px;background:rgba(10,22,36,0.65);border:0.5px solid rgba(255,255,255,0.10);border-left:2px solid ${color};border-radius:3px;padding:3px 4px;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:2px;backdrop-filter:blur(2px);position:relative;">
    <i class="ti ${icon}" style="font-size:11px;color:rgba(255,255,255,0.8);"></i>
    <span style="font-size:7.5px;color:rgba(255,255,255,0.65);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:36px;font-family:Inter,sans-serif;">${cargo.commodity_name}</span>
    ${wog}
  </div>`
}

// Build vessel triangle divIcon HTML
export const vesselMarkerHTML = (va: VesselAvailability, course: number = 0): string => {
  const dwt = va.vessel?.dwcc ?? va.vessel?.dwt_grain
  const { width, height } = vesselSize(dwt)
  const color = vesselColor(va.status, va.open_date)

  return `<div style="
    width:0;height:0;
    border-left:${width/2}px solid transparent;
    border-right:${width/2}px solid transparent;
    border-bottom:${height}px solid ${color};
    transform:rotate(${course}deg);
    filter:drop-shadow(0 0 3px ${color}80);
    cursor:pointer;
  "></div>`
}

// Build cluster bubble HTML
export const clusterHTML = (count: number): { html: string; size: number } => {
  const size = count < 10 ? 28 : count < 50 ? 34 : 40
  const html = `<div style="
    width:${size}px;height:${size}px;border-radius:50%;
    background:rgba(24,95,165,0.85);
    border:1.5px solid #7BB8F0;
    display:flex;align-items:center;justify-content:center;
    color:#fff;font-size:11px;font-weight:600;
    font-variant-numeric:tabular-nums;font-family:Inter,sans-serif;
  ">${count}</div>`
  return { html, size }
}

// Carto Dark Matter tile URL
export const TILE_URLS = {
  base: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  seaMap: 'https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png',
}

export const TILE_ATTRIBUTION = '© OpenStreetMap contributors © CARTO'

// Default map view — Arabian Gulf
export const DEFAULT_CENTER: [number, number] = [24.0, 54.5]
export const DEFAULT_ZOOM = 6
