from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker


BACKEND_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = BACKEND_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
DATABASE_URL = os.getenv("LIONS_DATABASE_URL", f"sqlite:///{(DATA_DIR / 'lions.db').as_posix()}")


class Base(DeclarativeBase):
    pass


connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args, future=True)

if DATABASE_URL.startswith("sqlite"):
    @event.listens_for(engine, "connect")
    def enable_sqlite_foreign_keys(dbapi_connection, _connection_record):
        dbapi_connection.execute("PRAGMA foreign_keys=ON")
SessionLocal = sessionmaker(bind=engine, class_=Session, autoflush=False, autocommit=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def ensure_schema_compatibility():
    """Add nullable columns required by later local SQLite schema versions."""
    if not DATABASE_URL.startswith("sqlite"):
        return
    with engine.begin() as connection:
        columns = {row[1] for row in connection.exec_driver_sql("PRAGMA table_info(candidates)").fetchall()}
        if columns and "user_id" not in columns:
            connection.exec_driver_sql("ALTER TABLE candidates ADD COLUMN user_id INTEGER")
        connection.exec_driver_sql("CREATE UNIQUE INDEX IF NOT EXISTS uq_candidates_user_id ON candidates (user_id) WHERE user_id IS NOT NULL")
        offer_columns = {row[1] for row in connection.exec_driver_sql("PRAGMA table_info(offers)").fetchall()}
        additions = {
            "company_id": "INTEGER", "job_id": "INTEGER", "is_active": "BOOLEAN NOT NULL DEFAULT 1",
            "is_deleted": "BOOLEAN NOT NULL DEFAULT 0", "moderation_reason": "TEXT",
            "moderated_at": "DATETIME", "moderated_by": "INTEGER",
        }
        for name, definition in additions.items():
            if offer_columns and name not in offer_columns:
                connection.exec_driver_sql(f"ALTER TABLE offers ADD COLUMN {name} {definition}")
        resume_analysis_columns = {row[1] for row in connection.exec_driver_sql("PRAGMA table_info(resume_analyses)").fetchall()}
        analysis_additions = {
            "profile_json": "TEXT NOT NULL DEFAULT '{}'",
            "dimensions_json": "TEXT NOT NULL DEFAULT '{}'",
            "projects_json": "TEXT NOT NULL DEFAULT '[]'",
            "skills_json": "TEXT NOT NULL DEFAULT '[]'",
            "extracted_name": "TEXT",
            "extracted_gender": "TEXT",
            "extracted_age": "INTEGER",
            "extracted_email": "TEXT",
            "extracted_phone": "TEXT",
            "summary": "TEXT",
        }
        for name, definition in analysis_additions.items():
            if resume_analysis_columns and name not in resume_analysis_columns:
                connection.exec_driver_sql(f"ALTER TABLE resume_analyses ADD COLUMN {name} {definition}")
        interview_columns = {row[1] for row in connection.exec_driver_sql("PRAGMA table_info(interviews)").fetchall()}
        if interview_columns and "interviewer" not in interview_columns:
            connection.exec_driver_sql("ALTER TABLE interviews ADD COLUMN interviewer TEXT")
