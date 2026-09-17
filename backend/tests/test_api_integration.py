import os


def test_api_crud_relationships_cors_and_sqlite(tmp_path, monkeypatch):
    database_file = tmp_path / "lions-test.db"
    monkeypatch.setenv("LIONS_DATABASE_URL", f"sqlite:///{database_file.as_posix()}")

    from fastapi.testclient import TestClient
    from sqlalchemy import inspect, text

    from backend.app.database import SessionLocal, engine
    from backend.app.main import app

    with TestClient(app) as client:
        assert client.get("/api/health").json() == {"status": "ok"}

        table_names = set(inspect(engine).get_table_names())
        assert {"users", "candidates", "skills", "candidate_skills", "offers", "companies", "jobs", "applications", "resumes", "resume_analyses", "interviews"} <= table_names

        user = client.post("/api/users", json={
            "username": "Test User", "email": "test@example.com",
            "password_hash": "not-a-plaintext-password", "role": "student",
        })
        assert user.status_code == 201
        user_id = user.json()["id"]
        assert "password_hash" not in user.json()
        assert client.get("/api/users").status_code == 200
        updated_user = client.put(f"/api/users/{user_id}", json={"role": "reviewer"})
        assert updated_user.status_code == 200
        assert updated_user.json()["role"] == "reviewer"
        assert client.delete(f"/api/users/{user_id}").status_code == 204

        student_a = client.post("/api/offers/identities", json={
            "username": "Student A", "email": "student-a@example.com", "role": "student",
        })
        student_b = client.post("/api/offers/identities", json={
            "username": "Student B", "email": "student-b@example.com", "role": "student",
        })
        reviewer = client.post("/api/offers/identities", json={
            "username": "Reviewer A", "email": "reviewer-a@example.com", "role": "reviewer",
        })
        assert student_a.status_code == student_b.status_code == reviewer.status_code == 200
        student_a_id, student_b_id, reviewer_id = student_a.json()["id"], student_b.json()["id"], reviewer.json()["id"]
        admin = client.post("/api/offers/identities", json={
            "username": "Admin A", "email": "admin-a@example.com", "role": "reviewer",
        })
        assert admin.status_code == 200
        admin_id = client.put(f"/api/users/{admin.json()['id']}", json={"role": "admin"}).json()["id"]

        job = client.post("/api/jobs", json={
            "company_name": "ABC Technology", "title": "AI Application Developer",
            "employment_type": "Full-time", "salary": "¥12,000 / month", "location": "Beijing",
            "description": "Build practical AI applications.", "skills": "Python, SQL",
        })
        assert job.status_code == 201
        job_id = job.json()["id"]
        assert client.get("/api/jobs").json() == []
        published = client.put(f"/api/jobs/{job_id}/moderate", json={"actor_id": admin_id, "action": "publish"})
        assert published.status_code == 200 and published.json()["status"] == "published"
        assert len(client.get("/api/jobs").json()) == 1
        taken_down = client.put(f"/api/jobs/{job_id}/moderate", json={"actor_id": admin_id, "action": "take_down", "reason": "Position closed"})
        assert taken_down.status_code == 200 and taken_down.json()["status"] == "taken_down"
        assert client.get("/api/jobs").json() == []
        assert len(client.get(f"/api/jobs?admin_id={admin_id}").json()) == 1
        client.put(f"/api/jobs/{job_id}/moderate", json={"actor_id": admin_id, "action": "publish"})

        skill = client.post("/api/skills", json={"name": "Python 3"})
        assert skill.status_code == 201
        skill_id = skill.json()["id"]
        assert client.get("/api/skills").status_code == 200
        renamed_skill = client.put(f"/api/skills/{skill_id}", json={"name": "Python"})
        assert renamed_skill.status_code == 200
        assert renamed_skill.json()["name"] == "Python"

        candidate = client.post("/api/candidates", json={
            "name": "Ada Lovelace",
            "email": "ada@example.com",
            "location": "London",
            "education": "Data Analyst",
            "years_of_experience": 3,
            "summary": "Builds reliable models.",
            "skills": ["Python", "SQL"],
        })
        assert candidate.status_code == 201
        candidate_id = candidate.json()["id"]
        assert [item["name"] for item in candidate.json()["skills"]] == ["Python", "SQL"]

        linked_candidate = client.post("/api/offers/students/resolve", json={
            "user_id": student_a_id, "name": "Student A", "email": "student-a@example.com",
            "education": "Data Analyst", "location": "Beijing", "summary": "Builds data products.",
        })
        assert linked_candidate.status_code == 200
        linked_candidate_id = linked_candidate.json()["id"]

        legacy_candidate = client.post("/api/candidates", json={
            "name": "Student B", "education": "Software Engineering",
            "summary": "Legacy profile created before student account linking.",
        })
        assert legacy_candidate.status_code == 201
        legacy_offer = client.post("/api/offers", json={
            "candidate_id": legacy_candidate.json()["id"], "reviewer_id": reviewer_id,
            "company_name": "ABC Technology", "job_title": "Backend Intern",
            "employment_type": "Internship", "message": "Join our backend team.",
        })
        assert legacy_offer.status_code == 201
        assert legacy_offer.json()["student_id"] == student_b_id
        assert client.get(f"/api/candidates/{legacy_candidate.json()['id']}").json()["user_id"] == student_b_id

        application = client.post("/api/applications", json={
            "job_id": job_id, "student_id": student_a_id, "candidate_id": linked_candidate_id,
            "cover_note": "I can contribute with Python and SQL from day one.",
        })
        assert application.status_code == 201
        application_id = application.json()["id"]
        assert application.json()["status"] == "submitted"
        assert len(client.get(f"/api/applications?student_id={student_a_id}").json()) == 1
        assert len(client.get(f"/api/applications?reviewer_id={reviewer_id}").json()) == 1
        updated_application = client.put(f"/api/applications/{application_id}", json={"actor_id": reviewer_id, "status": "reviewing"})
        assert updated_application.status_code == 200
        assert updated_application.json()["status"] == "reviewing"
        duplicate_application = client.post("/api/applications", json={"job_id": job_id, "student_id": student_a_id})
        assert duplicate_application.status_code == 409

        offer = client.post("/api/offers", json={
            "candidate_id": linked_candidate_id, "reviewer_id": reviewer_id,
            "company_name": "ABC Technology", "job_title": "AI Application Developer",
            "salary": "¥12,000 / month", "location": "Beijing", "employment_type": "Full-time",
            "message": "We would like to work with you.", "skills": "Python, SQL", "job_id": job_id,
        })
        assert offer.status_code == 201
        offer_id = offer.json()["id"]
        assert offer.json()["status"] == "sent"
        assert offer.json()["student_id"] == student_a_id
        assert len(client.get(f"/api/offers?student_id={student_a_id}").json()) == 1
        assert len(client.get(f"/api/offers?student_id={student_b_id}").json()) == 1
        assert len(client.get(f"/api/offers?reviewer_id={reviewer_id}").json()) == 2

        accepted = client.put(f"/api/offers/{offer_id}", json={"actor_id": student_a_id, "status": "accepted"})
        assert accepted.status_code == 200
        assert accepted.json()["status"] == "accepted"
        assert client.get(f"/api/offers/{offer_id}").json()["status"] == "accepted"
        denied = client.put(f"/api/offers/{offer_id}", json={"actor_id": student_b_id, "status": "rejected"})
        assert denied.status_code == 403
        assert client.delete(f"/api/offers/{offer_id}?actor_id={student_a_id}").status_code == 403
        assert client.delete(f"/api/offers/{offer_id}?actor_id={reviewer_id}").status_code == 204

        resume = client.post(
            "/api/resumes", data={"student_id": str(student_a_id), "actor_id": str(student_a_id)},
            files={"file": ("student-python-resume.pdf", b"%PDF-1.4 minimal test resume", "application/pdf")},
        )
        assert resume.status_code == 201
        resume_id = resume.json()["id"]
        assert len(client.get(f"/api/resumes?student_id={student_a_id}&actor_id={student_a_id}").json()) == 1
        assert client.get(f"/api/resumes?student_id={student_a_id}&actor_id={student_b_id}").status_code == 403
        analysis = client.post(f"/api/resumes/{resume_id}/analyze?actor_id={student_a_id}")
        assert analysis.status_code == 200
        assert 0 <= analysis.json()["overall_score"] <= 100
        assert client.get(f"/api/resumes/{resume_id}/analysis?actor_id={student_a_id}").status_code == 200
        assert client.delete(f"/api/resumes/{resume_id}?actor_id={student_b_id}").status_code == 403
        assert client.delete(f"/api/resumes/{resume_id}?actor_id={student_a_id}").status_code == 204
        assert client.get(f"/api/resumes/{resume_id}?actor_id={student_a_id}").status_code == 404

        interview = client.post("/api/interviews", json={
            "actor_id": reviewer_id, "student_id": student_a_id, "candidate_id": linked_candidate_id,
            "company_name": "ABC Technology", "job_title": "AI Application Developer",
            "interview_round": "Round 1", "interview_type": "Online",
            "scheduled_at": "2026-09-20T10:00:00", "meeting_url": "https://meet.example.com/lions",
        })
        assert interview.status_code == 201
        interview_id = interview.json()["id"]
        assert len(client.get(f"/api/interviews?student_id={student_a_id}&actor_id={student_a_id}").json()) == 1
        assert client.get(f"/api/interviews?student_id={student_a_id}&actor_id={student_b_id}").status_code == 403
        confirmed = client.put(f"/api/interviews/{interview_id}", json={"actor_id": student_a_id, "student_response": "confirmed"})
        assert confirmed.status_code == 200 and confirmed.json()["student_response"] == "confirmed"

        first_update = client.put(
            f"/api/candidates/{candidate_id}",
            json={"skills": ["SQL", "Statistics"]},
        )
        assert first_update.status_code == 200
        assert [item["name"] for item in first_update.json()["skills"]] == ["SQL", "Statistics"]

        queried_candidate = client.get(f"/api/candidates/{candidate_id}")
        assert queried_candidate.status_code == 200
        assert [item["name"] for item in queried_candidate.json()["skills"]] == ["SQL", "Statistics"]

        second_update = client.put(
            f"/api/candidates/{candidate_id}",
            json={"skills": ["Python", "SQL", "Statistics", "SQL"]},
        )
        assert second_update.status_code == 200
        updated_names = [item["name"] for item in second_update.json()["skills"]]
        assert set(updated_names) == {"Python", "SQL", "Statistics"}
        assert len(updated_names) == len(set(updated_names)) == 3

        assert client.get("/api/candidates").status_code == 200
        assert client.get("/api/candidates/99999").status_code == 404
        assert client.delete(f"/api/candidates/{candidate_id}").status_code == 204
        assert client.get(f"/api/candidates/{candidate_id}").status_code == 404

        session = SessionLocal()
        try:
            assert session.execute(text("select count(*) from candidate_skills")).scalar_one() == 0
        finally:
            session.close()

        cors = client.options(
            "/api/health",
            headers={
                "Origin": "http://127.0.0.1:4174",
                "Access-Control-Request-Method": "GET",
            },
        )
        assert cors.status_code == 200
        assert cors.headers["access-control-allow-origin"] == "http://127.0.0.1:4174"

        assert client.delete(f"/api/skills/{skill_id}").status_code == 204

    assert database_file.exists()
