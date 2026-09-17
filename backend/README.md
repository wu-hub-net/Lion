# LIONS backend

The backend is a small FastAPI service using SQLAlchemy and SQLite. The frontend talks to this API; it never opens the SQLite file directly.

## Run locally

From the `backend` directory:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

The first startup creates `backend/data/lions.db` automatically. The database and local environment files are ignored by Git.

API base URL: `http://127.0.0.1:8000/api`

Swagger UI: `http://127.0.0.1:8000/docs`

## Tables

- `users`: account identity and role. The API never returns `password_hash`.
- `candidates`: core candidate profile fields.
- `skills`: unique skill names.
- `candidate_skills`: unique many-to-many candidate/skill links.

## Endpoints

- `GET /api/health`
- `GET/POST /api/users`
- `PUT/DELETE /api/users/{user_id}`
- `GET/POST /api/skills`
- `PUT/DELETE /api/skills/{skill_id}`
- `GET/POST /api/candidates`
- `GET/PUT/DELETE /api/candidates/{candidate_id}`

The default CORS allowlist contains the local frontend origins `http://127.0.0.1:4174` and `http://localhost:4174`. Override it with the comma-separated `LIONS_CORS_ORIGINS` environment variable when needed.

## Test

From the project root, run `python -m pytest backend/tests/test_api_integration.py -q`. The integration test uses a temporary SQLite database and verifies the CRUD APIs, candidate skill updates, CORS, and automatic table creation.
