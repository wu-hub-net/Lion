# LIONS 全站页面与功能说明（中等版）

> 本说明以当前项目代码为依据，区分已实现、本地原型（local prototype）、Mock 与可选后端能力。

## 1. 项目概览 / Project Overview

LIONS Evidence Workspace 是一个中英双语的校园人才证据工作台。学生可以维护项目、简历分析和公开人才档案；评审员可以搜索、查看候选人、维护评估标准并发布 Offer；管理员可以查看本地统计和维护筛选项。

LIONS is a bilingual campus talent evidence workspace. Students publish evidence, reviewers evaluate candidates and send Offers, and administrators maintain local market filters.

前端采用原生 HTML、CSS、JavaScript。认证成功前只挂载登录界面，成功后才挂载工作台。工作台各页面通过侧栏和前端状态切换，不是每个视图各自独立的 HTML 文件。

## 2. 页面与视图 / Pages and Views

| 使用面 / Surface | 页面或视图 / Page or view | 主要用途 / Purpose | 实现状态与数据 / Status and data |
|---|---|---|---|
| 认证入口 / Auth | 登录与创建账户 / Login and Create Account | 邮箱、密码、角色登录及本地注册 | 已实现；浏览器本地账户与会话 |
| 公开端 / Public | 公开介绍页 / Public Launch Page | 产品介绍、方案、定价与公开入口 | 已实现静态介绍页；无支付流程 |
| 评审员 / Reviewer | 概览 / Overview | 搜索健康度、排名候选人、Rubric、动态摘要 | 部分实现；Mock 与本地状态 |
| 评审员 / Reviewer | 候选清单 / Shortlists | 查看保存的候选人 | Talent Pool 的筛选模式；本地 shortlist 数据 |
| 评审员 / Reviewer | 人才库 / Talent Pool | 搜索候选人、查看资料与证据 | Mock、本地学生提交、可选 candidates API |
| 评审员 / Reviewer | 测评 / Assessments | 查看本地测评任务与状态 | 本地 UI / localStorage 原型 |
| 评审员 / Reviewer | 发布 Offer / Send Offer | 填写并发布岗位 Offer | 弹窗子流程；Offer 保存到 localStorage |
| 学生 / Student | 提交证据 / Submit Evidence | 项目、简历、分析与人才档案发布 | localStorage、IndexedDB、可选分析服务 |
| 学生 / Student | Offer / Offers | 查看推荐 Offer 与完整 Offer 列表 | 读取本地发布的 Offer；兴趣操作仅提示 |
| 学生、评审员、管理员 | 个人资料 / Personal Profile | 维护资料、可见性与角色相关信息 | 浏览器本地存储 |
| 管理员 / Admin | 管理平台 / Admin Platform | 本地统计、市场筛选及管理项 | 本地管理 UI / localStorage |

候选人详情、候选人公开资料、简历访问申请均为页面内弹窗或子流程。Shortlists 和 Send Offer 不是单独的 HTML 页面。

## 3. 导航关系 / Navigation Structure

```text
LIONS
├─ Public Surface
│  └─ Public Launch Page
├─ Authentication Entry
│  └─ Login / Create Account
├─ Student Workspace
│  ├─ Submit Evidence
│  ├─ Offers
│  └─ Personal Profile
├─ Reviewer Workspace
│  ├─ Overview
│  ├─ Shortlists
│  ├─ Talent Pool
│  ├─ Assessments
│  ├─ Send Offer modal
│  └─ Personal Profile
└─ Administrator Workspace
   ├─ Admin Platform
   ├─ Talent Pool
   └─ Personal Profile
```

本地开发服务器把 `/login`、`/dashboard`、`/shortlists`、`/talent`、`/evaluation`、`/evidence`、`/profile` 映射到统一入口；真正显示哪个视图由认证状态和用户角色决定。

## 4. 核心功能 / Core Functions

### 4.1 登录、角色和资料 / Login, Roles, and Profile

- 支持学生（Student）、评审员（Reviewer）和管理员（Administrator）角色。
- 登录和创建账户为前端本地原型：账户资料保存在加密 localStorage，会话保存在 sessionStorage。
- 未认证时不渲染登录后的工作台；认证后进入 Dashboard。
- 返回登录界面会清除当前会话，不等同于服务端登出。

### 4.2 评审员：候选人、清单与标准 / Reviewer: Candidates, Shortlists, and Rubrics

- 人才库支持文本搜索、过滤、候选人卡片和详情查看。
- Overview 显示候选排名、搜索健康度、评估标准（Rubric）和证据动态。
- Shortlists 展示已保存候选人，本质上是人才库的保存筛选视图。
- 测评、筛选、Shortlist 和评估状态目前主要存于当前浏览器。
- 评审员可通过 Send Offer 弹窗发布 Offer；学生端会读取同一份本地 Offer 数据。

### 4.3 学生：证据、简历和 Offer / Student: Evidence, Resume, and Offers

- 学生可维护项目、简历相关资料和公开人才档案。
- 原始简历文件放在浏览器 IndexedDB（`lions-private-files`），不是后端文件服务。
- 学生发布后，评审员人才库可合并显示本地学生提交。
- 评审员申请查看原始简历时，学生可接受或拒绝；接受后当前浏览器可下载对应文件。
- 右下推荐 Offer 与独立 Offers 页面使用同一组 Offer 数据；“表达兴趣”当前仅显示提示，不生成正式投递记录。

### 4.4 管理员 / Administrator

- 管理平台提供本地市场统计、筛选项和管理入口。
- 该部分是浏览器内管理原型，不能替代多用户后台管理系统。

### 4.5 外部分析 / Optional External Analysis

- GitHub 项目分析读取公开项目元数据，不是 OAuth 授权连接。
- DeepSeek 简历分析需本地代理和本机密钥；不可用时使用本地回退结果。

## 5. 数据来源与后端边界 / Data Sources and Backend Boundary

| 数据域 / Data area | 当前来源 / Current source | 说明 / Note |
|---|---|---|
| 登录、账户、资料 | encrypted localStorage + sessionStorage | 尚未接入后端 users API |
| 简历原始文件 | IndexedDB | 当前浏览器本地文件存储 |
| Offer、测评、申请、Shortlist、筛选、学生提交 | localStorage | 多数为同一浏览器内原型数据 |
| 候选人列表 | Mock + 本地学生提交 + 可选 API | API 返回非空 candidates 时替换候选人集合；失败/空结果保留 Mock |
| SQLite 后端 | FastAPI + SQLAlchemy + SQLite | 有 users、skills、candidates、candidate_skills 表和 CRUD API |

当前前端实际接入的是可选候选人读取请求：`api-client.js` 请求 `GET /api/candidates`。前端尚未把登录、资料、Offer、测评、申请流程及候选人写入操作接到后端 API；因此不能把这些功能描述为数据库实时协作能力。

后端已提供以下 API：

- `GET /api/health`
- `GET/POST/PUT/DELETE /api/users...`
- `GET/POST/PUT/DELETE /api/skills...`
- `GET/POST/PUT/DELETE /api/candidates...`

## 6. 中英文支持 / Chinese and English Support

语言入口位于登录页、工作台右上角和公开介绍页，语言偏好保存在 `lions-language`。`i18n.js` 使用词典、模式匹配和 MutationObserver 处理固定及动态插入的 UI 文案，刷新后保留选择。

固定导航、按钮、标题和多数动态候选人、Offer、资料文案支持中英切换。姓名、学校、技术品牌（例如 Python、SQL、GitHub、FastAPI、SQLite）、用户自行输入的岗位或项目文本，以及外部数据通常保留原文；自由文本不保证语义自动翻译。

## 7. 主要流程 / Main Flows

### 学生发布档案 / Student Publishing

1. 登录或创建本地学生账户。
2. 添加项目、简历和分析内容。
3. 调整资料及可见性。
4. 发布到本地学生提交数据。
5. 评审员从人才库查看该人才档案。

### 评审候选人 / Reviewer Evaluation

1. 登录评审员工作台。
2. 在 Overview 或 Talent Pool 搜索候选人。
3. 查看候选人资料与证据，保存到 Shortlists。
4. 通过本地申请流程请求原始简历。
5. 按需发布 Offer。

### Offer 流程 / Offer Flow

1. 评审员填写并发布 Offer。
2. Offer 保存于 `lions-offers`。
3. 学生在推荐区和 Offers 页面查看有效 Offer。
4. 学生表达兴趣后只得到界面提示，当前不创建申请记录。

## 8. 已知限制 / Known Limitations

- 前端认证与 FastAPI 的 users 表没有连接。
- 登录后 URL 不等同于完整的服务端深链接恢复机制。
- Offer、测评、申请、Shortlist、资料与证据大多是单浏览器 localStorage 原型。
- API 不可用或候选人 API 返回空数组时，人才库保留 Mock fallback。
- 公开介绍页的 Pricing 没有支付或订单流程。
- GitHub 连接不是 OAuth；DeepSeek 依赖本地密钥和代理。

