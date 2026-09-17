from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from ..models import Application, Candidate, Job, User
from ..schemas import ApplicationCreate, ApplicationResponse, ApplicationUpdate

router = APIRouter(prefix="/applications", tags=["applications"])


def serialize(item: Application) -> dict:
    return {
        "id": item.id, "job_id": item.job_id, "job_title": item.job.title,
        "company_name": item.job.company.name, "student_id": item.student_id,
        "candidate_id": item.candidate_id, "candidate_name": item.candidate.name if item.candidate else None,
        "status": item.status, "cover_note": item.cover_note, "employer_note": item.employer_note,
        "created_at": item.created_at, "updated_at": item.updated_at,
    }


def get_item(application_id: int, db: Session) -> Application:
    item = db.query(Application).options(
        joinedload(Application.job).joinedload(Job.company), joinedload(Application.candidate)
    ).filter(Application.id == application_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Application not found")
    return item


@router.get("", response_model=list[ApplicationResponse])
def list_applications(student_id: int | None = None, reviewer_id: int | None = None, db: Session = Depends(get_db)):
    query = db.query(Application).options(
        joinedload(Application.job).joinedload(Job.company), joinedload(Application.candidate)
    ).order_by(Application.created_at.desc(), Application.id.desc())
    if student_id is not None:
        student = db.get(User, student_id)
        if not student or student.role != "student":
            raise HTTPException(status_code=403, detail="Student access is required")
        query = query.filter(Application.student_id == student_id)
    elif reviewer_id is not None:
        reviewer = db.get(User, reviewer_id)
        if not reviewer or reviewer.role not in {"reviewer", "teacher", "admin"}:
            raise HTTPException(status_code=403, detail="Reviewer access is required")
    else:
        raise HTTPException(status_code=400, detail="student_id or reviewer_id is required")
    return [serialize(item) for item in query.all()]


@router.post("", response_model=ApplicationResponse, status_code=status.HTTP_201_CREATED)
def create_application(payload: ApplicationCreate, db: Session = Depends(get_db)):
    student = db.get(User, payload.student_id)
    job = db.query(Job).options(joinedload(Job.company)).filter(Job.id == payload.job_id).first()
    if not student or student.role != "student":
        raise HTTPException(status_code=403, detail="Only students can apply")
    if not job or job.status != "published" or job.is_deleted:
        raise HTTPException(status_code=404, detail="Published job not found")
    candidate = db.get(Candidate, payload.candidate_id) if payload.candidate_id else None
    if candidate and candidate.user_id not in {None, payload.student_id}:
        raise HTTPException(status_code=403, detail="Candidate profile does not belong to this student")
    item = Application(job_id=job.id, student_id=student.id, candidate_id=candidate.id if candidate else None, cover_note=payload.cover_note)
    db.add(item)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="You already applied to this job")
    return serialize(get_item(item.id, db))


@router.put("/{application_id}", response_model=ApplicationResponse)
def update_application(application_id: int, payload: ApplicationUpdate, db: Session = Depends(get_db)):
    item = get_item(application_id, db)
    actor = db.get(User, payload.actor_id)
    if not actor:
        raise HTTPException(status_code=403, detail="Valid account required")
    if actor.id != item.student_id and actor.role not in {"reviewer", "teacher", "admin"}:
        raise HTTPException(status_code=403, detail="You cannot update this application")
    if actor.id == item.student_id and payload.status not in {"withdrawn"}:
        raise HTTPException(status_code=403, detail="Students can only withdraw applications")
    if payload.status is not None:
        item.status = payload.status
    if payload.employer_note is not None:
        if actor.id == item.student_id:
            raise HTTPException(status_code=403, detail="Only reviewers can add employer notes")
        item.employer_note = payload.employer_note
    db.commit()
    return serialize(get_item(item.id, db))
