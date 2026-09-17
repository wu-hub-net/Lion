# LIONS 全站页面与功能说明（详细版）

> 本文依据当前代码实现整理。已实现、部分实现、Mock 和本地存储能力均单独标记；未把计划功能描述为已完成能力。

## 1. 项目概览 / Project Overview

LIONS Evidence Workspace 是一套中英双语的校园人才证据工作台原型。学生维护项目、简历分析和人才档案；评审员创建搜索、调整评估标准、浏览候选人与发布 Offer；管理员维护本地人才市场筛选项与统计；公开端展示产品介绍和定价内容。

LIONS is a bilingual campus talent evidence workspace prototype. Students manage project and resume evidence, reviewers search and evaluate candidates, and administrators maintain local talent-market filters and statistics.

### 技术结构 / Technical Structure

    Browser UI: index.html, app.js, auth-bootstrap.js, profile-admin.js, mobile.js
      ├─ Browser data: localStorage, sessionStorage, IndexedDB
      ├─ Optional candidate API: api-client.js → FastAPI → SQLAlchemy → SQLite
      └─ Optional resume analysis: serve-lions.py → DeepSeek

前端为原生 HTML、CSS、JavaScript。index.html 包含认证页面和登录后工作台模板；未认证时仅渲染登录页，认证成功后才挂载工作台。serve-lions.py 将 login、dashboard、talent、profile 等本地地址回退至同一入口，实际视图由前端状态和角色控制。

The frontend uses native HTML, CSS, and JavaScript. The local server maps workspace URLs to the same entry document; the client mounts and switches authenticated views by role.

## 2. 统一术语 / Terminology

| 中文 | English in UI | 说明 / Note |
|---|---|---|
| 登录 | Log in | 进入本地工作台账户 |
| 创建账户 | Create account | 创建浏览器本地账户 |
| 概览 | Overview | 评审员搜索、排名与标准总览 |
| 候选清单 | Shortlists | 已保存候选人视图 |
| 人才库 | Talent pool | 候选人搜索与证据浏览 |
| 测评 | Assessments | 本地测评任务列表 |
| 提交证据 | Submit evidence | 学生项目、简历与资料发布 |
| 个人资料 | Personal profile | 角色资料与可见性控制 |
| Offer | Offer / Offers | 本地发布和浏览的机会条目 |
| 管理平台 | Admin platform | 管理员统计与筛选维护 |
| 评估标准 | Rubric | 候选人加权匹配维度 |

## 3. 端与页面关系 / Surfaces and Page Relationships

当前实际识别出 5 个使用面，其中学生、评审员和管理员共用同一登录后工作台模板。

    LIONS
    ├─ 公开端 / Public Surface
    │  └─ 公开介绍页 / Public Launch Page
    ├─ 认证入口 / Authentication Entry
    │  └─ 登录与注册 / Login and Create Account
    ├─ 学生端 / Student Workspace
    │  ├─ 提交证据 / Submit Evidence
    │  ├─ Offer 列表 / Offers
    │  └─ 个人资料 / Personal Profile
    ├─ 评审员端 / Reviewer Workspace
    │  ├─ 概览 / Overview
    │  ├─ 候选清单 / Shortlists
    │  ├─ 人才库 / Talent Pool
    │  ├─ 测评 / Assessments
    │  ├─ 发布 Offer / Send Offer modal
    │  └─ 个人资料 / Personal Profile
    └─ 管理员端 / Administrator Workspace
       ├─ 管理平台 / Admin Platform
       ├─ 人才库 / Talent Pool
       └─ 个人��料 / Personal Profile

页面关系：登录前工作台不会渲染；登录成功后工作台挂载并进入 dashboard 地址。侧栏在同一页面中切换视图。Shortlists 是 Talent pool 的已保存候选人模式，并非单独候选人数据页。学生发布档案会写入本地提交数据，评审员人才库会合并显示 Mock、学生提交和可选 API 候选人。Offer 由评审员发布到本地存储，学生推荐区和 Offers 页面读取同一数据。

## 4. 登录与权限 / Login and Permissions

### 登录与创建账户 / Login and Create Account

| 项目 | 中文说明 | English |
|---|---|---|
| 所属端 | 认证入口 | Authentication entry |
| 入口 | 根路径、login，或未认证的工作台地址 | Root, login, or unauthenticated workspace URL |
| 作用 | 登录、注册、选择角色、进入工作台 | Log in, register, choose a role, enter workspace |
| 状态 | 已实现的浏览器本地认证原型 | Implemented browser-local authentication prototype |
| 数据 | 加密 localStorage、sessionStorage | Encrypted localStorage and sessionStorage |

主要区域：品牌介绍、登录和创建账户标签、邮箱、密码、学生/评审员/管理员角色、注册姓名、学校或组织、管理员邀请码、公开页入口、语言切换。

主要交互：登录会按邮箱、密码和角色恢复本地账户；创建账户会建立本地加密资料；管理员注册需邀请码；语言切换在中文和 English 之间保存偏好；公开页入口打开品牌介绍页。

重要说明：前端认证与 backend 的 users API 独立。当前不是基于服务器 Token、Cookie 或跨设备同步的正式认证。

### 路由行为 / Route Behavior

| 地址 | 实际行为 / Actual behavior |
|---|---|
| login | 显示独立登录/注册页面。 |
| dashboard | 登录后的默认工作台地址；不同角色进入不同默认视图。 |
| shortlists、talent、evaluation、evidence、profile | 本地服务器返回同一入口，当前主要由侧栏和角色状态切换，不是完整独立深链接页面。 |

## 5. 公开端 / Public Surface

### 公开介绍页 / Public Launch Page

| 项目 | 内容 |
|---|---|
| 所属端 | 公开端 / Public Surface |
| 入口 | 登录页的浏览公开介绍页；lions-web/index.html |
| 访问条件 | 无需登录 / No login required |
| 作用 | 介绍 LIONS 的产品定位、证据方法、原则、商业模式与试点。 |
| 状态 | 已实现静态介绍页 / Implemented static informational page |
| 数据来源 | 静态 HTML 和本地图片；无业务数据库读写。 |

主要页面区块：Hero、Mission、Vision、Solution、对比表、Non-negotiables、Business model、Pricing、Posts、Pilot。主要交互：锚点导航、移动端菜单、语言切换、返回工作台。页面展示 Student、Department/lab、Tech SME、Institution 的价格说明，但没有支付、订单、订阅或报价功能。

## 6. 评审员端 / Reviewer Workspace

### 概览 / Overview

| 项目 | 内容 |
|---|---|
| 入口 | 左侧概览；评审员登录后的默认视图。 |
| 作用 | 展示当前搜索、搜索健康度、候选人排名、Rubric 和证据动态。 |
| 状态 | 部分实现 / Partially implemented。 |
| 数据 | Mock 候选人、本地搜索和权重；候选人可选读取 API。 |

主要功能：新建搜索会保存职位名称、技能与目标至 lions-active-search；排名/最近切换调整候选人排序；Rubric 可调整 Python、数据分析、统计、沟通等权重；重置恢复默认；分享搜索尝试复制当前地址；发送 Offer 打开发布弹窗。

### 候选清单 / Shortlists

| 项目 | 内容 |
|---|---|
| 入口 | 左侧候选清单；概览中的管理候选清单。 |
| 作用 | 仅显示已保存候选人，便于比较。 |
| 状态 | 已实现本地列表功能 / Implemented local list. |
| 数据 | lions-shortlist 保存候选人 ID；候选人正文来自 Mock、学生提交或可用 API。 |

主要操作：保存或移除候选人、打开证据详情、导出本地 CSV。Shortlist 本身不写入 SQLite。

### 人才库 / Talent Pool

| 项目 | 内容 |
|---|---|
| 入口 | 左侧人才库；管理员的打开人才市场。 |
| 作用 | 搜索、筛选、排序、保存及查看候选人证据。 |
| 状态 | 部分实现 / Partially implemented。 |
| 数据 | Mock + lions-submissions + 可选 GET candidates API。 |

主要区域：关键词搜索、技能/领域/学校/毕业年份/可用性筛选、排序、候选人卡片、候选清单侧栏。

主要交互：搜索姓名、技能和项目；按筛选项过滤；按最佳匹配、最近活跃或证据覆盖率排序；查看证据；保存到候选清单；导出 CSV。候选人详情会展示资料、证据、项目/简历标签与评分。学生联系方式会受资料可见性设置限制。

### 测评 / Assessments

| 项目 | 内容 |
|---|---|
| 入口 | 左侧测评。 |
| 作用 | 创建并查看与当前搜索相关的测评任务。 |
| 状态 | 本地 UI 与存储 / Local UI and storage。 |
| 数据 | lions-assessments localStorage。 |

输入为测评标题、候选人任务说明、预计时长和截止日期。发布后显示在列表。当前没有服务端分发、学生作答、评分或评审 API。

### 发布 Offer / Send Offer

| 项目 | 内容 |
|---|---|
| 入口 | 顶部发送 Offer。 |
| 作用 | 创建学生端可见的机会条目。 |
| 状态 | 已实现 localStorage 发布功能；不是招聘后端。 |
| 数据 | lions-offers localStorage。 |

输入：岗位、类型、地点、薪资、截止日期、技能和详情。输出：学生推荐区和 Offers 页面读取有效条目。

## 7. 学生端 / Student Workspace

### 提交证据 / Submit Evidence

| 项目 | 内容 |
|---|---|
| 入口 | 学生登录默认页；左侧提交证据。 |
| 作用 | 管理项目、简历、简历分析、公开范围和人才档案发布。 |
| 状态 | 部分实现 / Partially implemented。 |
| 数据 | localStorage、IndexedDB、可选 DeepSeek 与 GitHub API。 |

主要区域：GitHub 状态、项目链接、简历上传与分析、公开资料预览、推荐 Offer、申请请求。

主要交互：添加或移除项目；上传 PDF/DOC/DOCX；提取简历文本；配置 DeepSeek 密钥时请求分析，失败时使用本地回退；编辑摘要和能力标签；设置公开证据；发布人才档案。项目分析读取公开 GitHub 元数据；连接按钮不是 GitHub OAuth。

简历原文件保存于 IndexedDB 的 lions-private-files，不保存到 SQLite。已发布的人才资料写入 lions-submissions，随后可由评审员人才库显示。

### Offer / Offers

| 项目 | 内容 |
|---|---|
| 入口 | 学生侧栏 Offers；推荐 Offer 卡片。 |
| 作用 | 搜索、筛选、查看评审员端发布的本地机会。 |
| 状态 | 部分实现 / Partially implemented。 |
| 数据 | lions-offers localStorage。 |

学生可按关键词、类型、地点筛选，查看地点、薪资、截止日期、详情和技能。表达兴趣只显示前端提示，不会创建正式投递或通知记录。推荐 Offer 当前是最多四条有效本地 Offer 的展示，不是个性化匹配算法。

### 个人资料 / Personal Profile（学生）

| 项目 | 内容 |
|---|---|
| 入口 | 左侧个人资料；用户快捷入口。 |
| 作用 | 编辑姓名、学校、毕业年份、可用性、联系方式、头像及公开范围。 |
| 状态 | 已实现本地加密资料保存；不接入 users API。 |

可控制照片、学校、毕业年份、可用性、电话、邮箱、联系渠道和 GitHub 的对外可见性；保存后会同步更新已发布的本地人才档案。

### 申请请求 / Application Requests

评审员请求原始简历后，本地 lions-application-requests 记录请求。学生可接受或拒绝；接受后评审员才能下载当前浏览器 IndexedDB 中的简历。该流程是浏览器原型，不是服务器权限系统。

## 8. 管理员端 / Administrator Workspace

### 管理平台 / Admin Platform

| 项目 | 内容 |
|---|---|
| 入口 | 管理员登录默认页；左侧管理平台。 |
| 作用 | 查看账户、提交、简历分析、筛选项统计，维护人才市场筛选项。 |
| 状态 | 部分实现 / Partially implemented。 |
| 数据 | lions-accounts-v2、lions-submissions、lions-talent-filters localStorage。 |

主要区域：Accounts、Submissions、Resume Analyses、Filter Options、证据标签统计、筛选项管理、隐私规则说明。

主要交互：按技能、领域、学校、毕业年份、可用性添加唯一筛选项，移除筛选项，打开人才市场。它不管理 FastAPI 数据库，不具备服务器审计、用户权限分配或跨用户后台管理。

### 个人资料 / Personal Profile（评审员与管理员）

评审员和管理员复用个人资料页面。可编辑姓名、组织、联系方式、头像和可见性设置，数据保存为浏览器本地加密账户资料。

## 9. 后端 API 与 SQLite / Backend API and SQLite

后端目录为 backend，使用 FastAPI、SQLAlchemy 与 SQLite。启动后自动创建 backend/data/lions.db。它是轻量候选人 API，尚未取代前端认证、资料、简历、Offer、测评或申请请求的本地逻辑。

| 表 / Table | 用途 / Purpose |
|---|---|
| users | 用户名、邮箱、密码哈希、角色与时间戳；响应不返回 password_hash。 |
| candidates | 候选人基础资料、地点、教育、经验与摘要。 |
| skills | 唯一技能名称。 |
| candidate_skills | 候选人与技能多对多关联，含唯一约束。 |

| Method | Endpoint | 功能 / Function |
|---|---|---|
| GET | /api/health | 健康检查 / Health check |
| GET, POST | /api/users | 查询、创建用户 / List and create users |
| PUT, DELETE | /api/users/{id} | 更新、删除用户 / Update and delete users |
| GET, POST | /api/skills | 查询、创建技能 / List and create skills |
| PUT, DELETE | /api/skills/{id} | 更新、删除技能 / Update and delete skills |
| GET, POST | /api/candidates | 查询、创建候选人 / List and create candidates |
| GET, PUT, DELETE | /api/candidates/{id} | 查询、更新、删除候选人 / Read, update and delete candidates |

api-client.js 统一使用 LIONS_API_BASE_URL 或默认本机 API 地址。当前前端仅在登录后尝试读取非空 candidates 列表；成功时替换展示候选人，API 失败或返回空数组时保留 Mock。users、skills、候选人写操作和登录尚未从 UI 接入。

## 10. 中英文系统 / Bilingual System

系统支持中文和 English。语言切换入口位于登录页、工作台右上角、公开介绍页；偏好保存于 lions-language。i18n.js 使用词典、模式匹配和 MutationObserver 翻译动态插入内容，刷新后保持偏好。

固定 UI 与多数动态候选人、Offer、资料文案已覆盖。姓名、学校、技术品牌（Python、SQL、GitHub、FastAPI、SQLite）、用户输入的岗位/项目/Offer 文本及外部数据会保留原文；自由动态文本不保证自动语义翻译。

## 11. 主要数据流 / Main Data Flows

### 学生发布证据 / Student Evidence Publishing

1. 创建或登录本地账户。  
2. 添加公开项目、上传简历、选择分析。  
3. GitHub 分析读取公开元数据；DeepSeek 仅在本地配置密钥时使用，否则本地回退。  
4. 编辑分析和可见性。  
5. 发布人才档案到 lions-submissions。  
6. 评审员人才库显示该档案。  

### 评审与简历访问 / Review and Resume Access

1. 评审员在人才库打开候选人。  
2. 对学生原始简历发起申请。  
3. 学生接受或拒绝。  
4. 接受后才可从当前浏览器 IndexedDB 下载原始文件。  

### Offer 流 / Offer Flow

1. 评审员填写并发布 Offer。  
2. Offer 保存至 lions-offers。  
3. 学生推荐区和 Offers 页面读取有效 Offer。  
4. 表达兴趣仅显示提示，不记录正式申请。  

## 12. 实现状态与已知问题 / Status and Known Issues

| 功能域 / Area | 状态 / Status | 实际来源 / Actual source |
|---|---|---|
| 登录与角色 | 已实现本地原型 | 加密 localStorage、sessionStorage |
| 公开介绍与定价 | 已实现静态页 | HTML、图片 |
| 概览、搜索、Rubric | 部分实现 | Mock、localStorage |
| 人才库与 shortlist | 部分实现 | Mock、本地提交、可选 candidates API |
| SQLite candidates API | 已实现 | FastAPI、SQLAlchemy、SQLite |
| 学生证据与资料 | 部分实现 | localStorage、IndexedDB、可选外部 API |
| DeepSeek 分析 | 部分实现 | 本地代理；需密钥；有回退 |
| 测评与 Offer | 本地 UI/Mock | localStorage |
| 管理平台 | 本地管理 UI | localStorage |

已知问题：认证与后端 users 表尚未连接；工作台 URL 不是完整深链接恢复系统；Offer、测评、申请、shortlist、资料和证据多数仅在同一浏览器保存；表达兴趣不形成投递记录；GitHub 连接不是 OAuth；公开页定价无支付；自由用户文本无法保证完整双语翻译。

## 13. 页面完整性对照 / Page Coverage Checklist

| 代码视图 / Code view | 本文位置 |
|---|---|
| authScreen 登录与注册 | 第 4 节 |
| lions-web 公开介绍页 | 第 5 节 |
| employerView 概览 | 第 6 节概览 |
| shortlistNav 候选清单 | 第 6 节候选清单 |
| talentView 人才库 | 第 6 节人才库 |
| assessmentView 测评 | 第 6 节测评 |
| Send Offer 弹窗 | 第 6 节发布 Offer |
| studentView 提交证据 | 第 7 节提交证据 |
| offersView 学生 Offer | 第 7 节 Offer |
| profileView 个人资料 | 第 7、8 节个人资料 |
| 学生申请请求子流程 | 第 7 节申请请求 |
| adminView 管理平台 | 第 8 节 |
| 候选人详情与公开资料弹窗 | 第 6、7 节 |
