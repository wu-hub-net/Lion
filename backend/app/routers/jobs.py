from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from ..models import Company, Job, User
from ..schemas import JobCreate, JobModeration, JobResponse, JobUpdate

router = APIRouter(prefix="/jobs", tags=["jobs"])


def get_job_or_404(job_id: int, db: Session) -> Job:
    job = db.query(Job).options(joinedload(Job.company)).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


def serialize_job(job: Job) -> dict:
    return {
        "id": job.id, "company_id": job.company_id, "company_name": job.company.name, "title": job.title,
        "employment_type": job.employment_type, "salary": job.salary, "location": job.location,
        "description": job.description, "skills": job.skills, "status": job.status,
        "risk_status": job.risk_status, "moderation_reason": job.moderation_reason,
        "moderated_at": job.moderated_at, "moderated_by": job.moderated_by, "is_deleted": job.is_deleted,
        "created_at": job.created_at, "updated_at": job.updated_at,
    }


@router.get("", response_model=list[JobResponse])
def list_jobs(
    status_filter: str | None = Query(default=None, alias="status"), company: str | None = None,
    title: str | None = None, risk_status: str | None = None, admin_id: int | None = None,
    db: Session = Depends(get_db),
):
    query = db.query(Job).options(joinedload(Job.company)).order_by(Job.created_at.desc(), Job.id.desc())
    if admin_id is not None:
        admin = db.get(User, admin_id)
        if not admin or admin.role != "admin":
            raise HTTPException(status_code=403, detail="Administrator access is required")
    else:
        query = query.filter(Job.status == "published", Job.is_deleted.is_(False))
    if status_filter:
        query = query.filter(Job.status == status_filter)
    if company:
        query = query.filter(Company.name.ilike(f"%{company}%"))
    if title:
        query = query.filter(Job.title.ilike(f"%{title}%"))
    if risk_status:
        query = query.filter(Job.risk_status == risk_status)
    return [serialize_job(job) for job in query.all()]


@router.get("/{job_id}", response_model=JobResponse)
def get_job(job_id: int, admin_id: int | None = None, db: Session = Depends(get_db)):
    job = get_job_or_404(job_id, db)
    if job.is_deleted or job.status != "published":
        admin = db.get(User, admin_id) if admin_id else None
        if not admin or admin.role != "admin":
            raise HTTPException(status_code=404, detail="Job not found")
    return serialize_job(job)


@router.post("", response_model=JobResponse, status_code=status.HTTP_201_CREATED)
def create_job(payload: JobCreate, db: Session = Depends(get_db)):
    company = db.query(Company).filter(Company.name == payload.company_name.strip()).first()
    if not company:
        company = Company(name=payload.company_name.strip())
        db.add(company)
        db.flush()
    job = Job(company_id=company.id, **payload.model_dump(exclude={"company_name"}))
    db.add(job)
    db.commit()
    return serialize_job(get_job_or_404(job.id, db))


@router.put("/{job_id}", response_model=JobResponse)
def update_job(job_id: int, payload: JobUpdate, db: Session = Depends(get_db)):
    job = get_job_or_404(job_id, db)
    actor = db.get(User, payload.actor_id)
    if not actor or actor.role not in {"admin", "reviewer"}:
        raise HTTPException(status_code=403, detail="Reviewer or administrator access is required")
    for key, value in payload.model_dump(exclude_unset=True, exclude={"actor_id"}).items():
        setattr(job, key, value)
    db.commit()
    return serialize_job(get_job_or_404(job.id, db))


@router.put("/{job_id}/moderate", response_model=JobResponse)
def moderate_job(job_id: int, payload: JobModeration, db: Session = Depends(get_db)):
    job = get_job_or_404(job_id, db)
    admin = db.get(User, payload.actor_id)
    if not admin or admin.role != "admin":
        raise HTTPException(status_code=403, detail="Administrator access is required")
    job.moderated_by = admin.id
    job.moderated_at = datetime.now(timezone.utc)
    job.moderation_reason = payload.reason
    job.risk_status = payload.risk_status
    if payload.action == "publish":
        job.status = "published"
        job.is_deleted = False
    elif payload.action == "take_down":
        job.status = "taken_down"
    elif payload.action == "delete":
        job.status = "deleted"
        job.is_deleted = True
        job.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return serialize_job(get_job_or_404(job.id, db))


@router.delete("/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_job(job_id: int, actor_id: int = Query(...), db: Session = Depends(get_db)):
    return moderate_job(job_id, JobModeration(actor_id=actor_id, action="delete"), db)
