import json
import re
import uuid
import io
import os
import base64
import urllib.request
import urllib.error
from zipfile import ZipFile
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..database import BACKEND_DIR, get_db
from ..models import Resume, ResumeAnalysis, User
from ..schemas import ResumeAnalysisResponse, ResumeResponse

router = APIRouter(prefix="/resumes", tags=["resumes"])
UPLOAD_DIR = BACKEND_DIR / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
ALLOWED_TYPES = {
    "application/pdf", "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain", "image/png", "image/jpeg", "image/webp",
}
ALLOWED_EXTENSIONS = {".pdf", ".doc", ".docx", ".txt", ".png", ".jpg", ".jpeg", ".webp"}
MAX_FILE_SIZE = 10 * 1024 * 1024


def student_or_403(student_id: int, actor_id: int, db: Session) -> User:
    student = db.get(User, student_id)
    if actor_id != student_id or not student or student.role != "student":
        raise HTTPException(status_code=403, detail="You can only access your own resume records")
    return student


def get_resume_or_404(resume_id: int, db: Session) -> Resume:
    resume = db.get(Resume, resume_id)
    if not resume:
        raise HTTPException(status_code=404, detail="Resume not found")
    return resume


def serialize_resume(resume: Resume) -> dict:
    return {
        "id": resume.id, "student_id": resume.student_id, "file_name": resume.file_name,
        "file_type": resume.file_type, "file_size": resume.file_size, "status": resume.status,
        "uploaded_at": resume.uploaded_at, "updated_at": resume.updated_at,
    }


def serialize_analysis(analysis: ResumeAnalysis) -> dict:
    def loads(value, fallback):
        try:
            parsed = json.loads(value or "")
            return parsed if parsed is not None else fallback
        except (TypeError, json.JSONDecodeError):
            return fallback
    def text_item(item):
        if isinstance(item, str):
            return item
        if isinstance(item, dict):
            name = str(item.get("name") or item.get("title") or "").strip()
            description = str(item.get("description") or item.get("summary") or "").strip()
            technologies = item.get("technologies") or item.get("skills") or []
            tech_copy = ", ".join(str(value) for value in technologies if value) if isinstance(technologies, list) else str(technologies or "")
            return " - ".join(value for value in [name, description, tech_copy] if value)
        return str(item) if item is not None else ""

    def text_list(value):
        parsed = loads(value, []) if isinstance(value, str) else value
        return [text for item in (parsed or []) if (text := text_item(item))]

    def safe_age(value):
        match = re.search(r"\d+", str(value or ""))
        return int(match.group()) if match else None

    return {
        "id": analysis.id, "resume_id": analysis.resume_id, "overall_score": analysis.overall_score,
        "completeness_score": analysis.completeness_score, "skill_score": analysis.skill_score,
        "project_score": analysis.project_score, "education_score": analysis.education_score,
        "experience_score": analysis.experience_score, "quality_score": analysis.quality_score,
        "strengths": text_list(analysis.strengths), "weaknesses": text_list(analysis.weaknesses),
        "suggestions": text_list(analysis.suggestions), "created_at": analysis.created_at, "updated_at": analysis.updated_at,
        "profile": loads(getattr(analysis, "profile_json", "{}"), {}),
        "dimensions": loads(getattr(analysis, "dimensions_json", "{}"), {}),
        "projects": text_list(getattr(analysis, "projects_json", "[]")),
        "skills": text_list(getattr(analysis, "skills_json", "[]")),
        "name": getattr(analysis, "extracted_name", None), "gender": getattr(analysis, "extracted_gender", None),
        "age": safe_age(getattr(analysis, "extracted_age", None)), "email": getattr(analysis, "extracted_email", None),
        "phone": getattr(analysis, "extracted_phone", None), "summary": getattr(analysis, "summary", None),
    }


def rule_analysis(resume: Resume) -> dict:
    # First-stage rules score stored metadata without inventing a candidate's experience.
    file_name = resume.file_name.lower()
    name_tokens = set(re.findall(r"[a-z0-9]+", file_name))
    completeness = 65 + min(20, len(name_tokens) * 3)
    skill = 45
    project = 45
    education = 45
    experience = 45
    quality = 60 if resume.file_type == "application/pdf" else 55
    strengths = ["Resume file is uploaded and available for review."]
    weaknesses = ["Detailed text extraction is not available in the first-stage rule analysis."]
    suggestions = ["Add measurable project outcomes and clear technical skills to improve evidence quality."]
    if any(token in name_tokens for token in {"python", "data", "ai", "ml", "sql"}):
        skill = 65
        strengths.append("The file name indicates a technical focus.")
    overall = round((completeness + skill + project + education + experience + quality) / 6)
    return {
        "overall_score": overall, "completeness_score": completeness, "skill_score": skill,
        "project_score": project, "education_score": education, "experience_score": experience,
        "quality_score": quality, "strengths": strengths, "weaknesses": weaknesses, "suggestions": suggestions,
    }


def extract_text(resume: Resume) -> str:
    path = UPLOAD_DIR / resume.file_path
    raw = path.read_bytes()
    suffix = Path(resume.file_name).suffix.lower()
    if suffix == ".txt":
        return raw.decode("utf-8", errors="ignore")[:120000]
    if suffix == ".docx":
        try:
            with ZipFile(io.BytesIO(raw)) as archive:
                xml = archive.read("word/document.xml").decode("utf-8", errors="ignore")
            return re.sub(r"<[^>]+>", " ", xml).replace("&amp;", "&")[:120000]
        except Exception:
            return ""
    if suffix == ".pdf":
        try:
            from pypdf import PdfReader
            return "\n".join(page.extract_text() or "" for page in PdfReader(io.BytesIO(raw)).pages)[:120000]
        except Exception:
            return ""
    if suffix in {".png", ".jpg", ".jpeg", ".webp"}:
        key = os.getenv("DASHSCOPE_API_KEY", "")
        if not key:
            return ""
        mime = "image/jpeg" if suffix in {".jpg", ".jpeg"} else f"image/{suffix.lstrip('.') }"
        payload = {"model": "qwen-vl-plus", "input": {"messages": [{"role": "user", "content": [{"image": f"data:{mime};base64,{base64.b64encode(raw).decode()}"}, {"text": "Extract all resume text faithfully. Return plain text only."}]}]}}
        response = call_json_api(os.getenv("DASHSCOPE_BASE_URL", "https://dashscope.aliyuncs.com") + "/api/v1/services/aigc/multimodal-generation/generation", key, payload, {"X-DashScope-Async": "disable"})
        try:
            content = response["output"]["choices"][0]["message"]["content"]
            return " ".join(item.get("text", "") for item in content if isinstance(item, dict))[:120000]
        except (TypeError, KeyError, IndexError):
            return ""
    return ""


def call_json_api(url: str, key: str, payload: dict, headers: dict | None = None) -> dict | None:
    if not key:
        return None
    request = urllib.request.Request(url, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}", **(headers or {})}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=35) as response:
            return json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError):
        return None


def ai_analysis(resume: Resume, text: str) -> dict | None:
    api_key = os.getenv("DEEPSEEK_API_KEY", "")
    if not api_key or not text.strip():
        return None
    prompt = """Extract and score this resume. Return JSON only with keys: name, gender, age, email, phone, summary, skills (array), projects (array), strengths (array), weaknesses (array), suggestions (array), dimensions (object with completeness, skills, projects, education, experience, quality integers 0-100), overall_score integer 0-100. Never invent missing facts; use null or empty arrays. Resume:\n""" + text
    payload = {"model": os.getenv("DEEPSEEK_MODEL", "deepseek-chat"), "temperature": 0.1, "response_format": {"type": "json_object"}, "messages": [{"role": "system", "content": "You are a factual recruiting evidence analyst."}, {"role": "user", "content": prompt}]}
    response = call_json_api(os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com") + "/chat/completions", api_key, payload)
    try:
        content = response["choices"][0]["message"]["content"]
        return json.loads(content)
    except (TypeError, KeyError, IndexError, json.JSONDecodeError):
        return None


def enrich_result(resume: Resume, result: dict) -> dict:
    dimensions = result.get("dimensions") or {}
    dimensions = {key: max(0, min(100, int(dimensions.get(key, 0) or 0))) for key in ["completeness", "skills", "projects", "education", "experience", "quality"]}
    if not result.get("overall_score"):
        result["overall_score"] = round(sum(dimensions.values()) / len(dimensions)) if any(dimensions.values()) else rule_analysis(resume)["overall_score"]
    result["dimensions"] = dimensions
    result.setdefault("strengths", [])
    result.setdefault("weaknesses", [])
    result.setdefault("suggestions", [])
    result.setdefault("skills", [])
    result.setdefault("projects", [])
    result["projects"] = [
        " - ".join(value for value in [
            str(item.get("name") or item.get("title") or "").strip(),
            str(item.get("description") or item.get("summary") or "").strip(),
            ", ".join(str(value) for value in (item.get("technologies") or item.get("skills") or []) if value),
        ] if value) if isinstance(item, dict) else str(item)
        for item in result["projects"] if item
    ]
    result["skills"] = [str(item.get("name") or item.get("skill") or "") if isinstance(item, dict) else str(item) for item in result["skills"] if item]
    age_match = re.search(r"\d+", str(result.get("age") or ""))
    result["age"] = int(age_match.group()) if age_match else None
    return {
        "overall_score": int(result.get("overall_score", 0)), "completeness_score": dimensions["completeness"], "skill_score": dimensions["skills"],
        "project_score": dimensions["projects"], "education_score": dimensions["education"], "experience_score": dimensions["experience"], "quality_score": dimensions["quality"],
        "strengths": result["strengths"], "weaknesses": result["weaknesses"], "suggestions": result["suggestions"],
        "profile_json": json.dumps({"name": result.get("name"), "gender": result.get("gender"), "age": result.get("age"), "email": result.get("email"), "phone": result.get("phone"), "summary": result.get("summary")}, ensure_ascii=False),
        "dimensions_json": json.dumps(dimensions), "projects_json": json.dumps(result["projects"], ensure_ascii=False), "skills_json": json.dumps(result["skills"], ensure_ascii=False),
        "extracted_name": result.get("name"), "extracted_gender": result.get("gender"), "extracted_age": result.get("age"), "extracted_email": result.get("email"), "extracted_phone": result.get("phone"), "summary": result.get("summary"),
    }


@router.get("", response_model=list[ResumeResponse])
def list_resumes(student_id: int, actor_id: int, db: Session = Depends(get_db)):
    student_or_403(student_id, actor_id, db)
    return [serialize_resume(item) for item in db.query(Resume).filter(Resume.student_id == student_id).order_by(Resume.uploaded_at.desc()).all()]


@router.post("", response_model=ResumeResponse, status_code=status.HTTP_201_CREATED)
async def upload_resume(
    student_id: int = Form(...), actor_id: int = Form(...), file: UploadFile = File(...), db: Session = Depends(get_db),
):
    student_or_403(student_id, actor_id, db)
    extension = Path(file.filename or "").suffix.lower()
    if extension not in ALLOWED_EXTENSIONS or (file.content_type and file.content_type not in ALLOWED_TYPES and file.content_type != "application/octet-stream"):
        raise HTTPException(status_code=415, detail="Only PDF, DOCX, TXT, or image resumes are allowed")
    data = await file.read(MAX_FILE_SIZE + 1)
    if not data or len(data) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="Resume must be between 1 byte and 10 MB")
    stored_name = f"{uuid.uuid4().hex}{extension}"
    destination = UPLOAD_DIR / stored_name
    destination.write_bytes(data)
    resume = Resume(
        student_id=student_id, file_name=Path(file.filename).name, file_path=stored_name,
        file_type=file.content_type, file_size=len(data), status="uploaded",
    )
    db.add(resume)
    db.commit()
    db.refresh(resume)
    return serialize_resume(resume)


@router.get("/{resume_id}", response_model=ResumeResponse)
def get_resume(resume_id: int, actor_id: int, db: Session = Depends(get_db)):
    resume = get_resume_or_404(resume_id, db)
    student_or_403(resume.student_id, actor_id, db)
    return serialize_resume(resume)


@router.get("/{resume_id}/download")
def download_resume(resume_id: int, actor_id: int, db: Session = Depends(get_db)):
    resume = get_resume_or_404(resume_id, db)
    student_or_403(resume.student_id, actor_id, db)
    path = UPLOAD_DIR / resume.file_path
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Resume file is unavailable")
    return FileResponse(path, filename=resume.file_name, media_type=resume.file_type)


@router.delete("/{resume_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_resume(resume_id: int, actor_id: int, db: Session = Depends(get_db)):
    resume = get_resume_or_404(resume_id, db)
    student_or_403(resume.student_id, actor_id, db)
    path = UPLOAD_DIR / resume.file_path
    db.delete(resume)
    db.commit()
    path.unlink(missing_ok=True)


@router.post("/{resume_id}/analyze", response_model=ResumeAnalysisResponse)
def analyze_resume(resume_id: int, actor_id: int, db: Session = Depends(get_db)):
    resume = get_resume_or_404(resume_id, db)
    student_or_403(resume.student_id, actor_id, db)
    text = extract_text(resume)
    result = ai_analysis(resume, text) or rule_analysis(resume)
    stored_result = enrich_result(resume, result)
    stored_result.update({"strengths": json.dumps(stored_result["strengths"], ensure_ascii=False), "weaknesses": json.dumps(stored_result["weaknesses"], ensure_ascii=False), "suggestions": json.dumps(stored_result["suggestions"], ensure_ascii=False)})
    analysis = resume.analysis or ResumeAnalysis(resume_id=resume.id, **stored_result)
    if resume.analysis:
        for key, value in stored_result.items():
            setattr(analysis, key, value)
    else:
        db.add(analysis)
    resume.status = "analyzed"
    db.commit()
    db.refresh(analysis)
    return serialize_analysis(analysis)


@router.get("/{resume_id}/analysis", response_model=ResumeAnalysisResponse)
def get_resume_analysis(resume_id: int, actor_id: int, db: Session = Depends(get_db)):
    resume = get_resume_or_404(resume_id, db)
    student_or_403(resume.student_id, actor_id, db)
    if not resume.analysis:
        raise HTTPException(status_code=404, detail="Resume analysis not found")
    return serialize_analysis(resume.analysis)
