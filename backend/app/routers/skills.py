from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Skill
from ..schemas import SkillCreate, SkillResponse, SkillUpdate

router = APIRouter(prefix="/skills", tags=["skills"])


@router.get("", response_model=list[SkillResponse])
def list_skills(db: Session = Depends(get_db)):
    return db.query(Skill).order_by(Skill.name).all()


@router.post("", response_model=SkillResponse, status_code=status.HTTP_201_CREATED)
def create_skill(payload: SkillCreate, db: Session = Depends(get_db)):
    skill = Skill(name=payload.name.strip())
    if not skill.name:
        raise HTTPException(status_code=422, detail="Skill name cannot be empty")
    db.add(skill)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="A skill with this name already exists")
    db.refresh(skill)
    return skill


def get_skill_or_404(skill_id: int, db: Session) -> Skill:
    skill = db.get(Skill, skill_id)
    if not skill:
        raise HTTPException(status_code=404, detail="Skill not found")
    return skill


@router.put("/{skill_id}", response_model=SkillResponse)
def update_skill(skill_id: int, payload: SkillUpdate, db: Session = Depends(get_db)):
    skill = get_skill_or_404(skill_id, db)
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Skill name cannot be empty")
    skill.name = name
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="A skill with this name already exists")
    db.refresh(skill)
    return skill


@router.delete("/{skill_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_skill(skill_id: int, db: Session = Depends(get_db)):
    db.delete(get_skill_or_404(skill_id, db))
    db.commit()
