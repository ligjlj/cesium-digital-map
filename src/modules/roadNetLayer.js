/**
 * 路网图层
 * - 从后端 API 加载路网 GeoJSON
 * - 使用 CustomDataSource 隔离渲染
 * - 高性能 Polyline 渲染（可选：视口裁剪）
 */

import * as Cesium from "cesium";
import { flatCoordsForBasemap, pointListForBasemap } from "./coordForBasemap.js";

const API_BASE = "http://127.0.0.1:8765";
const DS_NAME = "road-network-layer";

/** @type {Cesium.CustomDataSource|null} */
let _ds = null;

/**
 * 加载并渲染路网
 * @param {Cesium.Viewer} viewer
 * @param {object} [options]
 * @param {string} [options.color="#5599ff"] 路网颜色
 * @param {number} [options.alpha=0.5]
 * @param {number} [options.width=1.5]
 * @param {string} [options.basemapType="tianditu"] 当前底图类型（决定坐标纠偏）
 */
export async function loadRoadNetwork(viewer, options = {}) {
  const { color = "#4a90d9", alpha = 0.45, width = 1.5, basemapType = "tianditu" } = options;

  clearRoadNetwork(viewer);

  _ds = new Cesium.CustomDataSource(DS_NAME);
  viewer.dataSources.add(_ds);

  const resp = await fetch(`${API_BASE}/api/network`);
  if (!resp.ok) throw new Error(`加载路网失败: ${resp.status}`);
  const geojson = await resp.json();

  if (!geojson.features) return 0;

  let count = 0;
  for (const feat of geojson.features) {
    if (feat.geometry?.type !== "LineString") continue;
    const coords = flatCoordsForBasemap(feat.geometry.coordinates.flat(), basemapType);
    if (coords.length < 4) continue;

    _ds.entities.add({
      name: `link-${feat.properties?.link_id ?? count}`,
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray(coords),
        width: width,
        material: Cesium.Color.fromCssColorString(color).withAlpha(alpha),
        clampToGround: true,
      },
      properties: feat.properties || {},
    });
    count++;
  }

  if (count > 0) {
    viewer.flyTo(_ds, {
      offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-90), 25000),
      duration: 1.5,
    });
  }

  return count;
}

/**
 * 清空路网图层
 */
export function clearRoadNetwork(viewer) {
  if (_ds) {
    viewer.dataSources.remove(_ds, true);
    _ds = null;
  }
}

/**
 * 路网是否已加载
 */
export function isNetworkLoaded() {
  return _ds !== null;
}
