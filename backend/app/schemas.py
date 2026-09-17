from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class UserCreate(BaseModel):
    username: str = Field(min_length=1, max_length=120)
    email: EmailStr
    password_hash: str = Field(min_length=1, max_length=255)
    role: str = Field(default="student", min_length=1, max_length=40)


class UserUpdate(BaseModel):
    username: str | None = Field(default=None, min_length=1, max_length=120)
    email: EmailStr | None = None
    password_hash: str | None = Field(default=None, min_length=1, max_length=255)
    role: str | None = Field(default=None, min_length=1, max_length=40)


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    email: EmailStr
    role: str
    created_at: datetime
    updated_at: datetime


class SkillCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class SkillUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class SkillResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    created_at: datetime


class CandidateCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=60)
    location: str | None = Field(default=None, max_length=160)
    education: str | None = Field(default=None, max_length=255)
    years_of_experience: int = Field(default=0, ge=0)
    summary: str | None = None
    skills: list[str] = Field(default_factory=list)


class CandidateUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=60)
    location: str | None = Field(default=None, max_length=160)
    education: str | None = Field(default=None, max_length=255)
    years_of_experience: int | None = Field(default=None, ge=0)
    summary: str | None = None
    skills: list[str] | None = None


class CandidateResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    email: EmailStr | None
    phone: str | None
    location: str | None
    education: str | None
    years_of_experience: int
    summary: str | None
    user_id: int | None
    skills: list[SkillResponse]
    created_at: datetime
    updated_at: datetime


class OfferIdentityResolve(BaseModel):
    username: str = Field(min_length=1, max_length=120)
    email: EmailStr
    role: str = Field(pattern="^(student|reviewer|admin)$")


class StudentOfferRecipientResolve(BaseModel):
    user_id: int
    name: str = Field(min_length=1, max_length=160)
    email: EmailStr
    education: str | None = Field(default=None, max_length=255)
    location: str | None = Field(default=None, max_length=160)
    summary: str | None = None


class OfferCreate(BaseModel):
    candidate_id: int
    reviewer_id: int
    company_name: str = Field(min_length=1, max_length=160)
    job_title: str = Field(min_length=1, max_length=160)
    salary: str | None = Field(default=None, max_length=160)
    location: str | None = Field(default=None, max_length=160)
    employment_type: str = Field(min_length=1, max_length=80)
    message: str | None = None
    skills: str | None = Field(default=None, max_length=500)
    deadline: str | None = Field(default=None, max_length=20)
    company_id: int | None = None
    job_id: int | None = None


class OfferUpdate(BaseModel):
    actor_id: int
    company_name: str | None = Field(default=None, min_length=1, max_length=160)
    job_title: str | None = Field(default=None, min_length=1, max_length=160)
    salary: str | None = Field(default=None, max_length=160)
    location: str | None = Field(default=None, max_length=160)
    employment_type: str | None = Field(default=None, min_length=1, max_length=80)
    message: str | None = None
    skills: str | None = Field(default=None, max_length=500)
    deadline: str | None = Field(default=None, max_length=20)
    status: str | None = Field(default=None, pattern="^(draft|sent|accepted|rejected)$")


class OfferModeration(BaseModel):
    actor_id: int
    action: str = Field(pattern="^(take_down|restore|delete)$")
    reason: str | None = Field(default=None, max_length=1000)


class OfferResponse(BaseModel):
    id: int
    candidate_id: int
    candidate_name: str
    student_id: int
    reviewer_id: int
    reviewer_name: str
    company_name: str
    job_title: str
    salary: str | None
    location: str | None
    employment_type: str
    message: str | None
    skills: str | None
    deadline: str | None
    status: str
    is_active: bool
    is_deleted: bool
    moderation_reason: str | None
    moderated_at: datetime | None
    moderated_by: int | None
    sent_at: datetime | None
    created_at: datetime
    updated_at: datetime


class CompanyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    website: str | None = Field(default=None, max_length=255)


class CompanyResponse(BaseModel):
    id: int
    name: str
    website: str | None
    created_at: datetime
    updated_at: datetime


class JobCreate(BaseModel):
    company_name: str = Field(min_length=1, max_length=160)
    title: str = Field(min_length=1, max_length=160)
    employment_type: str = Field(min_length=1, max_length=80)
    salary: str | None = Field(default=None, max_length=160)
    location: str | None = Field(default=None, max_length=160)
    description: str | None = None
    skills: str | None = Field(default=None, max_length=500)
    status: str = Field(default="pending_review", pattern="^(draft|pending_review|published)$")


class JobUpdate(BaseModel):
    actor_id: int
    title: str | None = Field(default=None, min_length=1, max_length=160)
    employment_type: str | None = Field(default=None, min_length=1, max_length=80)
    salary: str | None = Field(default=None, max_length=160)
    location: str | None = Field(default=None, max_length=160)
    description: str | None = None
    skills: str | None = Field(default=None, max_length=500)


class JobModeration(BaseModel):
    actor_id: int
    action: str = Field(pattern="^(publish|take_down|delete|normal)$")
    reason: str | None = Field(default=None, max_length=1000)
    risk_status: str = Field(default="normal", pattern="^(normal|flagged)$")


class JobResponse(BaseModel):
    id: int
    company_id: int
    company_name: str
    title: str
    employment_type: str
    salary: str | None
    location: str | None
    description: str | None
    skills: str | None
    status: str
    risk_status: str
    moderation_reason: str | None
    moderated_at: datetime | None
    moderated_by: int | None
    is_deleted: bool
    created_at: datetime
    updated_at: datetime


class ApplicationCreate(BaseModel):
    job_id: int
    student_id: int
    candidate_id: int | None = None
    cover_note: str | None = Field(default=None, max_length=3000)


class ApplicationUpdate(BaseModel):
    actor_id: int
    status: str | None = Field(default=None, pattern="^(submitted|reviewing|interview|rejected|accepted|withdrawn)$")
    employer_note: str | None = Field(default=None, max_length=3000)


class ApplicationResponse(BaseModel):
    id: int
    job_id: int
    job_title: str
    company_name: str
    student_id: int
    candidate_id: int | None
    candidate_name: str | None
    status: str
    cover_note: str | None
    employer_note: str | None
    created_at: datetime
    updated_at: datetime


class ResumeResponse(BaseModel):
    id: int
    student_id: int
    file_name: str
    file_type: str
    file_size: int
    status: str
    uploaded_at: datetime
    updated_at: datetime


class ResumeAnalysisResponse(BaseModel):
    id: int
    resume_id: int
    overall_score: int
    completeness_score: int
    skill_score: int
    project_score: int
    education_score: int
    experience_score: int
    quality_score: int
    strengths: list[str]
    weaknesses: list[str]
    suggestions: list[str]
    profile: dict = {}
    dimensions: dict = {}
    projects: list[str] = []
    skills: list[str] = []
    name: str | None = None
    gender: str | None = None
    age: int | None = None
    email: str | None = None
    phone: str | None = None
    summary: str | None = None
    created_at: datetime
    updated_at: datetime


class InterviewCreate(BaseModel):
    actor_id: int
    student_id: int
    candidate_id: int | None = None
    company_name: str = Field(min_length=1, max_length=160)
    job_title: str = Field(min_length=1, max_length=160)
    interview_round: str = Field(min_length=1, max_length=80)
    interview_type: str = Field(min_length=1, max_length=80)
    scheduled_at: datetime
    location: str | None = Field(default=None, max_length=255)
    meeting_url: str | None = Field(default=None, max_length=500)
    interviewer: str | None = Field(default=None, max_length=160)
    offer_id: int | None = None
    job_id: int | None = None
    notes: str | None = None


class InterviewUpdate(BaseModel):
    actor_id: int
    company_name: str | None = Field(default=None, min_length=1, max_length=160)
    job_title: str | None = Field(default=None, min_length=1, max_length=160)
    interview_round: str | None = Field(default=None, min_length=1, max_length=80)
    interview_type: str | None = Field(default=None, min_length=1, max_length=80)
    scheduled_at: datetime | None = None
    location: str | None = Field(default=None, max_length=255)
    meeting_url: str | None = Field(default=None, max_length=500)
    interviewer: str | None = Field(default=None, max_length=160)
    status: str | None = Field(default=None, pattern="^(scheduled|completed|cancelled|rescheduled)$")
    student_response: str | None = Field(default=None, pattern="^(pending|confirmed|cancelled)$")
    notes: str | None = None


class InterviewResponse(BaseModel):
    id: int
    student_id: int
    candidate_id: int | None
    company_id: int | None
    job_id: int | None
    offer_id: int | None
    company_name: str
    job_title: str
    interview_round: str
    interview_type: str
    scheduled_at: datetime
    location: str | None
    meeting_url: str | None
    interviewer: str | None
    status: str
    student_response: str
    notes: str | None
    created_at: datetime
    updated_at: datetime
