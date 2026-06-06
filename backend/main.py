"""
FastAPI 后端 — gotrackit 路网匹配服务 (Phase 2)
启动: uvicorn main:app --host 0.0.0.0 --port 8765 --reload
"""

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from match_engine import (
    DATA_DIR,
    NETWORK_FILE,
    SAMPLE_TRIPS_FILE,
    get_or_load_network,
    generate_synthetic_gps,
    run_map_match,
    _clean_match_outputs,
    _match_link_file,
    _match_gps_file,
    _match_prj_file,
    _geojson_from_file,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("服务启动 — 数据目录: %s", DATA_DIR)
    if NETWORK_FILE.exists():
        logger.info("路网: %.1f MB", NETWORK_FILE.stat().st_size / 1e6)
    yield
    logger.info("服务关闭")


app = FastAPI(title="gotrackit Map Matching Service", version="0.2.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


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
        "version": "0.2.0",
        "network_exists": NETWORK_FILE.exists(),
        "trips_cached": SAMPLE_TRIPS_FILE.exists(),
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
        }
    except Exception as e:
        logger.exception("生成失败")
        raise HTTPException(500, str(e))


@app.post("/api/match")
async def match_trips(req: MatchRequest):
    """
    执行路网匹配，返回完整 GeoJSON。

    响应包含:
    - summary: 匹配统计摘要
    - trips[]: 每个 agent 的 matched_links, corrected_traj, prj_points (GeoJSON FeatureCollection)
    - network: 路网 GeoJSON FeatureCollection
    - raw_trips: 原始轨迹 GeoJSON FeatureCollection
    """
    try:
        if not NETWORK_FILE.exists():
            raise HTTPException(400, f"路网不存在: {NETWORK_FILE}")

        net = get_or_load_network()

        import geopandas as gpd
        if SAMPLE_TRIPS_FILE.exists():
            gdf = gpd.read_file(str(SAMPLE_TRIPS_FILE))
        else:
            gdf = generate_synthetic_gps(num_trips=req.num_trips, points_per_trip=req.points_per_trip)

        result = run_map_match(net, gdf)

        return JSONResponse({
            "status": "ok",
            "summary": result.summary,
            "trips": [
                {
                    "agent_id": t.agent_id,
                    "point_count": t.point_count,
                    "match_link_count": t.match_link_count,
                    "match_rate": t.match_rate,
                    "total_length_km": t.total_length_km,
                    "matched_links": t.matched_links_geojson,
                    "corrected_traj": t.corrected_traj_geojson,
                    "prj_points": t.prj_points_geojson,
                }
                for t in result.trips
            ],
            "network": result.network_geojson,
            "raw_trips": result.raw_trips_geojson,
        })
    except FileNotFoundError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.exception("匹配失败")
        raise HTTPException(500, str(e))


@app.get("/api/match/{agent_id}/links")
async def get_match_links(agent_id: str):
    """获取指定 agent 的匹配路段 GeoJSON"""
    f = _match_link_file(agent_id)
    if not f.exists():
        raise HTTPException(404, f"未找到 {agent_id} 的匹配结果，请先执行 /api/match")
    return JSONResponse(_geojson_from_file(f))


@app.get("/api/match/{agent_id}/trajectory")
async def get_corrected_traj(agent_id: str):
    """获取指定 agent 的纠偏轨迹 GeoJSON"""
    f = _match_gps_file(agent_id)
    if not f.exists():
        raise HTTPException(404, f"未找到 {agent_id} 的匹配结果")
    return JSONResponse(_geojson_from_file(f))


@app.get("/api/match/{agent_id}/prj")
async def get_prj_points(agent_id: str):
    """获取指定 agent 的投影点 GeoJSON"""
    f = _match_prj_file(agent_id)
    if not f.exists():
        raise HTTPException(404, f"未找到 {agent_id} 的匹配结果")
    return JSONResponse(_geojson_from_file(f))


@app.get("/api/network")
async def get_network():
    """获取完整路网 GeoJSON"""
    if not NETWORK_FILE.exists():
        raise HTTPException(404, "路网不存在")
    return JSONResponse(_geojson_from_file(NETWORK_FILE))


@app.get("/api/network/status")
async def network_status():
    return {
        "exists": NETWORK_FILE.exists(),
        "path": str(NETWORK_FILE),
        "size_mb": round(NETWORK_FILE.stat().st_size / 1e6, 2) if NETWORK_FILE.exists() else 0,
        "trips_cached": SAMPLE_TRIPS_FILE.exists(),
        "match_outputs": [f.name for f in DATA_DIR.glob("beijing_match-*")],
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8765)
