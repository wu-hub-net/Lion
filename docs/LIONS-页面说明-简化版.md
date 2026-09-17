# LIONS 全站页面与功能说明（简化版）

LIONS Evidence Workspace 是一个中英双语的校园人才证据工作台原型。学生发布项目与简历证据，评审员搜索和评估候选人、发布 Offer，管理员查看本地市场管理信息。

LIONS is a bilingual campus talent evidence workspace prototype for student evidence, reviewer evaluation, Offers, and local administration.

## 页面一览 / Page List

| 中文页面 | English view | 用途 / Purpose | 当前状态 / Current status |
|---|---|---|---|
| 登录与创建账户 | Login / Create Account | 选择角色并进入工作台 | 本地认证与会话 |
| 公开介绍页 | Public Launch Page | 产品介绍、方案与定价 | 静态公开页，无支付 |
| 概览 | Overview | 搜索、候选排名、Rubric、动态摘要 | Mock 与本地状态 |
| 候选清单 | Shortlists | 浏览已保存候选人 | 人才库的保存筛选模式 |
| 人才库 | Talent Pool | 搜索候选人与查看证据 | Mock、本地提交、可选 API |
| 测评 | Assessments | 管理本地测评任务 | localStorage 原型 |
| 发布 Offer | Send Offer | 评审员发布岗位机会 | 页面内弹窗，localStorage |
| 提交证据 | Submit Evidence | 学生维护项目、简历和档案 | localStorage 与 IndexedDB |
| Offer | Offers | 学生查看推荐和全部 Offer | 读取本地 Offer |
| 个人资料 | Personal Profile | 维护角色资料与可见性 | 本地存储 |
| 管理平台 | Admin Platform | 查看统计与维护筛选项 | 本地管理 UI |

候选人详情、公开资料和简历申请是上述视图中的弹窗或子流程，不是独立页面。

## 主要使用流程 / Main User Flows

**学生 / Student**：登录后进入提交证据，维护项目和简历资料，发布人才档案；在 Offers 页面查看推荐机会。

**评审员 / Reviewer**：在概览或人才库搜索候选人，查看证据、保存到 Shortlists、请求简历，并可发布 Offer。

**Offer**：评审员发布的 Offer 存在当前浏览器，学生推荐区和 Offers 页面读取同一数据。“表达兴趣”目前只显示提示，不会创建正式申请。

**管理员 / Administrator**：进入管理平台查看本地统计与市场筛选内容。

## 数据与后端 / Data and Backend

- 登录、资料、Offer、测评、Shortlist、申请及多数学生提交使用浏览器 `localStorage`；登录会话使用 `sessionStorage`。
- 原始简历文件存放在浏览器 IndexedDB，不是服务器文件库。
- 项目有 FastAPI + SQLite 后端，提供 users、skills、candidates、candidate_skills 的 CRUD API。
- 前端当前只会尝试读取 `GET /api/candidates`；当 API 不可用或返回空数据时，继续使用 Mock fallback。
- 登录、Offer、资料、测评、申请及候选人写入尚未接到后端，因此不是多用户实时数据库功能。

## 中英文 / Chinese and English

登录页、工作台和公开介绍页均可切换中文/English，选择会保存在 `lions-language`，刷新后保持。固定 UI 与多数已接入动态文案会翻译；姓名、学校、技术名词、用户输入和外部内容通常保留原文。

## 已知限制 / Known Limitations

- 前端本地认证与后端 users API 尚未打通。
- 多数业务数据只保存在当前浏览器。
- Pricing 没有支付流程；GitHub 不是 OAuth；DeepSeek 需本地密钥，失败时使用回退结果。
- 工作台路由由本地入口与前端状态切换，非完整服务端多页面系统。
