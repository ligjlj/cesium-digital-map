"""
FastAPI 后端 — gotrackit 路网匹配服务
启动: uvicorn main:app --host 0.0.0.0 --port 8765 --reload
"""

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from match_engine import (
    DATA_DIR,
    NETWORK_FILE,
    SAMPLE_TRIPS_FILE,
    get_or_load_network,
    generate_synthetic_gps,
    run_map_match,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("main")


# ── 生命周期 ────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("服务启动...")
    logger.info("数据目录: %s", DATA_DIR)
    if NETWORK_FILE.exists():
        logger.info("路网缓存: %s (%.1f MB)", NETWORK_FILE, NETWORK_FILE.stat().st_size / 1e6)
    else:
        logger.warning("路网缓存不存在: %s — 请先放入路网文件，或调用 /api/network/load", NETWORK_FILE)
    yield
    logger.info("服务关闭")


app = FastAPI(
    title="gotrackit Map Matching Service",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── 模型 ────────────────────────────────────────────────

class GenerateRequest(BaseModel):
    num_trips: int = 3
    points_per_trip: int = 50

class MatchRequest(BaseModel):
    num_trips: int = 3
    points_per_trip: int = 50


# ── 端点 ────────────────────────────────────────────────

@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "network_exists": NETWORK_FILE.exists(),
        "trips_cached": SAMPLE_TRIPS_FILE.exists(),
        "data_dir": str(DATA_DIR),
    }


@app.post("/api/generate")
async def generate_trips(req: GenerateRequest):
    """生成合成 GPS 轨迹"""
    try:
        gdf = generate_synthetic_gps(
            num_trips=req.num_trips,
            points_per_trip=req.points_per_trip,
        )
        agent_ids = gdf["agent_id"].unique()
        return {
            "status": "ok",
            "trip_count": len(agent_ids),
            "point_count": len(gdf),
            "agent_ids": agent_ids.tolist(),
            "cached_at": str(SAMPLE_TRIPS_FILE),
        }
    except Exception as e:
        logger.exception("生成轨迹失败")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/match")
async def match_trips(req: MatchRequest):
    """执行路网匹配"""
    try:
        # 1. 加载路网
        if not NETWORK_FILE.exists():
            raise HTTPException(
                status_code=400,
                detail=f"路网文件不存在: {NETWORK_FILE}。请先将路网 GeoJSON 放入此路径。"
            )

        net = get_or_load_network()

        # 2. 生成轨迹（如果已有缓存则使用缓存）
        if SAMPLE_TRIPS_FILE.exists():
            logger.info("使用缓存轨迹")
            import geopandas as gpd
            gdf = gpd.read_file(str(SAMPLE_TRIPS_FILE))
        else:
            gdf = generate_synthetic_gps(
                num_trips=req.num_trips,
                points_per_trip=req.points_per_trip,
            )

        # 3. 匹配
        result = run_map_match(net, gdf)

        return {
            "status": "ok",
            "match_rate": round(result.match_rate, 4),
            "total_length_km": round(result.total_length_km, 2),
            "matched_links_count": len(result.matched_links),
            "corrected_points": len(result.corrected_traj),
        }
    except FileNotFoundError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("匹配失败")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/network/status")
async def network_status():
    """路网状态查询"""
    return {
        "exists": NETWORK_FILE.exists(),
        "path": str(NETWORK_FILE),
        "size_mb": round(NETWORK_FILE.stat().st_size / 1e6, 2) if NETWORK_FILE.exists() else 0,
        "trips_cached": SAMPLE_TRIPS_FILE.exists(),
    }


# ── 入口 ────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8765)
