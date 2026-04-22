import { defineConfig } from "vite";
import cesium from "vite-plugin-cesium";

// 纯本地化部署要求：
// - 使用 vite-plugin-cesium 将 Cesium 的 Assets/Workers/Widgets 等静态资源拷贝到 dist
// - dev/preview 监听 0.0.0.0，便于局域网访问
export default defineConfig({
  plugins: [cesium()],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      // 高德瓦片反代：解决跨域导致 WebGL 纹理无法使用的问题
      // 生产环境可用 Nginx 配置同样的 /gaode/ 反向代理
      "/gaode": {
        // 实测可用瓦片源：wprd01.is.autonavi.com/appmaptile（返回 image/png）
        // 用 http 可避免某些环境下 https 握手/重定向导致的取图失败
        target: "http://wprd01.is.autonavi.com",
        changeOrigin: true,
        secure: false,
        rewrite: (p) => p.replace(/^\/gaode/, "")
      }
    }
  },
  preview: {
    host: true,
    port: 4173,
    strictPort: true
  },
  build: {
    sourcemap: true
  }
});

