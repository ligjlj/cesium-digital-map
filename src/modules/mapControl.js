import * as Cesium from "cesium";

/**
 * 底图切换管理器
 * - 默认不加载 Cesium 官方基础底图（已在 Viewer 初始化中关闭）
 * - 支持：天地图 WMTS / 高德 URL 模板（GCJ-02→WGS84 纠偏）/ 本地离线瓦片
 */
export function createBaseMapManager(viewer) {
  /** @type {Cesium.ImageryLayer | null} */
  let currentLayer = null;

  function replaceLayer(provider) {
    if (currentLayer) {
      viewer.imageryLayers.remove(currentLayer, true);
      currentLayer = null;
    }
    if (provider) {
      // 必须插在索引 0（最底层）。否则切换底图时新图层会默认加在最上面，
      // 盖住已加载的专题影像（SingleTile 等叠加层会“像消失了一样”）。
      currentLayer = viewer.imageryLayers.addImageryProvider(provider, 0);
    }
  }

  function createTiandituProvider() {
    // 天地图服务通常需要 token；出于“纯本地化”要求，这里不写死，
    // 允许在局域网环境使用自建代理/镜像时配置。
    const token = import.meta.env.VITE_TIANDITU_TOKEN;
    if (!token) {
      console.warn(
        "[BaseMap] 未配置 VITE_TIANDITU_TOKEN，将无法访问天地图 WMTS。你仍可切换到离线瓦片或高德。"
      );
    }

    // 天地图 WMTS（WGS84 坐标系）
    // 注意：天地图有多套矩阵集（w/c），这里用 w（经纬度/WGS84）更易与 Cesium 配合。
    // 控制台若大量 429：属天地图对 tk 的限流/配额，非本项目 Node 后台；可换 key、Nginx 缓存瓦片、或切「高德/离线」底图。
    const maxLevelRaw = import.meta.env.VITE_TIANDITU_MAX_LEVEL;
    const maximumLevel =
      maxLevelRaw !== undefined && maxLevelRaw !== "" && Number.isFinite(Number(maxLevelRaw))
        ? Math.min(18, Math.max(0, Math.floor(Number(maxLevelRaw))))
        : 18;

    return new Cesium.WebMapTileServiceImageryProvider({
      url:
        "https://t{s}.tianditu.gov.cn/img_w/wmts?tk=" +
        encodeURIComponent(token ?? ""),
      layer: "img",
      style: "default",
      format: "tiles",
      tileMatrixSetID: "w",
      maximumLevel,
      // 关闭 WMTS GetFeatureInfo，减少无谓请求（对 429 帮助有限，但无业务需求时建议关）
      enablePickFeatures: false,
      subdomains: ["0", "1", "2", "3", "4", "5", "6", "7"]
    });
  }

  function createGaodeProvider() {
    // 高德底图是 GCJ-02 坐标系，直接叠加到 WGS84 会有 ~300-500m 系统偏移。
    // 这是所有 WGS84 查看器加载 GCJ-02 瓦片的正常行为，瓦片之间完美对齐。
    // 需要精确叠加时请使用天地图（WGS84 原生）。
    return new Cesium.UrlTemplateImageryProvider({
      url: "/gaode/appmaptile?lang=zh_cn&size=1&scl=1&style=7&x={x}&y={y}&z={z}",
      maximumLevel: 19,
      credit: "Gaode"
    });
  }

  function createOfflineProvider() {
    // public/tiles/{z}/{x}/{y}.png
    return new Cesium.UrlTemplateImageryProvider({
      url: "/tiles/{z}/{x}/{y}.png",
      maximumLevel: 18
    });
  }

  function setBaseMap(type) {
    switch (type) {
      case "tianditu":
        replaceLayer(createTiandituProvider());
        break;
      case "gaode":
        replaceLayer(createGaodeProvider());
        break;
      case "offline":
        replaceLayer(createOfflineProvider());
        break;
      default:
        console.warn("[BaseMap] 未知底图类型：", type);
        break;
    }
  }

  return {
    setBaseMap
  };
}

