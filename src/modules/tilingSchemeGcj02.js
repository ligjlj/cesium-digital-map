import * as Cesium from "cesium";
import { gcj02ToWgs84 } from "./transformGcj02.js";

/**
 * 高德瓦片（GCJ-02）纠偏思路（渲染侧）：
 * - UrlTemplateImageryProvider 使用 WebMercatorTilingScheme 计算每个瓦片对应的地理范围（rectangle）
 * - Cesium 认为这个 rectangle 是 WGS84，从而将瓦片贴到 WGS84 的椭球面上
 * - 但高德底图实际是 GCJ-02，因此“瓦片的地理范围”应先从 GCJ-02 转回 WGS84
 *
 * 本类通过重写 tileXYToRectangle，将瓦片四角从 GCJ-02 反解为 WGS84，
 * 以此把 GCJ-02 瓦片贴回 WGS84 世界，避免空间要素叠加时出现整体偏移。
 *
 * 说明：
 * - 这是工程可落地的轻量纠偏方式；与严谨的大地测量学投影/反投影仍有细微误差
 * - 对城市级浏览与专题图叠加，一般足够满足“视觉不偏移”的业务需求
 */
export class Gcj02CorrectedWebMercatorTilingScheme extends Cesium.WebMercatorTilingScheme {
  /**
   * @param {Cesium.WebMercatorTilingScheme.ConstructorOptions} [options]
   */
  constructor(options) {
    super(options);
  }

  /**
   * 修正：取瓦片中心点的 GCJ-02 偏移量，均匀应用到四角。
   * 避免四角分别变换导致的非线性扭曲和瓦片错位。
   */
  tileXYToRectangle(x, y, level, result) {
    const rect = super.tileXYToRectangle(x, y, level, result);

    // 瓦片中心点（度）
    const centerLon = Cesium.Math.toDegrees((rect.west + rect.east) / 2.0);
    const centerLat = Cesium.Math.toDegrees((rect.south + rect.north) / 2.0);

    // 中心点从 GCJ-02 反解到 WGS84，得到偏移量
    const [wgsLon, wgsLat] = gcj02ToWgs84(centerLon, centerLat);
    const dLon = wgsLon - centerLon;
    const dLat = wgsLat - centerLat;

    // 均匀偏移四角（保持矩形不变形）
    rect.west  += Cesium.Math.toRadians(dLon);
    rect.east  += Cesium.Math.toRadians(dLon);
    rect.south += Cesium.Math.toRadians(dLat);
    rect.north += Cesium.Math.toRadians(dLat);

    return rect;
  }
}

