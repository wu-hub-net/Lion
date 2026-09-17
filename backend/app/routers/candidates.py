from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from ..models import Candidate, CandidateSkill, Skill
from ..schemas import CandidateCreate, CandidateResponse, CandidateUpdate

router = APIRouter(prefix="/candidates", tags=["candidates"])


def get_candidate_or_404(candidate_id: int, db: Session) -> Candidate:
    candidate = (
        db.query(Candidate)
        .options(joinedload(Candidate.skills).joinedload(CandidateSkill.skill))
        .filter(Candidate.id == candidate_id)
        .first()
    )
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")
    return candidate


def serialize_candidate(candidate: Candidate):
    return {
        "id": candidate.id,
        "name": candidate.name,
        "email": candidate.email,
        "phone": candidate.phone,
        "location": candidate.location,
        "education": candidate.education,
        "years_of_experience": candidate.years_of_experience,
        "summary": candidate.summary,
        "user_id": candidate.user_id,
        "skills": [link.skill for link in candidate.skills if link.skill is not None],
        "created_at": candidate.created_at,
        "updated_at": candidate.updated_at,
    }


def attach_skills(candidate: Candidate, names: list[str], db: Session):
    normalized = list(dict.fromkeys(name.strip() for name in names if name.strip()))
    requested_skills: list[Skill] = []

    for name in normalized:
        skill = db.query(Skill).filter(Skill.name == name).first()
        if not skill:
            skill = Skill(name=name)
            db.add(skill)
            db.flush()
        requested_skills.append(skill)

    existing_links = {link.skill_id: link for link in candidate.skills}
    requested_skill_ids = {skill.id for skill in requested_skills}

    for skill_id, link in existing_links.items():
        if skill_id not in requested_skill_ids:
            candidate.skills.remove(link)

    for skill in requested_skills:
        if skill.id not in existing_links:
            candidate.skills.append(CandidateSkill(skill=skill))


@router.get("", response_model=list[CandidateResponse])
def list_candidates(db: Session = Depends(get_db)):
    candidates = (
        db.query(Candidate)
        .options(joinedload(Candidate.skills).joinedload(CandidateSkill.skill))
        .order_by(Candidate.id)
        .all()
    )
    return [serialize_candidate(candidate) for candidate in candidates]


@router.get("/{candidate_id}", response_model=CandidateResponse)
def get_candidate(candidate_id: int, db: Session = Depends(get_db)):
    return serialize_candidate(get_candidate_or_404(candidate_id, db))


@router.post("", response_model=CandidateResponse, status_code=status.HTTP_201_CREATED)
def create_candidate(payload: CandidateCreate, db: Session = Depends(get_db)):
    candidate_data = payload.model_dump(exclude={"skills"})
    candidate = Candidate(**candidate_data)
    db.add(candidate)
    try:
        db.flush()
        attach_skills(candidate, payload.skills, db)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Candidate could not be created")
    return serialize_candidate(get_candidate_or_404(candidate.id, db))


@router.put("/{candidate_id}", response_model=CandidateResponse)
def update_candidate(candidate_id: int, payload: CandidateUpdate, db: Session = Depends(get_db)):
    candidate = get_candidate_or_404(candidate_id, db)
    values = payload.model_dump(exclude_unset=True, exclude={"skills"})
    for key, value in values.items():
        setattr(candidate, key, value)
    if payload.skills is not None:
        attach_skills(candidate, payload.skills, db)
    db.commit()
    return serialize_candidate(get_candidate_or_404(candidate_id, db))


@router.delete("/{candidate_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_candidate(candidate_id: int, db: Session = Depends(get_db)):
    candidate = get_candidate_or_404(candidate_id, db)
    db.delete(candidate)
    db.commit()
