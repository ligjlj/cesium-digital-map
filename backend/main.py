"""
FastAPI 后端 — gotrackit 路网匹配 + 最短路径规划
启动: uvicorn main:app --host 0.0.0.0 --port 8765 --reload
"""

import logging
from contextlib import asynccontextmanager

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
    _match_link_file,
    _match_gps_file,
    _match_prj_file,
    _geojson_from_file,
)
from route_engine import RouteError, plan_shortest_route

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


app = FastAPI(title="gotrackit Map Matching Service", version="0.3.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# ── 模型 ────────────────────────────────────────────────

class GenerateRequest(BaseModel):
    num_trips: int = 3
    points_per_trip: int = 50


class MatchRequest(BaseModel):
    num_trips: int = 3
    points_per_trip: int = 80


class LonLat(BaseModel):
    lng: float
    lat: float


class RouteRequest(BaseModel):
    origin: LonLat
    destination: LonLat


# ── 端点 ────────────────────────────────────────────────

@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "version": "0.3.0",
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
    """执行路网匹配，返回完整 GeoJSON"""
    try:
        if not NETWORK_FILE.exists():
            raise HTTPException(400, f"路网不存在: {NETWORK_FILE}")

        net = get_or_load_network()
        gdf = generate_synthetic_gps(
            num_trips=req.num_trips,
            points_per_trip=req.points_per_trip,
        )
        result = run_map_match(net, gdf)

        return JSONResponse({
            "status": "ok",
            "crs": "GCJ-02",
            "summary": result.summary,
            "trips": [
                {
                    "agent_id": t.agent_id,
                    "point_count": t.point_count,
                    "match_link_count": t.match_link_count,
                    "unique_link_count": t.unique_link_count,
                    "avg_proj_distance_m": t.avg_proj_distance_m,
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


@app.post("/api/route")
async def plan_route(req: RouteRequest):
    """最短路径规划：经纬度起终点 → Dijkstra → GeoJSON"""
    try:
        result = plan_shortest_route(
            origin_lon=req.origin.lng,
            origin_lat=req.origin.lat,
            dest_lon=req.destination.lng,
            dest_lat=req.destination.lat,
        )
        return JSONResponse({
            "status": "ok",
            "crs": "GCJ-02",
            "route": result.route_geojson,
            "summary": result.summary,
        })
    except RouteError as e:
        raise HTTPException(e.status_code, str(e))
    except Exception as e:
        logger.exception("路径规划失败")
        raise HTTPException(500, str(e))


@app.get("/api/match/{agent_id}/links")
async def get_match_links(agent_id: str):
    f = _match_link_file(agent_id)
    if not f.exists():
        raise HTTPException(404, f"未找到 {agent_id} 的匹配结果，请先执行 /api/match")
    return JSONResponse(_geojson_from_file(f))


@app.get("/api/match/{agent_id}/trajectory")
async def get_corrected_traj(agent_id: str):
    f = _match_gps_file(agent_id)
    if not f.exists():
        raise HTTPException(404, f"未找到 {agent_id} 的匹配结果")
    return JSONResponse(_geojson_from_file(f))


@app.get("/api/match/{agent_id}/prj")
async def get_prj_points(agent_id: str):
    f = _match_prj_file(agent_id)
    if not f.exists():
        raise HTTPException(404, f"未找到 {agent_id} 的匹配结果")
    return JSONResponse(_geojson_from_file(f))


@app.get("/api/network")
async def get_network():
    if not NETWORK_FILE.exists():
        raise HTTPException(404, "路网不存在")
    return JSONResponse(_geojson_from_file(NETWORK_FILE, to_wgs84=False))


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
