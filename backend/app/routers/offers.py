from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from ..models import Candidate, Company, Job, Offer, User
from ..schemas import (
    OfferCreate, OfferIdentityResolve, OfferModeration, OfferResponse, OfferUpdate, StudentOfferRecipientResolve,
    UserResponse,
)

router = APIRouter(prefix="/offers", tags=["offers"])


def get_offer_or_404(offer_id: int, db: Session) -> Offer:
    offer = db.query(Offer).options(joinedload(Offer.candidate), joinedload(Offer.reviewer)).filter(Offer.id == offer_id).first()
    if not offer:
        raise HTTPException(status_code=404, detail="Offer not found")
    return offer


def serialize_offer(offer: Offer) -> dict:
    return {
        "id": offer.id, "candidate_id": offer.candidate_id, "candidate_name": offer.candidate.name,
        "student_id": offer.student_id, "reviewer_id": offer.reviewer_id,
        "reviewer_name": offer.reviewer.username, "company_name": offer.company_name,
        "job_title": offer.job_title, "salary": offer.salary, "location": offer.location,
        "employment_type": offer.employment_type, "message": offer.message, "skills": offer.skills,
        "deadline": offer.deadline, "status": offer.status, "sent_at": offer.sent_at,
        "is_active": offer.is_active, "is_deleted": offer.is_deleted,
        "moderation_reason": offer.moderation_reason, "moderated_at": offer.moderated_at, "moderated_by": offer.moderated_by,
        "created_at": offer.created_at, "updated_at": offer.updated_at,
    }


@router.post("/identities", response_model=UserResponse)
def resolve_identity(payload: OfferIdentityResolve, db: Session = Depends(get_db)):
    email = str(payload.email).lower()
    user = db.query(User).filter(User.email == email).first()
    if user:
        if user.role != payload.role:
            raise HTTPException(status_code=409, detail="This email is already associated with a different role")
        return user
    user = User(username=payload.username, email=email, role=payload.role, password_hash="local-auth-managed")
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.post("/students/resolve")
def resolve_student_recipient(payload: StudentOfferRecipientResolve, db: Session = Depends(get_db)):
    user = db.get(User, payload.user_id)
    if not user or user.role != "student" or user.email != str(payload.email).lower():
        raise HTTPException(status_code=403, detail="Student identity could not be verified")
    candidate = db.query(Candidate).filter(Candidate.user_id == user.id).first()
    if not candidate:
        candidate = db.query(Candidate).filter(Candidate.email == user.email).first()
    if not candidate:
        candidate = Candidate(name=payload.name, email=user.email, education=payload.education, location=payload.location, summary=payload.summary, user_id=user.id)
        db.add(candidate)
    else:
        candidate.user_id = user.id
        candidate.name = payload.name
        candidate.email = user.email
        candidate.education = payload.education
        candidate.location = payload.location
        candidate.summary = payload.summary
    db.commit()
    db.refresh(candidate)
    return {"id": candidate.id, "user_id": user.id}


@router.get("", response_model=list[OfferResponse])
def list_offers(
    student_id: int | None = Query(default=None), reviewer_id: int | None = Query(default=None),
    candidate_id: int | None = Query(default=None), admin_id: int | None = Query(default=None),
    include_moderated: bool = Query(default=False), db: Session = Depends(get_db),
):
    query = db.query(Offer).options(joinedload(Offer.candidate), joinedload(Offer.reviewer)).order_by(Offer.sent_at.desc(), Offer.id.desc())
    if student_id is not None:
        query = query.filter(Offer.student_id == student_id)
    if reviewer_id is not None:
        query = query.filter(Offer.reviewer_id == reviewer_id)
    if candidate_id is not None:
        query = query.filter(Offer.candidate_id == candidate_id)
    if admin_id is not None:
        admin = db.get(User, admin_id)
        if not admin or admin.role != "admin":
            raise HTTPException(status_code=403, detail="Administrator access is required")
    elif not include_moderated:
        query = query.filter(Offer.is_deleted.is_(False), Offer.is_active.is_(True))
    return [serialize_offer(offer) for offer in query.all()]


@router.get("/{offer_id}", response_model=OfferResponse)
def get_offer(offer_id: int, db: Session = Depends(get_db)):
    return serialize_offer(get_offer_or_404(offer_id, db))


@router.post("", response_model=OfferResponse, status_code=status.HTTP_201_CREATED)
def create_offer(payload: OfferCreate, db: Session = Depends(get_db)):
    reviewer = db.get(User, payload.reviewer_id)
    candidate = db.query(Candidate).options(joinedload(Candidate.user)).filter(Candidate.id == payload.candidate_id).first()
    if not reviewer or reviewer.role != "reviewer":
        raise HTTPException(status_code=403, detail="Only a reviewer can send an offer")
    if candidate and not candidate.user:
        matching_students = (
            db.query(User)
            .options(joinedload(User.candidate))
            .filter(User.role == "student", func.lower(User.username) == candidate.name.strip().lower())
            .all()
        )
        available_students = [student for student in matching_students if student.candidate is None]
        if len(available_students) == 1:
            candidate.user = available_students[0]
            candidate.email = candidate.email or available_students[0].email
            db.flush()
    if not candidate or not candidate.user or candidate.user.role != "student":
        raise HTTPException(status_code=422, detail="The selected candidate is not linked to a student account")
    offer = Offer(
        candidate_id=candidate.id, student_id=candidate.user.id, reviewer_id=reviewer.id,
        company_name=payload.company_name, job_title=payload.job_title, salary=payload.salary,
        location=payload.location, employment_type=payload.employment_type, message=payload.message,
        skills=payload.skills, deadline=payload.deadline, status="sent", sent_at=datetime.now(timezone.utc),
        company_id=payload.company_id, job_id=payload.job_id,
    )
    db.add(offer)
    db.commit()
    return serialize_offer(get_offer_or_404(offer.id, db))


@router.put("/{offer_id}", response_model=OfferResponse)
def update_offer(offer_id: int, payload: OfferUpdate, db: Session = Depends(get_db)):
    offer = get_offer_or_404(offer_id, db)
    actor = db.get(User, payload.actor_id)
    if not actor:
        raise HTTPException(status_code=403, detail="Offer actor could not be verified")
    changes = payload.model_dump(exclude_unset=True, exclude={"actor_id"})
    if actor.id == offer.student_id:
        if set(changes) != {"status"} or changes["status"] not in {"accepted", "rejected"}:
            raise HTTPException(status_code=403, detail="Students can only accept or reject their own offers")
    elif actor.id == offer.reviewer_id:
        if changes.get("status") in {"accepted", "rejected"}:
            raise HTTPException(status_code=403, detail="Only the recipient can accept or reject an offer")
    else:
        raise HTTPException(status_code=403, detail="You cannot update this offer")
    for key, value in changes.items():
        setattr(offer, key, value)
    db.commit()
    return serialize_offer(get_offer_or_404(offer.id, db))


@router.delete("/{offer_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_offer(offer_id: int, actor_id: int = Query(...), db: Session = Depends(get_db)):
    offer = get_offer_or_404(offer_id, db)
    if actor_id != offer.reviewer_id:
        raise HTTPException(status_code=403, detail="Only the sending reviewer can delete an offer")
    db.delete(offer)
    db.commit()


@router.put("/{offer_id}/moderate", response_model=OfferResponse)
def moderate_offer(offer_id: int, payload: OfferModeration, db: Session = Depends(get_db)):
    offer = get_offer_or_404(offer_id, db)
    admin = db.get(User, payload.actor_id)
    if not admin or admin.role != "admin":
        raise HTTPException(status_code=403, detail="Administrator access is required")
    offer.moderated_by = admin.id
    offer.moderated_at = datetime.now(timezone.utc)
    offer.moderation_reason = payload.reason
    if payload.action == "take_down":
        offer.is_active = False
    elif payload.action == "restore":
        offer.is_active = True
        offer.is_deleted = False
    else:
        offer.is_active = False
        offer.is_deleted = True
    db.commit()
    return serialize_offer(get_offer_or_404(offer.id, db))
