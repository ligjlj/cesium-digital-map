import * as Cesium from "cesium";

/**
 * 专题图图层（GeoJSON）
 * - 从 public/data/ 加载本地 GeoJSON
 * - 基于属性值进行分级渲染（色阶）
 * - 点击要素弹出自定义 HTML Tooltip，点击空白处关闭
 */
export function createThematicLayer(viewer, { tooltipEl, legendEl }) {
  /** @type {Cesium.GeoJsonDataSource | null} */
  let dataSource = null;
  /** @type {Cesium.ScreenSpaceEventHandler | null} */
  let handler = null;
  /** @type {Cesium.ImageryLayer | null} */
  let singleTileLayer = null;

  function showLegend() {
    if (!legendEl) return;
    legendEl.classList.remove("hidden");
  }

  function hideLegend() {
    if (!legendEl) return;
    legendEl.classList.add("hidden");
  }

  function getColorByValue(val) {
    // 业务可按需替换映射逻辑：这里用 5 档色阶
    if (val == null || Number.isNaN(Number(val))) {
      return Cesium.Color.GRAY.withAlpha(0.7);
    }
    const v = Number(val);
    if (v >= 80) return Cesium.Color.fromCssColorString("#ef4444").withAlpha(0.75);
    if (v >= 60) return Cesium.Color.fromCssColorString("#f97316").withAlpha(0.75);
    if (v >= 40) return Cesium.Color.fromCssColorString("#eab308").withAlpha(0.75);
    if (v >= 20) return Cesium.Color.fromCssColorString("#22c55e").withAlpha(0.75);
    return Cesium.Color.fromCssColorString("#38bdf8").withAlpha(0.75);
  }

  function hideTooltip() {
    if (!tooltipEl) return;
    tooltipEl.classList.add("hidden");
  }

  function showTooltip(screenPosition, title, propertiesObj) {
    if (!tooltipEl) return;
    const x = screenPosition.x + 14;
    const y = screenPosition.y + 14;
    tooltipEl.style.left = `${x}px`;
    tooltipEl.style.top = `${y}px`;

    const kvHtml = Object.entries(propertiesObj)
      .map(([k, v]) => `<div class="kv"><b>${escapeHtml(k)}</b>: ${escapeHtml(String(v))}</div>`)
      .join("");

    tooltipEl.innerHTML = `<div class="title">${escapeHtml(title)}</div>${kvHtml}`;
    tooltipEl.classList.remove("hidden");
  }

  function escapeHtml(s) {
    return s
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function bindInteraction() {
    if (handler) handler.destroy();
    handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

    handler.setInputAction((movement) => {
      const picked = viewer.scene.pick(movement.position);
      if (!Cesium.defined(picked) || !picked.id) {
        hideTooltip();
        return;
      }

      const entity = picked.id;
      const props = entity.properties;
      if (!props) {
        hideTooltip();
        return;
      }

      // Cesium.PropertyBag → 普通对象，便于展示
      const obj = {};
      props.propertyNames.forEach((name) => {
        const p = props[name];
        obj[name] = p?.getValue?.(Cesium.JulianDate.now()) ?? p;
      });

      const title = entity.name || obj.name || "要素信息";
      showTooltip(movement.position, title, obj);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    handler.setInputAction(() => {
      hideTooltip();
    }, Cesium.ScreenSpaceEventType.LEFT_DOWN);
  }

  async function load(url) {
    if (dataSource) {
      viewer.dataSources.remove(dataSource, true);
      dataSource = null;
    }

    dataSource = await Cesium.GeoJsonDataSource.load(url, {
      clampToGround: true
    });
    viewer.dataSources.add(dataSource);

    // 数据驱动渲染：遍历 entities，读取 properties 映射样式
    const now = Cesium.JulianDate.now();
    for (const entity of dataSource.entities.values) {
      const properties = entity.properties;
      const val =
        properties?.value?.getValue?.(now) ??
        properties?.level?.getValue?.(now) ??
        properties?.val?.getValue?.(now);

      const color = getColorByValue(val);

      if (Cesium.defined(entity.polygon)) {
        entity.polygon.material = color;
        entity.polygon.outline = true;
        entity.polygon.outlineColor = Cesium.Color.WHITE.withAlpha(0.85);
      } else if (Cesium.defined(entity.polyline)) {
        entity.polyline.material = color;
        entity.polyline.width = 3;
      } else if (Cesium.defined(entity.point)) {
        entity.point.color = color;
        entity.point.pixelSize = Math.min(18, 6 + (Number(val) || 0) / 15);
        entity.point.outlineColor = Cesium.Color.BLACK.withAlpha(0.5);
        entity.point.outlineWidth = 1;
      } else if (Cesium.defined(entity.billboard)) {
        // billboard 如果存在，可根据业务替换为自定义图标；此处保持不动
      }
    }

    bindInteraction();
    return dataSource;
  }

  /**
   * 使用 SingleTileImageryProvider 加载一张“带地理定位”的专题图图片。
   *
   * 推荐配套文件：
   * - tif2.png：专题图图片（放到 public/ 下，才能通过 /xxx 访问）
   * - tif2.pgw：世界文件（6 行参数：像素大小/旋转/原点），用于从图片像素坐标推算经纬度范围
   *
   * 加载流程：
   * - 先读取图片 naturalWidth/naturalHeight（得到像素尺寸）
   * - 再读取 pgw 六参数（得到像素到经纬度的仿射关系）
   * - 计算四至范围 west/south/east/north，传给 SingleTileImageryProvider.rectangle
   *
   * @param {{ imageUrl: string; worldFileUrl: string; alpha?: number }} options
   */
  async function loadSingleTile(options) {
    const { imageUrl, worldFileUrl, alpha = 0.85 } = options;

    // 移除旧的 single tile
    if (singleTileLayer) {
      viewer.imageryLayers.remove(singleTileLayer, true);
      singleTileLayer = null;
    }
    hideLegend();

    // 图片尺寸（像素）
    const { width, height } = await loadImageSize(imageUrl);
    // 世界文件参数（经纬度/像素）
    const world = await loadWorldFile(worldFileUrl);

    // pgw：A D B E C F（上左像素中心点坐标）
    const A = world[0]; // pixel size x (deg/pixel)
    const D = world[1];
    const B = world[2];
    const E = world[3]; // pixel size y (deg/pixel) 通常为负
    const C = world[4]; // x of center of upper-left pixel
    const F = world[5]; // y of center of upper-left pixel

    // 当前仅处理无旋转的常见情况（B/D ≈ 0），否则会出现倾斜范围，需更复杂的四角计算
    if (Math.abs(B) > 1e-10 || Math.abs(D) > 1e-10) {
      console.warn("[Thematic] 世界文件包含旋转参数(B/D)，当前实现仅按无旋转处理，结果可能不准确。");
    }

    // 上左像素“边界”坐标
    const west = C - A / 2;
    const north = F - E / 2; // E 为负时，相当于 F + |E|/2
    const east = west + A * width;
    const south = north + E * height;

    // 关键校验：避免把 undefined/NaN 传进 Cesium，导致难定位的类型错误
    const nums = { west, south, east, north, A, E, C, F, width, height };
    for (const [k, v] of Object.entries(nums)) {
      if (!Number.isFinite(v)) {
        throw new Error(
          `[Thematic] 计算专题图范围失败：${k}=${String(
            v
          )}，请检查图片是否可访问(${imageUrl})、世界文件是否正确(${worldFileUrl})`
        );
      }
    }

    const rectangle = Cesium.Rectangle.fromDegrees(west, south, east, north);

    const provider = new Cesium.SingleTileImageryProvider({
      url: imageUrl,
      rectangle,
      // Cesium 新版本中 tileWidth/tileHeight 需要显式提供，否则会触发类型校验错误
      tileWidth: width,
      tileHeight: height
    });

    singleTileLayer = viewer.imageryLayers.addImageryProvider(provider);
    singleTileLayer.alpha = alpha;
    showLegend();

    // 视角飞到该图片范围附近，便于确认加载成功
    viewer.camera.flyTo({
      destination: rectangle,
      duration: 1.2
    });

    return singleTileLayer;
  }

  function loadImageSize(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => reject(new Error(`[Thematic] 无法加载图片：${url}`));
      img.src = url;
    });
  }

  async function loadWorldFile(url) {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`[Thematic] 无法加载世界文件：${url} (HTTP ${res.status})`);
    }
    const text = await res.text();
    const lines = text
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (lines.length < 6) {
      throw new Error(`[Thematic] 世界文件格式错误（行数不足 6）：${url}`);
    }
    return lines.slice(0, 6).map((v) => Number(v));
  }

  function clear() {
    hideTooltip();
    hideLegend();
    if (handler) {
      handler.destroy();
      handler = null;
    }
    if (dataSource) {
      viewer.dataSources.remove(dataSource, true);
      dataSource = null;
    }
    if (singleTileLayer) {
      viewer.imageryLayers.remove(singleTileLayer, true);
      singleTileLayer = null;
    }
  }

  return {
    load,
    loadSingleTile,
    clear
  };
}

