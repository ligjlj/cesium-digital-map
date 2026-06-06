/**
 * 路网/轨迹坐标与底图对齐
 * - 后端数据为 GCJ-02（高德路网原生坐标）
 * - 高德底图：直接使用 GCJ-02 经纬度渲染（与瓦片对齐）
 * - 天地图/离线：GCJ-02 → WGS84 后再渲染
 */

import { gcj02ToWgs84, wgs84ToGcj02 } from "./transformGcj02.js";

/** 底图是否使用 GCJ-02 瓦片（无需纠偏） */
export function isGcjBasemap(basemapType) {
  return basemapType === "gaode";
}

/** 单点：后端 GCJ-02 → 当前底图下的显示坐标 */
export function toDisplayLonLat(lon, lat, basemapType) {
  if (isGcjBasemap(basemapType)) return [lon, lat];
  return gcj02ToWgs84(lon, lat);
}

/** [lon, lat, lon, lat, ...] 扁平数组转显示坐标 */
export function flatCoordsForBasemap(flat, basemapType) {
  const out = [];
  for (let i = 0; i < flat.length; i += 2) {
    const [lon, lat] = toDisplayLonLat(flat[i], flat[i + 1], basemapType);
    out.push(lon, lat);
  }
  return out;
}

/** 地图点击/显示坐标 → 后端 GCJ-02 */
export function fromDisplayLonLat(lon, lat, basemapType) {
  if (isGcjBasemap(basemapType)) return [lon, lat];
  return wgs84ToGcj02(lon, lat);
}

/** [[lon, lat], ...] 点列转显示坐标 */
export function pointListForBasemap(points, basemapType) {
  return points.map(([lon, lat]) => toDisplayLonLat(lon, lat, basemapType));
}
