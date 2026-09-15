# LIONS Evidence Workspace

LIONS is a bilingual talent discovery prototype for students, teachers, and administrators. Students publish reviewed AI resume analysis and GitHub project evidence while keeping the original resume under student-controlled access.

## Main features

- Separate student, teacher, and administrator accounts
- Editable personal profiles with field-level visibility controls
- DeepSeek-assisted resume analysis with student review before publishing
- GitHub repository analysis with separate project evidence tags
- Explainable, configurable teacher scoring rubric
- Student approval required before a teacher can download the original resume
- Talent market filters, administrator statistics, and responsive mobile layouts
- Public introduction page under `lions-web/`

## Run locally

On Windows, double-click:

```text
start-lions.cmd
```

The launcher starts the local server and opens `http://127.0.0.1:4174/`.

Alternatively:

```powershell
python serve-lions.py 4174
```

## Install dependencies

```powershell
npm install
```

## DeepSeek configuration

Keep the API key outside the browser UI. Set the server environment variable:

```powershell
$env:DEEPSEEK_API_KEY="your-key"
python serve-lions.py 4174
```

For local development, the server also supports `deepseek-key.txt` in the project directory. This file is excluded from Git and must never be committed.

## Privacy model

- AI analysis and the student-reviewed summary may be shown in the talent market.
- The original resume is not generally visible to teachers.
- A teacher must send an application request, and the student must approve it before that teacher can download the resume.
- Students and teachers choose which personal profile fields are visible to others.
- Profile data is stored in the browser's local encrypted vault for this prototype.
