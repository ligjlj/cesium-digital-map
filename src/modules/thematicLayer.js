import * as Cesium from "cesium";

/**
 * 专题图图层
 * - 栅格：一幅或多幅 SingleTileImageryProvider；可有世界文件，或与上一层同范围（仅 PNG）
 * - 抠图：近黑 / 近白背景可转透明（Canvas 预处理）
 * - 矢量（可选）：public/data/ GeoJSON，属性驱动样式与点击 Tooltip
 */
export function createThematicLayer(viewer, { tooltipEl, legendEl }) {
  /** @type {Cesium.GeoJsonDataSource | null} */
  let dataSource = null;
  /** @type {Cesium.ScreenSpaceEventHandler | null} */
  let handler = null;
  /** @type {Cesium.ImageryLayer[]} */
  let singleTileLayers = [];
  /** @type {string[]} */
  let singleTileBlobUrls = [];

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

  function clearSingleTileImagery() {
    for (const layer of singleTileLayers) {
      viewer.imageryLayers.remove(layer, true);
    }
    singleTileLayers.length = 0;
    for (const url of singleTileBlobUrls) {
      URL.revokeObjectURL(url);
    }
    singleTileBlobUrls.length = 0;
  }

  /**
   * @param {Cesium.Rectangle[]} rects
   * @returns {Cesium.Rectangle}
   */
  function unionRectangles(rects) {
    if (rects.length === 0) {
      throw new Error("[Thematic] unionRectangles 需要至少一个范围");
    }
    let out = rects[0];
    for (let i = 1; i < rects.length; i++) {
      out = Cesium.Rectangle.union(out, rects[i], new Cesium.Rectangle());
    }
    return out;
  }

  /**
   * 给矩形范围增加一点边距，避免“贴边”导致观感过紧。
   * @param {Cesium.Rectangle} rect
   * @param {{ padRatio?: number; minPadDeg?: number; maxPadDeg?: number }} [opts]
   */
  function padRectangle(rect, opts = {}) {
    const padRatio = opts.padRatio ?? 0.12;
    const minPadDeg = opts.minPadDeg ?? 0.08;
    const maxPadDeg = opts.maxPadDeg ?? 8;

    const westDeg = Cesium.Math.toDegrees(rect.west);
    const eastDeg = Cesium.Math.toDegrees(rect.east);
    const southDeg = Cesium.Math.toDegrees(rect.south);
    const northDeg = Cesium.Math.toDegrees(rect.north);

    const widthDeg = Math.max(0.000001, eastDeg - westDeg);
    const heightDeg = Math.max(0.000001, northDeg - southDeg);

    const padX = Math.min(maxPadDeg, Math.max(minPadDeg, widthDeg * padRatio));
    const padY = Math.min(maxPadDeg, Math.max(minPadDeg, heightDeg * padRatio));

    return Cesium.Rectangle.fromDegrees(
      westDeg - padX,
      southDeg - padY,
      eastDeg + padX,
      northDeg + padY
    );
  }

  /**
   * 由世界文件与像素宽高计算经纬度矩形。
   * @param {string} worldFileUrl
   * @param {number} width
   * @param {number} height
   */
  async function rectangleFromWorldFile(worldFileUrl, width, height) {
    const world = await loadWorldFile(worldFileUrl);
    const A = world[0];
    const D = world[1];
    const B = world[2];
    const E = world[3];
    const C = world[4];
    const F = world[5];

    if (Math.abs(B) > 1e-10 || Math.abs(D) > 1e-10) {
      console.warn("[Thematic] 世界文件包含旋转参数(B/D)，当前实现仅按无旋转处理，结果可能不准确。");
    }

    const west = C - A / 2;
    const north = F - E / 2;
    const east = west + A * width;
    const south = north + E * height;

    const nums = { west, south, east, north, A, E, C, F, width, height };
    for (const [k, v] of Object.entries(nums)) {
      if (!Number.isFinite(v)) {
        throw new Error(
          `[Thematic] 计算专题图范围失败：${k}=${String(
            v
          )}，请检查世界文件是否正确(${worldFileUrl})`
        );
      }
    }

    return Cesium.Rectangle.fromDegrees(west, south, east, north);
  }

  /**
   * 构建并添加一层 SingleTile（不清理其它层；由 loadSingleTileStack 统一清理）。
   *
   * @param {object} options
   * @param {string} options.imageUrl
   * @param {string} [options.worldFileUrl] 与 imageUrl 配套；省略时可与上一层同四至或显式 rectangleDegrees
   * @param {boolean} [options.sameExtentAsPrevious=false] 为 true 时使用上一层矩形（仅 PNG 叠在同一范围上）
   * @param {{ west: number; south: number; east: number; north: number }} [options.rectangleDegrees]
   * @param {number} [options.alpha=0.9]
   * @param {boolean} [options.transparentBlack=true]
   * @param {number} [options.blackThreshold=24]
   * @param {boolean} [options.transparentWhite=false]
   * @param {number} [options.whiteThreshold=12] RGB 均 ≥ (255 - whiteThreshold) 视为白底透明
   * @param {{ previousRectangle: Cesium.Rectangle | null }} ctx
   * @returns {Promise<{ layer: Cesium.ImageryLayer; rectangle: Cesium.Rectangle; blobUrl: string | null }>}
   */
  async function buildAndAddSingleTile(options, ctx) {
    const {
      imageUrl,
      worldFileUrl,
      sameExtentAsPrevious = false,
      rectangleDegrees,
      alpha = 0.9,
      transparentBlack = true,
      blackThreshold = 24,
      transparentWhite = false,
      whiteThreshold = 12
    } = options;

    const { width, height } = await loadImageSize(imageUrl);

    /** @type {Cesium.Rectangle} */
    let rectangle;
    if (worldFileUrl) {
      rectangle = await rectangleFromWorldFile(worldFileUrl, width, height);
    } else if (sameExtentAsPrevious && ctx.previousRectangle) {
      rectangle = Cesium.Rectangle.clone(ctx.previousRectangle, new Cesium.Rectangle());
    } else if (
      rectangleDegrees &&
      Number.isFinite(rectangleDegrees.west) &&
      Number.isFinite(rectangleDegrees.south) &&
      Number.isFinite(rectangleDegrees.east) &&
      Number.isFinite(rectangleDegrees.north)
    ) {
      const { west, south, east, north } = rectangleDegrees;
      rectangle = Cesium.Rectangle.fromDegrees(west, south, east, north);
    } else {
      throw new Error(
        "[Thematic] 缺少定位信息：请提供 worldFileUrl、rectangleDegrees，或 sameExtentAsPrevious（且前一层已成功）"
      );
    }

    const needMatting = transparentBlack || transparentWhite;
    let effectiveImageUrl = imageUrl;
    /** @type {string | null} */
    let blobUrl = null;
    if (needMatting) {
      blobUrl = await rasterizeMattingPngBlobUrl(imageUrl, {
        transparentBlack,
        blackThreshold,
        transparentWhite,
        whiteThreshold
      });
      effectiveImageUrl = blobUrl;
    }

    const provider = new Cesium.SingleTileImageryProvider({
      url: effectiveImageUrl,
      rectangle,
      tileWidth: width,
      tileHeight: height
    });

    const layer = viewer.imageryLayers.addImageryProvider(provider);
    layer.alpha = alpha;
    viewer.imageryLayers.raiseToTop(layer);

    return { layer, rectangle, blobUrl };
  }

  /**
   * 按顺序叠加多幅带世界文件的专题栅格（数组前者在下、后者在上）。
   *
   * @param {object[]} tileSpecs 每项字段同 {@link buildAndAddSingleTile}
   * @returns {Promise<Cesium.ImageryLayer[]>}
   */
  async function loadSingleTileStack(tileSpecs) {
    if (!Array.isArray(tileSpecs) || tileSpecs.length === 0) {
      throw new Error("[Thematic] loadSingleTileStack 需要非空数组");
    }

    clearSingleTileImagery();
    hideLegend();

    const rectangles = [];
    /** @type {Cesium.Rectangle | null} */
    let previousRectangle = null;
    try {
      for (const spec of tileSpecs) {
        const { layer, rectangle, blobUrl } = await buildAndAddSingleTile(spec, {
          previousRectangle
        });
        previousRectangle = rectangle;
        singleTileLayers.push(layer);
        if (blobUrl) singleTileBlobUrls.push(blobUrl);
        rectangles.push(rectangle);
      }
    } catch (err) {
      clearSingleTileImagery();
      throw err;
    }

    for (const layer of singleTileLayers) {
      viewer.imageryLayers.raiseToTop(layer);
    }

    showLegend();

    const dest = unionRectangles(rectangles);
    viewer.camera.flyTo({
      destination: padRectangle(dest, { padRatio: 0.14, minPadDeg: 0.12 }),
      duration: 1.35
    });

    return singleTileLayers.slice();
  }

  /**
   * 加载单幅专题栅格（等价于 loadSingleTileStack([options])）。
   *
   * @param {object} options 字段同 {@link buildAndAddSingleTile}（单幅时不可使用 sameExtentAsPrevious）
   */
  async function loadSingleTile(options) {
    return loadSingleTileStack([options]);
  }

  function loadImageSize(url) {
    return loadImageElement(url).then((img) => ({
      width: img.naturalWidth,
      height: img.naturalHeight
    }));
  }

  /**
   * @param {string} url
   * @returns {Promise<HTMLImageElement>}
   */
  function loadImageElement(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`[Thematic] 无法加载图片：${url}`));
      img.src = url;
    });
  }

  /**
   * 将近黑 / 近白像素改为透明后导出为 PNG Blob URL（一次 Canvas 处理可同时开两种抠图）。
   *
   * @param {string} imageUrl
   * @param {object} opts
   * @param {boolean} [opts.transparentBlack=false]
   * @param {number} [opts.blackThreshold=24] RGB 均 ≤ 该值 → 透明
   * @param {boolean} [opts.transparentWhite=false]
   * @param {number} [opts.whiteThreshold=12] RGB 均 ≥ (255 - whiteThreshold) → 透明（白底图）
   * @returns {Promise<string>}
   */
  async function rasterizeMattingPngBlobUrl(imageUrl, opts) {
    const {
      transparentBlack = false,
      blackThreshold = 24,
      transparentWhite = false,
      whiteThreshold = 12
    } = opts;

    const img = await loadImageElement(imageUrl);
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      throw new Error("[Thematic] 无法创建 Canvas 2D 上下文");
    }
    ctx.drawImage(img, 0, 0);
    const { width, height } = canvas;
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    const bt = blackThreshold;
    const whiteFloor = 255 - whiteThreshold;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (transparentBlack && r <= bt && g <= bt && b <= bt) {
        data[i + 3] = 0;
        continue;
      }
      if (transparentWhite && r >= whiteFloor && g >= whiteFloor && b >= whiteFloor) {
        data[i + 3] = 0;
      }
    }
    ctx.putImageData(imageData, 0, 0);

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) reject(new Error("[Thematic] 无法导出透明 PNG（toBlob 返回空）"));
          else resolve(blob);
        },
        "image/png"
      );
    });
    return URL.createObjectURL(blob);
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
    clearSingleTileImagery();
  }

  return {
    load,
    loadSingleTile,
    loadSingleTileStack,
    clear
  };
}

