/**
 * 最短路径规划图层
 * - POST /api/route 获取 GeoJSON
 * - 紫色路径线 + 绿/红起终点
 */

import * as Cesium from "cesium";
import { flatCoordsForBasemap, toDisplayLonLat } from "./coordForBasemap.js";

const API_BASE = "http://127.0.0.1:8765";
const DS_NAME = "route-layer";

/** @type {Cesium.CustomDataSource|null} */
let _ds = null;

/**
 * 清空路径图层
 */
export function clearRouteLayer(viewer) {
  if (_ds) {
    viewer.dataSources.remove(_ds, true);
    _ds = null;
  }
}

/**
 * 规划并渲染最短路径
 * @param {Cesium.Viewer} viewer
 * @param {object} options
 * @param {{lng:number, lat:number}} options.origin
 * @param {{lng:number, lat:number}} options.destination
 * @param {string} [options.basemapType="tianditu"]
 */
export async function planRoute(viewer, options = {}) {
  const { origin, destination, basemapType = "tianditu" } = options;

  clearRouteLayer(viewer);
  _ds = new Cesium.CustomDataSource(DS_NAME);
  viewer.dataSources.add(_ds);

  const resp = await fetch(`${API_BASE}/api/route`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ origin, destination }),
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data.detail || `路径规划失败: ${resp.status}`);
  }

  const fc = data.route;
  if (!fc?.features?.length) {
    throw new Error("未返回路径数据");
  }

  for (const feat of fc.features) {
    const props = feat.properties || {};
    const geom = feat.geometry;
    if (!geom) continue;

    if (props.type === "route" && geom.type === "LineString") {
      const flat = geom.coordinates.flat();
      const coords = flatCoordsForBasemap(flat, basemapType);
      if (coords.length >= 4) {
        _ds.entities.add({
          name: "planned-route",
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArray(coords),
            width: 5,
            material: Cesium.Color.MEDIUMPURPLE.withAlpha(0.92),
            clampToGround: true,
          },
        });
      }
    } else if (props.type === "origin" && geom.type === "Point") {
      const [lon, lat] = toDisplayLonLat(geom.coordinates[0], geom.coordinates[1], basemapType);
      _ds.entities.add({
        name: "route-origin",
        position: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
        point: {
          pixelSize: 10,
          color: Cesium.Color.LIME,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
        },
        label: {
          text: "起",
          font: "12px sans-serif",
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -12),
        },
      });
    } else if (props.type === "destination" && geom.type === "Point") {
      const [lon, lat] = toDisplayLonLat(geom.coordinates[0], geom.coordinates[1], basemapType);
      _ds.entities.add({
        name: "route-destination",
        position: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
        point: {
          pixelSize: 10,
          color: Cesium.Color.RED,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
        },
        label: {
          text: "终",
          font: "12px sans-serif",
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -12),
        },
      });
    }
  }

  if (_ds.entities.values.length > 0) {
    viewer.flyTo(_ds, {
      offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-55), 6000),
      duration: 1.5,
    });
  }

  return data.summary;
}

export function isRouteLoaded() {
  return _ds !== null;
}
