from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Candidate, Company, Interview, Job, Offer, User
from ..schemas import InterviewCreate, InterviewResponse, InterviewUpdate

router = APIRouter(prefix="/interviews", tags=["interviews"])


def serialize_interview(item: Interview) -> dict:
    return {key: getattr(item, key) for key in (
        "id", "student_id", "candidate_id", "company_id", "job_id", "offer_id", "company_name", "job_title",
        "interview_round", "interview_type", "scheduled_at", "location", "meeting_url", "interviewer", "status", "student_response",
        "notes", "created_at", "updated_at",
    )}


def get_interview_or_404(interview_id: int, db: Session) -> Interview:
    item = db.get(Interview, interview_id)
    if not item:
        raise HTTPException(status_code=404, detail="Interview not found")
    return item


@router.get("", response_model=list[InterviewResponse])
def list_interviews(student_id: int | None = None, actor_id: int = Query(...), db: Session = Depends(get_db)):
    actor = db.get(User, actor_id)
    if not actor:
        raise HTTPException(status_code=403, detail="Interview actor could not be verified")
    query = db.query(Interview).order_by(Interview.scheduled_at)
    if actor.role == "student":
        if student_id != actor.id:
            raise HTTPException(status_code=403, detail="Students can only view their own interviews")
        query = query.filter(Interview.student_id == actor.id)
    elif student_id is not None:
        query = query.filter(Interview.student_id == student_id)
    return [serialize_interview(item) for item in query.all()]


@router.post("", response_model=InterviewResponse, status_code=status.HTTP_201_CREATED)
def create_interview(payload: InterviewCreate, db: Session = Depends(get_db)):
    actor = db.get(User, payload.actor_id)
    student = db.get(User, payload.student_id)
    if not actor or not student or student.role != "student":
        raise HTTPException(status_code=403, detail="A valid student is required")
    if actor.role == "student" and actor.id != student.id:
        raise HTTPException(status_code=403, detail="Students can only schedule their own interviews")
    if actor.role not in {"admin", "reviewer", "student"}:
        raise HTTPException(status_code=403, detail="Reviewer, administrator, or student access is required")
    offer = db.get(Offer, payload.offer_id) if payload.offer_id else None
    item = Interview(
        student_id=student.id, candidate_id=payload.candidate_id, company_id=offer.company_id if offer else None,
        job_id=payload.job_id or (offer.job_id if offer else None), offer_id=payload.offer_id, company_name=payload.company_name,
        job_title=payload.job_title, interview_round=payload.interview_round, interview_type=payload.interview_type,
        scheduled_at=payload.scheduled_at, location=payload.location, meeting_url=payload.meeting_url, interviewer=payload.interviewer, notes=payload.notes,
    )
    db.add(item); db.commit(); db.refresh(item)
    return serialize_interview(item)


@router.put("/{interview_id}", response_model=InterviewResponse)
def update_interview(interview_id: int, payload: InterviewUpdate, db: Session = Depends(get_db)):
    item = get_interview_or_404(interview_id, db)
    actor = db.get(User, payload.actor_id)
    if not actor:
        raise HTTPException(status_code=403, detail="Interview actor could not be verified")
    changes = payload.model_dump(exclude_unset=True, exclude={"actor_id"})
    if actor.role == "student":
        if actor.id != item.student_id:
            raise HTTPException(status_code=403, detail="Students can only manage their own interview")
    elif actor.role not in {"admin", "reviewer"}:
        raise HTTPException(status_code=403, detail="Reviewer or administrator access is required")
    for key, value in changes.items(): setattr(item, key, value)
    db.commit(); db.refresh(item)
    return serialize_interview(item)


@router.delete("/{interview_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_interview(interview_id: int, actor_id: int = Query(...), db: Session = Depends(get_db)):
    item = get_interview_or_404(interview_id, db)
    actor = db.get(User, actor_id)
    if not actor:
        raise HTTPException(status_code=403, detail="Interview actor could not be verified")
    if actor.role == "student":
        if actor.id != item.student_id:
            raise HTTPException(status_code=403, detail="Students can only manage their own interview")
    elif actor.role not in {"admin", "reviewer"}:
        raise HTTPException(status_code=403, detail="Reviewer or administrator access is required")
    db.delete(item); db.commit()
