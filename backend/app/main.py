from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.middleware.cors import CORSMiddleware

from . import models
from .database import Base, engine, ensure_schema_compatibility
from .routers import applications, candidates, health, interviews, jobs, offers, resumes, skills, users


def create_app() -> FastAPI:
    app = FastAPI(title="LIONS API", version="0.1.0")

    @app.get("/", response_class=HTMLResponse)
    def api_home():
        return """<!doctype html><html lang='en'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>LIONS API</title><style>body{font-family:system-ui,sans-serif;background:#f4f6ff;color:#17223d;margin:0;padding:48px}main{max-width:720px;margin:auto;background:#fff;border:1px solid #e2e8f5;border-radius:18px;padding:32px;box-shadow:0 18px 45px #5b61e81a}h1{margin:0 0 8px}p{color:#74809a}a{display:inline-block;margin:8px 10px 0 0;padding:10px 14px;border-radius:9px;background:#5b61e8;color:#fff;text-decoration:none}</style></head><body><main><h1>LIONS API</h1><p>Backend service is running. Use the interactive documentation or health check below.</p><a href='/docs'>Open API docs</a><a href='/api/health'>Health check</a><a href='/openapi.json'>OpenAPI JSON</a></main></body></html>"""
    origins = [
        origin.strip()
        for origin in os.getenv(
            "LIONS_CORS_ORIGINS",
            "http://127.0.0.1:4174,http://localhost:4174",
        ).split(",")
        if origin.strip()
    ]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["Content-Type"],
    )

    @app.on_event("startup")
    def create_tables():
        Base.metadata.create_all(bind=engine)
        ensure_schema_compatibility()

    app.include_router(health.router, prefix="/api")
    app.include_router(users.router, prefix="/api")
    app.include_router(candidates.router, prefix="/api")
    app.include_router(skills.router, prefix="/api")
    app.include_router(offers.router, prefix="/api")
    app.include_router(jobs.router, prefix="/api")
    app.include_router(resumes.router, prefix="/api")
    app.include_router(interviews.router, prefix="/api")
    app.include_router(applications.router, prefix="/api")
    return app


app = create_app()
