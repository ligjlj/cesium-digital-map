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
   * 将瓦片的 WGS84 rectangle（Cesium 原始计算结果）视为 GCJ-02，
   * 然后把四角点从 GCJ-02 反解回 WGS84，重新拼出纠偏后的 rectangle。
   */
  tileXYToRectangle(x, y, level, result) {
    const rect = super.tileXYToRectangle(x, y, level, result);

    // rect 的经纬度被“误认为”是 WGS84；我们将其当作 GCJ-02 来做反解
    const sw = gcj02ToWgs84(
      Cesium.Math.toDegrees(rect.west),
      Cesium.Math.toDegrees(rect.south)
    );
    const ne = gcj02ToWgs84(
      Cesium.Math.toDegrees(rect.east),
      Cesium.Math.toDegrees(rect.north)
    );

    rect.west = Cesium.Math.toRadians(sw[0]);
    rect.south = Cesium.Math.toRadians(sw[1]);
    rect.east = Cesium.Math.toRadians(ne[0]);
    rect.north = Cesium.Math.toRadians(ne[1]);

    return rect;
  }
}

