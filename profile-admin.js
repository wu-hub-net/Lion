(function () {
  'use strict';

  const ADMIN_CODE_HASH = '56a7633d755b5d24a72548f89c0737d392a9b19d9411dc371e8d060f19fb3a54';
  const ACCOUNT_KEY = 'lions-accounts-v2';
  const FILTER_KEY = 'lions-market-filters';
  const SESSION_KEY = 'lions-session-v2';
  const REQUEST_KEY = 'lions-application-requests';
  const RUBRIC_KEY = 'lions-rubric-weights-v2';
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let activeVaultKey = null;
  let activeResumeMeta = null;
  let activeResumeAnalysis = null;
  let activeProjectAnalyses = {};

  const rubricRules = [
    { label: 'Python fluency', terms: ['python', 'django', 'flask', 'fastapi', 'pandas', 'numpy', 'scikit', 'langchain', 'langgraph'] },
    { label: 'Data analysis', terms: ['data', 'analytics', 'analysis', 'sql', 'etl', 'tableau', 'power bi', 'excel', 'rag', 'milvus', 'database', '数据', '分析', '检索', '向量库', '数据库'] },
    { label: 'Statistics', terms: ['statistics', 'statistical', 'a/b', 'experiment', 'hypothesis', 'regression', 'forecast', 'evaluation', 'metric', '统计', '实验', '回归', '预测', '评测', '评分', '指标', '数据集', '模型'] },
    { label: 'Communication', terms: ['communication', 'documentation', 'documented', 'readme', 'report', 'presentation', 'visualisation', 'visualization', 'decision log', 'ui', 'vue', 'frontend', '文档', '报告', '沟通', '展示', '前端', '界面', '管理平台'] },
  ];

  const projectTagRules = [
    ['Python', ['python', 'django', 'flask', 'fastapi']], ['JavaScript', ['javascript', 'node.js', 'nodejs']],
    ['TypeScript', ['typescript']], ['Vue', ['vue', 'vue3']], ['React', ['react']], ['SQL', ['sql', 'mysql', 'postgres']],
    ['Data analysis', ['data', 'analytics', 'pandas', 'tableau']], ['Machine learning', ['machine learning', 'ml', 'scikit', 'pytorch', 'tensorflow']],
    ['RAG', ['rag', 'retrieval augmented']], ['MCP', ['mcp']], ['Docker', ['docker', 'container']],
    ['LangGraph', ['langgraph']], ['Milvus', ['milvus']], ['Electron', ['electron']], ['Vector database', ['vector database', '向量库']],
    ['API development', ['api', 'backend', 'fastapi', 'flask']], ['Testing', ['test', 'testing', 'pytest', 'evaluation']],
    ['Documentation', ['documentation', 'readme', 'docs']],
  ];

  const defaultFilters = {
    skills: ['Python', 'SQL', 'Statistics', 'Data analysis', 'R', 'APIs', 'Docker'],
    fields: ['Data analyst', 'Computer science', 'Applied math', 'Statistics', 'Student candidate'],
    schools: ['University of Toronto', 'NTU', 'HKUST', 'CityU'],
    years: ['2026', '2027', '2028', '2029'],
    availability: ['Open to opportunities', 'Available part-time', 'Available for projects', 'Not currently available'],
  };

  const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[char]));

  const uniqueText = (items) => [...new Set((items || []).map((item) => String(item || '').trim()).filter(Boolean))];

  function candidateEvidenceSources(candidate) {
    const resumeTags = uniqueText(candidate.resumeTags || candidate.resumeAnalysis?.abilities || []);
    const resumeSet = new Set(resumeTags.map((tag) => tag.toLowerCase()));
    const storedProjectTags = candidate.projectTags || candidate.projectAnalysis?.tags || [];
    const fallbackProjectTags = (candidate.proofs || []).filter((tag) => !resumeSet.has(String(tag).toLowerCase()));
    const projectTags = uniqueText(storedProjectTags.length ? storedProjectTags : fallbackProjectTags);
    const resumeCorpus = [
      ...resumeTags,
      candidate.resumeAnalysis?.summary,
      ...(candidate.resumeAnalysis?.education || []),
      ...(candidate.resumeAnalysis?.experience || []),
    ].filter(Boolean).join(' ').toLowerCase();
    const projectCorpus = [
      ...projectTags,
      ...(candidate.evidence || []).flat(),
      ...(candidate.projectAnalysis?.items || []).flatMap((item) => [item.summary, ...(item.tags || [])]),
    ].filter(Boolean).join(' ').toLowerCase();
    return { resumeTags, projectTags, resumeCorpus, projectCorpus };
  }

  function matchedTerms(corpus, terms) {
    return terms.filter((term) => {
      if (!/^[a-z0-9+#.]{1,3}$/i.test(term)) return corpus.includes(term);
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(corpus);
    });
  }

  function evaluateCandidate(candidate) {
    const sources = candidateEvidenceSources(candidate);
    const rubricScores = rubricRules.map((rule) => {
      const projectMatches = matchedTerms(sources.projectCorpus, rule.terms);
      const resumeMatches = matchedTerms(sources.resumeCorpus, rule.terms);
      const projectScore = projectMatches.length ? Math.min(70, 40 + (projectMatches.length - 1) * 10 + Math.min(sources.projectTags.length * 2, 10)) : 0;
      const resumeScore = resumeMatches.length ? Math.min(30, 15 + (resumeMatches.length - 1) * 5) : 0;
      return { label: rule.label, score: Math.min(100, projectScore + resumeScore), projectMatches, resumeMatches };
    });
    const totalWeight = currentWeights.reduce((sum, value) => sum + value, 0) || 1;
    const score = Math.round(rubricScores.reduce((sum, item, index) => sum + item.score * currentWeights[index], 0) / totalWeight);
    const coveredCriteria = rubricScores.filter((item) => item.score > 0).length;
    return {
      ...candidate,
      ...sources,
      score,
      coverage: Math.round(coveredCriteria / rubricScores.length * 100),
      skills: rubricScores.map((item) => item.score),
      rubricScores,
    };
  }

  const baseAllCandidates = allCandidates;
  allCandidates = function () {
    return baseAllCandidates().map(evaluateCandidate);
  };

  updateScores = function () {
    renderCandidates();
    renderTalentPool();
  };

  renderRubric = function () {
    const total = currentWeights.reduce((sum, value) => sum + value, 0);
    document.getElementById('rubricList').innerHTML = `<div class="rubric-method"><div><strong>Evidence-based match</strong><p>For each criterion: GitHub term matches score up to 70; resume term matches score up to 30. The final match is the weighted average below.</p></div><span id="rubricWeightTotal" class="${total === 100 ? '' : 'warning'}">${total}% total</span></div>${rubric.map((item, index) => `<div class="rubric-row"><div class="rubric-label"><span>${esc(item[0])}</span><output id="out${index}">${currentWeights[index]}%</output></div><input type="range" min="0" max="60" value="${currentWeights[index]}" data-out="out${index}" data-index="${index}"><div class="rubric-hint"><span>${esc(item[2])}</span><span>ranking weight</span></div></div>`).join('')}`;
    document.querySelectorAll('#rubricList input').forEach((input) => input.addEventListener('input', () => {
      currentWeights[Number(input.dataset.index)] = Number(input.value);
      document.getElementById(input.dataset.out).value = `${input.value}%`;
      const nextTotal = currentWeights.reduce((sum, value) => sum + value, 0);
      const totalElement = document.getElementById('rubricWeightTotal');
      totalElement.textContent = `${nextTotal}% total`;
      totalElement.classList.toggle('warning', nextTotal !== 100);
      updateScores();
    }));
  };

  function bytesToBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    return btoa(binary);
  }

  function base64ToBytes(value) {
    const binary = atob(value);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  }

  async function sha256(value) {
    const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  async function deriveCredentials(password, saltBytes) {
    const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = new Uint8Array(await crypto.subtle.deriveBits({
      name: 'PBKDF2', salt: saltBytes, iterations: 210000, hash: 'SHA-256',
    }, material, 512));
    const verifier = bytesToBase64(bits.slice(0, 32));
    const key = await crypto.subtle.importKey('raw', bits.slice(32), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    return { verifier, key };
  }

  async function encryptProfile(profile, key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(profile)));
    return { iv: bytesToBase64(iv), cipher: bytesToBase64(new Uint8Array(cipher)) };
  }

  async function decryptProfile(account, key) {
    const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(account.iv) }, key, base64ToBytes(account.cipher));
    return JSON.parse(decoder.decode(clear));
  }

  function getAccounts() {
    return JSON.parse(localStorage.getItem(ACCOUNT_KEY) || '[]');
  }

  function saveAccounts(accounts) {
    localStorage.setItem(ACCOUNT_KEY, JSON.stringify(accounts));
  }

  async function createSecureAccount({ email, password, role, name, org, profile: suppliedProfile }) {
    const normalizedEmail = email.trim().toLowerCase();
    const id = await sha256(normalizedEmail);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const { verifier, key } = await deriveCredentials(password, salt);
    const profile = suppliedProfile || {
      loginEmail: normalizedEmail,
      name: name.trim(),
      org: org.trim() || (role === 'student' ? 'Student workspace' : role === 'admin' ? 'LIONS administration' : 'Teacher workspace'),
      phone: '', contactEmail: normalizedEmail, channel: '', github: '', avatar: '',
      school: role === 'student' ? org.trim() : '', graduationYear: '',
      availability: 'Open to opportunities',
      sharing: { phone: false, email: false, channel: false, github: true, photo: true, org: true, graduation: true, availability: true },
    };
    const encrypted = await encryptProfile(profile, key);
    return {
      account: { id, role, salt: bytesToBase64(salt), verifier, ...encrypted, version: 2 },
      key, profile,
    };
  }

  function openFileDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('lions-private-files', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('resumes');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function putResume(id, file) {
    const db = await openFileDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('resumes', 'readwrite');
      tx.objectStore('resumes').put(file, id);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }

  async function getResume(id) {
    const db = await openFileDb();
    return new Promise((resolve, reject) => {
      const request = db.transaction('resumes').objectStore('resumes').get(id);
      request.onsuccess = () => { db.close(); resolve(request.result); };
      request.onerror = () => { db.close(); reject(request.error); };
    });
  }

  function dataUrlToBlob(dataUrl, type) {
    const binary = atob(dataUrl.split(',')[1]);
    return new Blob([Uint8Array.from(binary, (char) => char.charCodeAt(0))], { type });
  }

  async function migrateLegacyData() {
    const legacy = JSON.parse(localStorage.getItem('lions-accounts') || '[]');
    const accounts = getAccounts();
    const known = new Set(accounts.map((account) => account.id));
    for (const old of legacy) {
      const id = await sha256(String(old.email || '').toLowerCase());
      if (!known.has(id) && old.email && old.password) {
        const secured = await createSecureAccount({
          email: old.email, password: old.password, role: old.role || 'student', name: old.name || 'LIONS User', org: old.org || '',
        });
        accounts.push(secured.account);
        known.add(id);
        const oldProjects = localStorage.getItem(`lions-${old.email}-projects`);
        if (oldProjects) localStorage.setItem(`lions-${id}-projects`, oldProjects);
        const oldResume = JSON.parse(localStorage.getItem(`lions-${old.email}-resume`) || 'null');
        if (oldResume?.data) {
          const resumeId = `resume:${id}`;
          await putResume(resumeId, new File([dataUrlToBlob(oldResume.data, oldResume.type)], oldResume.name, { type: oldResume.type }));
          localStorage.setItem(`lions-${id}-resume-meta`, JSON.stringify({ name: oldResume.name, size: oldResume.size, type: oldResume.type, resumeId }));
        }
      }
    }
    if (legacy.length) {
      saveAccounts(accounts);
      localStorage.removeItem('lions-accounts');
    }

    const submissions = JSON.parse(localStorage.getItem('lions-submissions') || '[]');
    let changed = false;
    for (const submission of submissions) {
      if (submission.ownerEmail && !submission.ownerId) {
        submission.ownerId = await sha256(submission.ownerEmail.toLowerCase());
        delete submission.ownerEmail;
        changed = true;
      }
      if (submission.resume?.data) {
        const resumeId = `resume:${submission.ownerId || submission.id}`;
        const file = new File([dataUrlToBlob(submission.resume.data, submission.resume.type)], submission.resume.name, { type: submission.resume.type });
        await putResume(resumeId, file);
        submission.resume = { name: file.name, size: file.size, type: file.type, resumeId };
        changed = true;
      }
    }
    if (changed) localStorage.setItem('lions-submissions', JSON.stringify(submissions));
    localStorage.removeItem('lions-session');
  }

  function initials(name) {
    return String(name || 'LIONS User').split(/\s+/).filter(Boolean).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  }

  function showAvatar(element, profile) {
    element.textContent = initials(profile.name);
    element.classList.toggle('avatar-img', Boolean(profile.avatar));
    element.style.backgroundImage = profile.avatar ? `url("${profile.avatar}")` : '';
  }

  function getFilters() {
    const saved = JSON.parse(localStorage.getItem(FILTER_KEY) || 'null');
    return Object.fromEntries(Object.entries(defaultFilters).map(([key, values]) => [
      key,
      [...new Set(Array.isArray(saved?.[key]) ? saved[key] : values)],
    ]));
  }

  function saveFilters(filters) {
    localStorage.setItem(FILTER_KEY, JSON.stringify(filters));
  }

  function refreshFilterSelects() {
    const filters = getFilters();
    const mappings = [
      ['skillFilter', 'skills', 'All skills'], ['fieldFilter', 'fields', 'All fields'],
      ['schoolFilter', 'schools', 'All schools'], ['yearFilter', 'years', 'All graduation years'],
      ['availabilityFilter', 'availability', 'Any availability'],
    ];
    mappings.forEach(([id, key, label]) => {
      const select = document.getElementById(id);
      const selected = select.value;
      select.innerHTML = `<option value="">${label}</option>${filters[key].map((value) => `<option>${esc(value)}</option>`).join('')}`;
      if ([...select.options].some((option) => option.value === selected)) select.value = selected;
    });
  }

  const originalUserStorageKey = userStorageKey;
  userStorageKey = (suffix) => `lions-${currentUser?.id || currentUser?.email || 'guest'}-${suffix}`;

  const originalShowWorkspace = showWorkspace;
  showWorkspace = function (type) {
    if (currentUser?.role === 'admin' && !['admin', 'talent', 'profile'].includes(type)) type = 'admin';
    if (currentUser?.role === 'teacher' && type === 'admin') type = 'overview';
    const profileView = document.getElementById('profileView');
    document.getElementById('adminView').classList.remove('active');
    profileView.classList.remove('active');
    if (type === 'profile') {
      employerView.style.display = 'none';
      studentView.classList.remove('active');
      talentView.classList.remove('active');
      assessmentView.classList.remove('active');
      profileView.classList.add('active');
      navItems.forEach((item) => item.classList.remove('active'));
      document.getElementById('profileNav').classList.add('active');
      document.querySelectorAll('.mobile-nav button').forEach((button) => button.classList.toggle('active', button.id === 'mobileProfile'));
      populateProfile();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (type === 'admin') {
      employerView.style.display = 'none';
      studentView.classList.remove('active');
      talentView.classList.remove('active');
      assessmentView.classList.remove('active');
      document.getElementById('adminView').classList.add('active');
      navItems.forEach((item) => item.classList.remove('active'));
      document.getElementById('adminNav').classList.add('active');
      renderAdmin();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    originalShowWorkspace(type);
    if (type === 'student') renderStudentRequests();
  };

  function populateProfile() {
    if (!currentUser) return;
    const isStudent = currentUser.role === 'student';
    const fields = {
      profileName: currentUser.name, profilePhone: currentUser.phone,
      profileEmail: currentUser.contactEmail || currentUser.loginEmail,
      profileChannel: currentUser.channel, profileGithub: currentUser.github,
      profileSchool: currentUser.school || currentUser.org,
      profileYear: currentUser.graduationYear, profileAvailability: currentUser.availability,
    };
    Object.entries(fields).forEach(([id, value]) => { document.getElementById(id).value = value || ''; });
    const sharing = { phone: false, email: false, channel: false, github: true, photo: true, org: true, graduation: true, availability: true, ...(currentUser.sharing || {}) };
    ['Photo', 'Org', 'Graduation', 'Availability', 'Phone', 'Email', 'Channel', 'Github'].forEach((key) => { document.getElementById(`share${key}`).checked = Boolean(sharing[key.toLowerCase()]); });
    document.querySelectorAll('.student-profile-field').forEach((field) => field.classList.toggle('hidden', !isStudent));
    document.querySelectorAll('.student-visibility-option').forEach((field) => field.classList.toggle('hidden', !isStudent));
    document.getElementById('profileVisibilityLegend').textContent = isStudent
      ? 'Shown on your talent profile'
      : currentUser.role === 'teacher' ? 'Shown to students who receive your requests' : 'Public profile visibility';
    document.getElementById('profileEyebrow').innerHTML = `${isStudent ? 'STUDENT' : currentUser.role === 'teacher' ? 'TEACHER' : 'ADMINISTRATOR'} ACCOUNT <span>/</span> PERSONAL PROFILE`;
    document.getElementById('profileTitle').textContent = `${currentUser.name || 'Your'} profile`;
    document.getElementById('profileLead').textContent = isStudent
      ? 'Manage your identity and decide which contact details verified teachers can see.'
      : 'Keep your professional identity up to date and choose what other users can see.';
    document.getElementById('profilePrivacyCopy').textContent = isStudent
      ? 'Contact details stay private unless you choose to share them.'
      : 'Private fields remain encrypted; only the options selected below are shared.';
    document.getElementById('profileOrgLabel').textContent = isStudent ? 'School' : 'School / organisation';
    showAvatar(document.getElementById('profileAvatar'), currentUser);
    showAvatar(document.getElementById('userAvatar'), currentUser);
    if (isStudent) {
      showAvatar(document.querySelector('.preview-avatar'), { ...currentUser, avatar: sharing.photo ? currentUser.avatar : '' });
      document.querySelector('.preview-person strong').textContent = currentUser.name;
      const savedMeta = JSON.parse(localStorage.getItem(`lions-${currentUser.id}-resume-meta`) || 'null');
      activeResumeMeta = savedMeta;
      resumeFile = savedMeta;
      renderResume();
      activeResumeAnalysis = JSON.parse(localStorage.getItem(`lions-${currentUser.id}-resume-analysis`) || 'null');
      if (activeResumeAnalysis) renderResumeAnalysis(activeResumeAnalysis);
      renderStudentRequests();
    }
  }

  function buildPublicProfile(profile) {
    const sharing = { phone: false, email: false, channel: false, github: true, photo: true, org: true, graduation: true, availability: true, ...(profile.sharing || {}) };
    const contact = {};
    if (sharing.phone && profile.phone) contact.phone = profile.phone;
    if (sharing.email && profile.contactEmail) contact.email = profile.contactEmail;
    if (sharing.channel && profile.channel) contact.channel = profile.channel;
    if (sharing.github && profile.github) contact.github = profile.github;
    return {
      name: profile.name,
      role: profile.role,
      avatar: sharing.photo ? profile.avatar || '' : '',
      org: sharing.org ? profile.school || profile.org || '' : '',
      graduationYear: sharing.graduation ? profile.graduationYear || '' : '',
      availability: sharing.availability ? profile.availability || '' : '',
      contact,
    };
  }

  function syncPublishedProfile() {
    const shared = buildPublicProfile(currentUser);
    if (currentUser.role === 'student') {
      const submissions = JSON.parse(localStorage.getItem('lions-submissions') || '[]');
      let changed = false;
      submissions.forEach((submission) => {
        if (submission.ownerId !== currentUser.id) return;
        Object.assign(submission, {
          name: shared.name,
          initials: initials(shared.name),
          avatar: shared.avatar,
          school: shared.org,
          detail: shared.org || 'Student candidate',
          graduationYear: shared.graduationYear,
          availability: shared.availability,
          contact: shared.contact,
        });
        changed = true;
      });
      if (changed) localStorage.setItem('lions-submissions', JSON.stringify(submissions));
    }
    if (currentUser.role === 'teacher') {
      const requests = getApplicationRequests();
      let changed = false;
      requests.forEach((request) => {
        if (request.teacherId !== currentUser.id) return;
        request.teacherName = shared.name;
        request.teacherOrg = shared.org;
        request.teacherProfile = shared;
        changed = true;
      });
      if (changed) saveApplicationRequests(requests);
    }
  }

  function projectAnalysisStorageKey(userId = currentUser?.id) {
    return `lions-${userId || 'guest'}-project-analyses`;
  }

  function projectTagsFromText(text) {
    const corpus = String(text || '').toLowerCase();
    return uniqueText(projectTagRules.filter(([, terms]) => terms.some((term) => corpus.includes(term))).map(([tag]) => tag));
  }

  async function analyzeProject(project) {
    const match = String(project).match(/(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/#?\s]+)/i);
    if (!match) {
      const tags = projectTagsFromText(project);
      return { source: 'link', summary: 'Project link added; repository metadata is unavailable.', tags };
    }
    const owner = match[1];
    const repository = match[2].replace(/\.git$/i, '');
    try {
      const apiRoot = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`;
      const request = (suffix = '') => fetch(`${apiRoot}${suffix}`, { headers: { Accept: 'application/vnd.github+json' } });
      const [response, languagesResponse, readmeResponse] = await Promise.all([request(), request('/languages'), request('/readme')]);
      if (!response.ok) throw new Error('GitHub metadata unavailable');
      const metadata = await response.json();
      const languages = languagesResponse.ok ? Object.keys(await languagesResponse.json()) : [];
      let readme = '';
      if (readmeResponse.ok) {
        const payload = await readmeResponse.json();
        if (payload.content) readme = decoder.decode(base64ToBytes(payload.content.replace(/\s/g, ''))).slice(0, 12000);
      }
      const corpus = [metadata.name, metadata.description, metadata.language, ...languages, ...(metadata.topics || []), readme].filter(Boolean).join(' ');
      const tags = uniqueText([...languages.slice(0, 4), metadata.language, ...projectTagsFromText(corpus), ...(metadata.topics || []).slice(0, 4)]).slice(0, 10);
      return {
        source: 'github',
        summary: metadata.description || `${metadata.name} public repository`,
        tags,
        stars: Number(metadata.stargazers_count || 0),
        updatedAt: metadata.pushed_at || metadata.updated_at || '',
      };
    } catch (error) {
      return { source: 'link', summary: 'Public repository metadata could not be loaded.', tags: projectTagsFromText(`${owner} ${repository}`) };
    }
  }

  function currentProjectTags() {
    return uniqueText(projects.flatMap((project) => activeProjectAnalyses[project]?.tags || []));
  }

  function updateStudentPreviewScore() {
    const projectTags = currentProjectTags();
    const draft = evaluateCandidate({
      resumeAnalysis: activeResumeAnalysis,
      projectAnalysis: { tags: projectTags, items: Object.values(activeProjectAnalyses) },
      projectTags,
      evidence: projects.map((project) => ['', '', project]),
    });
    document.getElementById('previewProjectTags').innerHTML = projectTags.map((tag) => `<span>${esc(tag)}</span>`).join('');
    document.querySelector('.preview-score').textContent = draft.resumeTags.length || draft.projectTags.length ? draft.score : '--';
  }

  renderProjects = function () {
    const container = document.getElementById('projectList');
    container.innerHTML = projects.length ? projects.map((project, index) => {
      const analysis = activeProjectAnalyses[project];
      const tags = analysis?.tags || [];
      const status = analysis?.pending ? 'Analyzing public repository...' : analysis?.summary || 'Project link ready for analysis.';
      return `<div class="project-item"><span>G</span><div class="project-copy"><strong>${esc(project)}</strong><small>${esc(status)}</small>${tags.length ? `<div class="project-tags">${tags.map((tag) => `<span>${esc(tag)}</span>`).join('')}</div>` : ''}</div><button data-remove="${index}" aria-label="Remove project">x</button></div>`;
    }).join('') : '<div class="project-empty">Add a project to show the work behind your skills.</div>';
    document.getElementById('coverageStat').textContent = `${projects.length} project${projects.length === 1 ? '' : 's'}`;
    if (currentUser) {
      localStorage.setItem(userStorageKey('projects'), JSON.stringify(projects));
      localStorage.setItem(projectAnalysisStorageKey(), JSON.stringify(activeProjectAnalyses));
    }
    container.querySelectorAll('[data-remove]').forEach((button) => button.addEventListener('click', () => {
      const removed = projects.splice(Number(button.dataset.remove), 1)[0];
      delete activeProjectAnalyses[removed];
      renderProjects();
    }));
    updateStudentPreviewScore();
  };

  function collectProfile() {
    return {
      ...currentUser,
      name: document.getElementById('profileName').value.trim() || currentUser.name,
      phone: document.getElementById('profilePhone').value.trim(),
      contactEmail: document.getElementById('profileEmail').value.trim(),
      channel: document.getElementById('profileChannel').value.trim(),
      github: document.getElementById('profileGithub').value.trim(),
      school: document.getElementById('profileSchool').value.trim(),
      org: document.getElementById('profileSchool').value.trim() || currentUser.org,
      graduationYear: document.getElementById('profileYear').value.trim(),
      availability: document.getElementById('profileAvailability').value,
      sharing: {
        photo: document.getElementById('sharePhoto').checked,
        org: document.getElementById('shareOrg').checked,
        graduation: document.getElementById('shareGraduation').checked,
        availability: document.getElementById('shareAvailability').checked,
        phone: document.getElementById('sharePhone').checked,
        email: document.getElementById('shareEmail').checked,
        channel: document.getElementById('shareChannel').checked,
        github: document.getElementById('shareGithub').checked,
      },
    };
  }

  async function saveCurrentProfile(silent = false) {
    if (!activeVaultKey || !currentUser?.id) {
      toast('Please log in again before saving private information');
      return false;
    }
    currentUser = collectProfile();
    const accounts = getAccounts();
    const account = accounts.find((item) => item.id === currentUser.id);
    if (!account) return false;
    Object.assign(account, await encryptProfile(currentUser, activeVaultKey));
    saveAccounts(accounts);
    document.getElementById('userName').textContent = currentUser.name;
    document.getElementById('userOrg').textContent = currentUser.school || currentUser.org;
    showAvatar(document.getElementById('userAvatar'), currentUser);
    const shared = buildPublicProfile(currentUser);
    showAvatar(document.querySelector('.preview-avatar'), { ...currentUser, avatar: shared.avatar });
    document.querySelector('.preview-person strong').textContent = currentUser.name;
    syncPublishedProfile();
    if (!silent) toast('Private profile saved and encrypted');
    return true;
  }

  const originalApplyRole = applyRole;
  applyRole = function (user) {
    activeProjectAnalyses = JSON.parse(localStorage.getItem(projectAnalysisStorageKey(user.id)) || '{}');
    originalApplyRole(user);
    const isStudent = user.role === 'student';
    const isTeacher = user.role === 'teacher';
    const isAdmin = user.role === 'admin';
    const overviewNav = navItems[0];
    overviewNav.classList.toggle('hidden', !isTeacher);
    document.getElementById('shortlistNav').classList.toggle('hidden', !isTeacher);
    document.getElementById('assessmentNav').classList.toggle('hidden', !isTeacher);
    document.getElementById('talentNav').classList.toggle('hidden', isStudent);
    document.getElementById('studentNav').classList.toggle('hidden', !isStudent);
    document.getElementById('adminNav').classList.toggle('hidden', !isAdmin);
    document.getElementById('mobileOverview').classList.toggle('hidden', !isTeacher);
    document.getElementById('mobileTalent').classList.toggle('hidden', isStudent);
    document.getElementById('mobileSubmit').classList.toggle('hidden', !isStudent);
    document.getElementById('mobileAdmin').classList.toggle('hidden', !isAdmin);
    document.getElementById('profileNav').classList.remove('hidden');
    document.getElementById('mobileProfile').classList.remove('hidden');
    populateProfile();
    syncPublishedProfile();
    if (isStudent) {
      const missing = projects.filter((project) => !activeProjectAnalyses[project] || activeProjectAnalyses[project].pending);
      if (missing.length) {
        missing.forEach((project) => { activeProjectAnalyses[project] = { pending: true, summary: 'Analyzing public repository...', tags: [] }; });
        renderProjects();
        Promise.all(missing.map(async (project) => {
          const analysis = await analyzeProject(project);
          if (projects.includes(project)) activeProjectAnalyses[project] = analysis;
        })).then(() => renderProjects());
      }
    }
    if (isAdmin) showWorkspace('admin');
    if (isTeacher) showWorkspace('overview');
  };

  setAuthMode = function (mode) {
    authMode = mode;
    document.querySelectorAll('.auth-tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.authMode === mode));
    document.getElementById('authNameWrap').classList.toggle('hidden', mode !== 'register');
    document.getElementById('authOrgWrap').classList.toggle('hidden', mode !== 'register');
    document.getElementById('authName').required = mode === 'register';
    document.getElementById('authSubmitLabel').textContent = mode === 'login' ? 'Log in' : 'Create account';
    document.getElementById('authHint').textContent = mode === 'login' ? 'Use your LIONS account to continue.' : 'Private account fields are encrypted on this device.';
    updateAdminCodeVisibility();
  };

  function updateAdminCodeVisibility() {
    const isAdmin = document.querySelector('input[name="authRole"]:checked')?.value === 'admin';
    const wrap = document.getElementById('authAdminCodeWrap');
    wrap.classList.toggle('hidden', authMode !== 'register' || !isAdmin);
    document.getElementById('authAdminCode').required = authMode === 'register' && isAdmin;
  }

  function replaceWithClone(id) {
    const old = document.getElementById(id);
    const replacement = old.cloneNode(true);
    old.replaceWith(replacement);
    return replacement;
  }

  async function handleAuth(event) {
    event.preventDefault();
    const email = document.getElementById('authEmail').value.trim().toLowerCase();
    const password = document.getElementById('authPassword').value;
    const role = document.querySelector('input[name="authRole"]:checked').value;
    const hint = document.getElementById('authHint');
    const id = await sha256(email);
    const accounts = getAccounts();
    if (authMode === 'register') {
      if (accounts.some((account) => account.id === id)) {
        hint.textContent = 'An account already exists for this email.';
        return;
      }
      if (role === 'admin' && await sha256(document.getElementById('authAdminCode').value) !== ADMIN_CODE_HASH) {
        hint.textContent = 'The administrator invite code is not valid.';
        return;
      }
      const secured = await createSecureAccount({
        email, password, role,
        name: document.getElementById('authName').value,
        org: document.getElementById('authOrg').value,
      });
      accounts.push(secured.account);
      saveAccounts(accounts);
      activeVaultKey = secured.key;
      currentUser = { ...secured.profile, id: secured.account.id, role };
      applyRole(currentUser);
      toast('Secure account created');
      return;
    }
    const account = accounts.find((item) => item.id === id && item.role === role);
    if (!account) {
      hint.textContent = 'Email, password or selected role does not match.';
      return;
    }
    try {
      const credentials = await deriveCredentials(password, base64ToBytes(account.salt));
      if (credentials.verifier !== account.verifier) throw new Error('Invalid password');
      const profile = await decryptProfile(account, credentials.key);
      activeVaultKey = credentials.key;
      currentUser = { ...profile, id: account.id, role: account.role };
      applyRole(currentUser);
    } catch (error) {
      hint.textContent = 'Email, password or selected role does not match.';
    }
  }

  renderResume = function () {
    const meta = activeResumeMeta || resumeFile;
    const drop = document.querySelector('.resume-drop');
    drop.classList.toggle('has-file', Boolean(meta));
    document.getElementById('resumeName').textContent = meta ? meta.name : 'Attach a PDF or Word resume';
    document.getElementById('resumeStatus').textContent = meta ? `${Math.ceil(meta.size / 1024)} KB · stored locally on this device` : '';
    const scanButton = document.getElementById('scanResume');
    scanButton.disabled = !meta;
    scanButton.textContent = 'Analyze resume';
  };

  async function parseResumeText(file) {
    const extension = file.name.split('.').pop().toLowerCase();
    if (extension === 'pdf') {
      const pdfjs = await import('./vendor/pdfjs/pdf.min.js');
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.min.js', location.href).href;
      const pdf = await pdfjs.getDocument({
        data: new Uint8Array(await file.arrayBuffer()),
        disableWorker: true,
        useWorkerFetch: false,
        isEvalSupported: false,
      }).promise;
      const pages = [];
      const nameHints = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const content = await (await pdf.getPage(pageNumber)).getTextContent();
        pages.push(content.items.map((item) => `${item.str}${item.hasEOL ? '\n' : ' '}`).join(''));
        content.items.forEach((item) => {
          const value = item.str.trim();
          if (value) nameHints.push({ value, size: Math.abs(item.transform?.[3] || 0), y: item.transform?.[5] || 0 });
        });
      }
      nameHints.sort((a, b) => b.size - a.size || b.y - a.y);
      return { text: pages.join('\n'), nameHints: nameHints.map((item) => item.value) };
    }
    if (extension === 'docx') {
      const text = (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value;
      return { text, nameHints: text.split(/[\r\n]+/).slice(0, 12) };
    }
    return { text: '', nameHints: [] };
  }

  function extractResumeFields(text, nameHints = []) {
    const normalized = text.replace(/\u00a0/g, ' ');
    const lines = normalized.split(/[\r\n]+/).map((line) => line.trim()).filter(Boolean);
    const email = normalized.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || '';
    const phone = normalized.match(/(?<!\d)(?:\+?86[\s-]?)?1[3-9](?:[\s-]?\d){9}(?!\d)/)?.[0]?.trim()
      || normalized.match(/(?<!\d)\+?\d[\d().-]{7,}\d(?!\d)/)?.[0]?.trim()
      || '';
    const github = normalized.match(/https?:\/\/(?:www\.)?github\.com\/[\w.-]+(?:\/[\w.-]+)?/i)?.[0] || normalized.match(/github\.com\/[\w.-]+(?:\/[\w.-]+)?/i)?.[0] || '';
    const blockedName = /^(基于|负责|参与|项目|教育|经历|技能|能力|工作|实习|个人|简历|求职|专业|学历|证书|在校|校园|联系方式|自我评价)$/;
    const labelledName = normalized.match(/(?:姓名|Name)\s*[:：]\s*([\u4e00-\u9fff]{2,4}|[A-Za-z][A-Za-z .'-]{1,40})/i)?.[1]?.trim() || '';
    const hintedName = nameHints.map((value) => value.trim()).find((value) => /^[\u4e00-\u9fff]{2,4}$/.test(value) && !blockedName.test(value)) || '';
    const lineName = lines.map((line) => line.match(/^([\u4e00-\u9fff]{2,4})(?=\s|$)/)?.[1]).find((value) => value && !blockedName.test(value)) || '';
    const englishName = lines.find((line) => /^[A-Za-z][A-Za-z .'-]{1,40}$/.test(line) && !/resume|curriculum/i.test(line)) || '';
    const name = labelledName || hintedName || lineName || englishName;
    const skillCatalog = ['Python', 'Java', 'JavaScript', 'TypeScript', 'C++', 'C#', 'SQL', 'R', 'React', 'Vue', 'Angular', 'Node.js', 'Django', 'Flask', 'Spring', 'Spring Boot', 'MySQL', 'Redis', 'Docker', 'Kubernetes', 'Git', 'Linux', 'Machine Learning', 'Data Analysis', 'Statistics', 'Tableau', 'Power BI', 'Excel', 'AWS', 'Azure', 'ResNet', 'MCP', '人工智能', '机器学习', '深度学习', '计算机视觉', '软件工程', '数据分析', '项目管理', '微服务', '后端开发', '前端开发'];
    const skills = skillCatalog.filter((skill) => new RegExp(`(^|[^a-z])${skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`, 'i').test(normalized));
    const education = lines.filter((line) => /大学|学院|本科|硕士|博士|education|bachelor|master/i.test(line) && line.length <= 180).slice(0, 4);
    const experience = lines.filter((line) => /项目|实习|工作|负责|开发|设计|构建|部署|比赛|竞赛|project|intern|experience/i.test(line) && line.length >= 6 && line.length <= 220).slice(0, 5);
    const degree = normalized.match(/博士|硕士|本科|大专|Ph\.?D|Master|Bachelor/i)?.[0] || '';
    const school = normalized.match(/[\u4e00-\u9fff]{2,20}(?:大学|学院)/)?.[0] || '';
    const summaryParts = [];
    if (school || degree) summaryParts.push(`${school}${degree ? ` ${degree}` : ''}`.trim());
    if (skills.length) summaryParts.push(`具备${skills.slice(0, 5).join('、')}等能力`);
    if (experience.length) summaryParts.push('有项目、实践或实习经历');
    const summary = summaryParts.length ? `${summaryParts.join('，')}。` : '已完成简历基础解析，建议检查并补充能力标签。';
    return {
      name, email, phone, github: github ? (github.startsWith('http') ? github : `https://${github}`) : '',
      summary, abilities: skills.slice(0, 8), education, experience, source: 'local',
    };
  }

  function renderResumeAnalysis(analysis) {
    if (!analysis) return;
    document.getElementById('resumeExtract').classList.remove('hidden');
    document.getElementById('extractName').value = analysis.name || '';
    document.getElementById('extractEmail').value = analysis.email || '';
    document.getElementById('extractPhone').value = analysis.phone || '';
    document.getElementById('extractGithub').value = analysis.github || '';
    document.getElementById('extractSummary').value = analysis.summary || '';
    document.getElementById('extractSkills').value = (analysis.abilities || []).join(', ');
    document.getElementById('extractEducation').value = (analysis.education || []).join('\n');
    document.getElementById('extractExperience').value = (analysis.experience || []).join('\n');
    document.getElementById('previewAnalysis').textContent = analysis.summary || 'Resume analysis available.';
    document.getElementById('previewAbilityTags').innerHTML = (analysis.abilities || []).slice(0, 6).map((ability) => `<span>${esc(ability)}</span>`).join('');
    updateStudentPreviewScore();
  }

  function collectResumeAnalysis() {
    return {
      name: document.getElementById('extractName').value.trim(),
      email: document.getElementById('extractEmail').value.trim(),
      phone: document.getElementById('extractPhone').value.trim(),
      github: document.getElementById('extractGithub').value.trim(),
      summary: document.getElementById('extractSummary').value.trim(),
      abilities: document.getElementById('extractSkills').value.split(',').map((item) => item.trim()).filter(Boolean).slice(0, 8),
      education: document.getElementById('extractEducation').value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean).slice(0, 6),
      experience: document.getElementById('extractExperience').value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean).slice(0, 6),
      source: activeResumeAnalysis?.source || 'local',
      updatedAt: new Date().toISOString(),
    };
  }

  function saveResumeAnalysis(silent = false) {
    if (!currentUser?.id) return;
    activeResumeAnalysis = collectResumeAnalysis();
    localStorage.setItem(`lions-${currentUser.id}-resume-analysis`, JSON.stringify(activeResumeAnalysis));
    renderResumeAnalysis(activeResumeAnalysis);
    if (!silent) toast('Resume analysis saved for the talent market');
  }

  async function requestDeepseekAnalysis(text, fallback) {
    try {
      const statusResponse = await fetch('/api/deepseek/status', { cache: 'no-store' });
      const status = statusResponse.ok ? await statusResponse.json() : { configured: false };
      if (!status.configured) return fallback;
      document.getElementById('extractStatus').textContent = 'Analyzing with DeepSeek...';
      const response = await fetch('/api/deepseek/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'DeepSeek analysis failed');
      return {
        ...fallback,
        ...result,
        name: result.name && !/^(基于|负责|项目|教育|经历)$/.test(result.name) ? result.name : fallback.name,
        abilities: Array.isArray(result.abilities) && result.abilities.length ? result.abilities : fallback.abilities,
        education: Array.isArray(result.education) ? result.education : fallback.education,
        experience: Array.isArray(result.experience) ? result.experience : fallback.experience,
        source: 'deepseek',
      };
    } catch (error) {
      toast(`${error.message}. Local analysis was kept.`);
      return fallback;
    }
  }

  async function showExtracted(file, useAi = false) {
    const panel = document.getElementById('resumeExtract');
    const status = document.getElementById('extractStatus');
    panel.classList.remove('hidden');
    status.textContent = 'Scanning locally...';
    try {
      const parsed = await parseResumeText(file);
      if (!parsed.text.trim()) {
        status.textContent = file.name.toLowerCase().endsWith('.doc') ? 'Legacy DOC cannot be scanned · use PDF or DOCX' : 'No selectable text found · use a text PDF or DOCX';
        return;
      }
      const localAnalysis = extractResumeFields(parsed.text, parsed.nameHints);
      activeResumeAnalysis = useAi ? await requestDeepseekAnalysis(parsed.text, localAnalysis) : localAnalysis;
      activeResumeAnalysis.updatedAt = new Date().toISOString();
      renderResumeAnalysis(activeResumeAnalysis);
      saveResumeAnalysis(true);
      status.textContent = activeResumeAnalysis.source === 'deepseek' ? 'DeepSeek analysis ready' : 'Local analysis ready';
    } catch (error) {
      const reason = error?.name === 'PasswordException' ? 'This PDF is password protected' : error?.name === 'InvalidPDFException' ? 'This PDF is damaged or invalid' : 'The local parser could not read this file';
      status.textContent = `${reason} · try DOCX or export the PDF again`;
      console.error('Local resume parsing failed', error);
    }
  }

  persistResume = async function (file) {
    const allowed = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    if (!allowed.includes(file.type) && !/\.(pdf|docx?)$/i.test(file.name)) {
      toast('Choose a PDF, DOC or DOCX file');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast('Resume must be 5 MB or smaller');
      return;
    }
    const resumeId = `resume:${currentUser.id}`;
    await putResume(resumeId, file);
    activeResumeMeta = { name: file.name, type: file.type, size: file.size, resumeId };
    resumeFile = activeResumeMeta;
    localStorage.setItem(`lions-${currentUser.id}-resume-meta`, JSON.stringify(activeResumeMeta));
    renderResume();
    await showExtracted(file);
    toast('Resume stored and scanned locally');
  };

  function avatarFromFile(file) {
    return new Promise((resolve, reject) => {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 1024 * 1024) {
        reject(new Error('Choose a JPG, PNG or WebP image under 1 MB'));
        return;
      }
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 256; canvas.height = 256;
        const context = canvas.getContext('2d');
        const side = Math.min(image.width, image.height);
        context.drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, 256, 256);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      image.onerror = () => reject(new Error('The image could not be read'));
      image.src = URL.createObjectURL(file);
    });
  }

  function decorateCandidate(candidate) {
    if (candidate.school) return candidate;
    const school = /University|NTU|HKUST|CityU/i.test(candidate.detail || '') ? candidate.detail : '';
    return {
      ...candidate,
      school,
      graduationYear: candidate.graduationYear || '',
      availability: candidate.ownerId ? (candidate.availability || '') : (candidate.availability || 'Open to opportunities'),
    };
  }

  getPoolFilters = function () {
    return {
      query: document.getElementById('talentSearch').value.trim().toLowerCase(),
      skill: document.getElementById('skillFilter').value.toLowerCase(),
      field: document.getElementById('fieldFilter').value.toLowerCase(),
      school: document.getElementById('schoolFilter').value.toLowerCase(),
      year: document.getElementById('yearFilter').value,
      availability: document.getElementById('availabilityFilter').value.toLowerCase(),
      sort: document.getElementById('poolSort').value,
    };
  };

  renderTalentPool = function () {
    if (!document.getElementById('talentList')) return;
    const filters = getPoolFilters();
    let results = allCandidates().map(decorateCandidate).filter((candidate) => {
      const analysis = candidate.resumeAnalysis || {};
      const haystack = [candidate.name, candidate.role, candidate.detail, candidate.bio, analysis.summary, ...(analysis.education || []), ...(analysis.experience || []), candidate.school, candidate.graduationYear, candidate.availability, ...(candidate.resumeTags || []), ...(candidate.projectTags || []), ...(candidate.evidence || []).flat()].join(' ').toLowerCase();
      return (!filters.query || haystack.includes(filters.query))
        && (!filters.skill || [...(candidate.resumeTags || []), ...(candidate.projectTags || [])].some((proof) => proof.toLowerCase().includes(filters.skill)))
        && (!filters.field || candidate.role.toLowerCase() === filters.field)
        && (!filters.school || candidate.school?.toLowerCase() === filters.school)
        && (!filters.year || String(candidate.graduationYear) === filters.year)
        && (!filters.availability || candidate.availability?.toLowerCase() === filters.availability)
        && (!shortlistOnly || shortlist.has(candidate.id));
    });
    results.sort((a, b) => filters.sort === 'recent' ? b.recent - a.recent : filters.sort === 'coverage' ? b.coverage - a.coverage : b.score - a.score);
    document.getElementById('poolResultCount').textContent = results.length;
    document.getElementById('talentList').innerHTML = results.length ? results.map((candidate) => {
      const avatarStyle = candidate.avatar ? `background-image:url('${esc(candidate.avatar)}')` : `background:${esc(candidate.color)}`;
      const resumeTags = candidate.resumeTags.length ? `<div class="talent-source-group"><small>RESUME</small><div>${candidate.resumeTags.slice(0, 4).map((tag) => `<span>${esc(tag)}</span>`).join('')}</div></div>` : '';
      const projectTags = candidate.projectTags.length ? `<div class="talent-source-group project"><small>GITHUB</small><div>${candidate.projectTags.slice(0, 4).map((tag) => `<span>${esc(tag)}</span>`).join('')}</div></div>` : '';
      return `<article class="talent-card"><div class="talent-card-top"><button class="candidate-profile-trigger" data-public-profile="${esc(candidate.id)}" title="View ${esc(candidate.name)} public profile"><span class="candidate-avatar ${candidate.avatar ? 'avatar-img' : ''}" style="${avatarStyle}">${esc(candidate.initials)}</span><span class="talent-identity"><strong>${esc(candidate.name)}</strong><small>${esc(candidate.role)} · ${esc(candidate.school || candidate.detail)}</small></span></button><div class="match-badge"><strong>${esc(candidate.score)}</strong><small>MATCH</small></div></div><p class="talent-bio">${esc(candidate.resumeAnalysis?.summary || candidate.bio)}</p><div class="talent-source-tags">${resumeTags}${projectTags || '<div class="talent-source-empty">No GitHub project tags</div>'}</div><div class="talent-meta"><span>${esc(candidate.coverage)}% rubric coverage</span><span>${esc(candidate.graduationYear || candidate.availability || `Active ${candidate.recent}d ago`)}</span></div><div class="talent-actions"><button class="view-profile" data-view="${esc(candidate.id)}">View evidence</button><button class="shortlist-btn ${shortlist.has(candidate.id) ? 'saved' : ''}" data-shortlist="${esc(candidate.id)}">${shortlist.has(candidate.id) ? 'Saved' : 'Save'}</button></div></article>`;
    }).join('') : '<div class="pool-empty"><strong>No matching profiles</strong><p>Try another filter or clear the active filters.</p></div>';
    document.querySelectorAll('[data-public-profile]').forEach((button) => button.addEventListener('click', () => openCandidatePublicProfile(allCandidates().find((candidate) => candidate.id === button.dataset.publicProfile))));
    document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => openCandidate(allCandidates().find((candidate) => candidate.id === button.dataset.view))));
    document.querySelectorAll('[data-shortlist]').forEach((button) => button.addEventListener('click', () => toggleShortlist(button.dataset.shortlist)));
    renderShortlistSummary();
  };

  function safeEvidenceUrl(value) {
    const raw = String(value || '');
    if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
    if (/^[\w.-]+\.[a-z]{2,}\//i.test(raw)) return `https://${raw}`;
    return '';
  }

  function openCandidatePublicProfile(candidate) {
    if (!candidate) return;
    const summary = candidate.bio || 'No personal overview shared.';
    const avatarStyle = candidate.avatar ? `background-image:url('${esc(candidate.avatar)}')` : `background:${esc(candidate.color || '#e85a33')}`;
    const personalInformation = [
      ['Name', candidate.name],
      candidate.school ? ['School / organisation', candidate.school] : null,
      candidate.graduationYear ? ['Graduation year', candidate.graduationYear] : null,
      candidate.availability ? ['Availability', candidate.availability] : null,
      ...Object.entries(candidate.contact || {}).filter(([, value]) => value).map(([key, value]) => [key, value]),
    ].filter(Boolean);
    const personalGrid = personalInformation.map(([label, value]) => `<div><small>${esc(label)}</small><strong>${esc(value)}</strong></div>`).join('');
    document.getElementById('modalContent').innerHTML = `<div class="public-profile-head"><span class="modal-avatar ${candidate.avatar ? 'avatar-img' : ''}" style="${avatarStyle}">${esc(candidate.initials || initials(candidate.name))}</span><div><div class="modal-kicker">PUBLIC PROFILE</div><div class="modal-name">${esc(candidate.name)}</div><div class="modal-role">${esc(candidate.role)}</div></div></div><section class="public-information"><span>PERSONAL INFORMATION</span><div class="public-profile-facts">${personalGrid}</div></section><section class="public-profile-section"><span>PERSONAL OVERVIEW</span><p>${esc(summary)}</p></section>`;
    document.getElementById('modal').classList.add('open');
  }
  window.openCandidatePublicProfile = openCandidatePublicProfile;

  function getApplicationRequests() {
    return JSON.parse(localStorage.getItem(REQUEST_KEY) || '[]');
  }

  function saveApplicationRequests(requests) {
    localStorage.setItem(REQUEST_KEY, JSON.stringify(requests));
  }

  function requestApplication(candidate) {
    if (currentUser?.role !== 'teacher' || !candidate?.ownerId) return;
    const requests = getApplicationRequests();
    const existing = requests.find((item) => item.studentId === candidate.ownerId && item.teacherId === currentUser.id);
    const teacherProfile = buildPublicProfile(currentUser);
    if (existing) {
      existing.status = 'pending';
      existing.requestedAt = new Date().toISOString();
      existing.teacherName = teacherProfile.name;
      existing.teacherOrg = teacherProfile.org;
      existing.teacherProfile = teacherProfile;
    } else {
      requests.push({
        id: `request-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        studentId: candidate.ownerId,
        candidateId: candidate.id,
        teacherId: currentUser.id,
        teacherName: teacherProfile.name,
        teacherOrg: teacherProfile.org,
        teacherProfile,
        status: 'pending',
        requestedAt: new Date().toISOString(),
      });
    }
    saveApplicationRequests(requests);
    toast('Application request sent to the student');
    openCandidate(candidate);
  }

  function openTeacherProfile(request) {
    const profile = request.teacherProfile || {
      name: request.teacherName,
      role: 'teacher',
      avatar: '',
      org: request.teacherOrg || '',
      contact: {},
    };
    const avatarStyle = profile.avatar ? `background-image:url('${esc(profile.avatar)}')` : '';
    const information = [['Name', profile.name], profile.org ? ['School / organisation', profile.org] : null, ...Object.entries(profile.contact || {}).filter(([, value]) => value)].filter(Boolean);
    document.getElementById('modalContent').innerHTML = `<div class="public-profile-head"><span class="modal-avatar ${profile.avatar ? 'avatar-img' : ''}" style="${avatarStyle}">${esc(initials(profile.name))}</span><div><div class="modal-kicker">TEACHER PROFILE</div><div class="modal-name">${esc(profile.name)}</div><div class="modal-role">Teacher</div></div></div><section class="public-information"><span>PERSONAL INFORMATION</span><div class="public-profile-facts">${information.map(([label, value]) => `<div><small>${esc(label)}</small><strong>${esc(value)}</strong></div>`).join('')}</div></section>`;
    document.getElementById('modal').classList.add('open');
  }

  function renderStudentRequests() {
    const container = document.getElementById('studentRequests');
    if (!container || currentUser?.role !== 'student') return;
    const requests = getApplicationRequests().filter((item) => item.studentId === currentUser.id);
    const pending = requests.filter((item) => item.status === 'pending').length;
    document.getElementById('requestCount').textContent = `${pending} pending`;
    container.innerHTML = requests.length ? requests.map((request) => {
      const profile = request.teacherProfile || { name: request.teacherName, avatar: '', org: request.teacherOrg || '' };
      const avatarStyle = profile.avatar ? `background-image:url('${esc(profile.avatar)}')` : '';
      return `<article class="request-row"><div><button class="request-profile" data-teacher-profile="${esc(request.id)}" title="View ${esc(profile.name)} profile"><span class="request-avatar ${profile.avatar ? 'avatar-img' : ''}" style="${avatarStyle}">${esc(initials(profile.name))}</span><span><strong>${esc(profile.name)}</strong><small>${esc(profile.org || 'Teacher workspace')}</small></span></button><p>${request.status === 'approved' ? 'Application sent · this teacher can view your resume' : request.status === 'declined' ? 'Request declined' : 'Invited you to apply and share your original resume'}</p></div><div class="request-actions">${request.status === 'pending' ? `<button data-request-decision="approved:${esc(request.id)}">Apply & share resume</button><button class="decline" data-request-decision="declined:${esc(request.id)}">Decline</button>` : `<span class="request-state ${esc(request.status)}">${request.status}</span>`}</div></article>`;
    }).join('') : '<div class="request-empty">No application requests yet.</div>';
    document.querySelectorAll('[data-teacher-profile]').forEach((button) => button.addEventListener('click', () => {
      const request = requests.find((item) => item.id === button.dataset.teacherProfile);
      if (request) openTeacherProfile(request);
    }));
    document.querySelectorAll('[data-request-decision]').forEach((button) => button.addEventListener('click', () => {
      const [status, id] = button.dataset.requestDecision.split(':');
      const next = getApplicationRequests();
      const request = next.find((item) => item.id === id);
      if (!request || request.studentId !== currentUser.id) return;
      request.status = status;
      request.respondedAt = new Date().toISOString();
      saveApplicationRequests(next);
      renderStudentRequests();
      toast(status === 'approved' ? 'Application sent. Resume access granted to this teacher.' : 'Application request declined');
    }));
  }

  openCandidate = function (candidate) {
    if (!candidate) return;
    candidate = evaluateCandidate(candidate);
    const isSaved = shortlist.has(candidate.id);
    const avatarStyle = candidate.avatar ? `background-image:url('${esc(candidate.avatar)}')` : `background:${esc(candidate.color || '#e85a33')}`;
    const analysis = candidate.resumeAnalysis || null;
    const teacherRequest = currentUser?.role === 'teacher' ? getApplicationRequests().find((item) => item.studentId === candidate.ownerId && item.teacherId === currentUser.id) : null;
    const canDownloadResume = Boolean(candidate.resume && currentUser?.role === 'teacher' && teacherRequest?.status === 'approved');
    const analysisBlock = analysis ? `<section class="candidate-analysis"><div class="analysis-title"><span>RESUME ANALYSIS</span><small>${analysis.source === 'deepseek' ? 'AI generated' : 'Local analysis'}</small></div><p>${esc(analysis.summary)}</p><div class="analysis-tags">${(analysis.abilities || []).map((ability) => `<span>${esc(ability)}</span>`).join('')}</div>${(analysis.education || []).length ? `<div class="analysis-list"><strong>Education</strong>${analysis.education.map((item) => `<span>${esc(item)}</span>`).join('')}</div>` : ''}${(analysis.experience || []).length ? `<div class="analysis-list"><strong>Experience highlights</strong>${analysis.experience.map((item) => `<span>${esc(item)}</span>`).join('')}</div>` : ''}</section>` : '<section class="candidate-analysis empty">No resume analysis published.</section>';
    const projectBlock = candidate.projectTags.length
      ? `<section class="candidate-analysis project-analysis"><div class="analysis-title"><span>GITHUB PROJECT ANALYSIS</span><small>Public repository metadata</small></div><div class="analysis-tags">${candidate.projectTags.map((tag) => `<span>${esc(tag)}</span>`).join('')}</div></section>`
      : '<section class="candidate-analysis empty">No GitHub project tags available.</section>';
    const rubricBreakdown = `<section class="rubric-breakdown"><div class="analysis-title"><span>RUBRIC BREAKDOWN</span><small>Project evidence 70% · resume claims 30%</small></div>${candidate.rubricScores.map((item, index) => {
      const projectEvidence = item.projectMatches.length ? item.projectMatches.join(', ') : 'No matching project evidence';
      const resumeEvidence = item.resumeMatches.length ? item.resumeMatches.join(', ') : 'No matching resume evidence';
      return `<div class="rubric-score-row"><div class="rubric-score-head"><strong>${esc(item.label)}</strong><span>${esc(item.score)}/100 · weight ${esc(currentWeights[index])}%</span></div><div class="rubric-score-bar"><i style="width:${esc(item.score)}%"></i></div><p><b>GitHub:</b> ${esc(projectEvidence)}</p><p><b>Resume:</b> ${esc(resumeEvidence)}</p></div>`;
    }).join('')}</section>`;
    let resume = '';
    if (candidate.resume && canDownloadResume) {
      resume = `<div class="submission-resume"><strong>Application received · original resume</strong>${esc(candidate.resume.name)} · ${Math.ceil(candidate.resume.size / 1024)} KB<br><button class="resume-download" id="downloadCandidateResume">↓ Download resume file</button></div>`;
    } else if (candidate.resume && currentUser?.role === 'teacher') {
      resume = teacherRequest?.status === 'pending'
        ? '<div class="submission-resume locked"><strong>Application requested</strong>The student has not responded yet.</div>'
        : `<div class="submission-resume locked"><strong>Original resume requires an application</strong><button class="resume-download" id="requestCandidateApplication">Request application</button></div>`;
    }
    const evidence = (candidate.evidence || []).map((item) => {
      const url = safeEvidenceUrl(item[2]);
      return `<div class="evidence-item"><div><strong>${esc(item[0])}</strong><p>${esc(item[1])}</p></div>${url ? `<a href="${esc(url)}" target="_blank" rel="noreferrer">View source</a>` : ''}</div>`;
    }).join('');
    document.getElementById('modalContent').innerHTML = `<div class="public-profile-head"><span class="modal-avatar ${candidate.avatar ? 'avatar-img' : ''}" style="${avatarStyle}">${esc(candidate.initials || initials(candidate.name))}</span><div><div class="modal-kicker">VERIFIED EVIDENCE PROFILE</div><div class="modal-name">${esc(candidate.name)}</div><div class="modal-role">${esc(candidate.role)}${candidate.school || candidate.detail ? ` · ${esc(candidate.school || candidate.detail)}` : ''}</div></div></div><div class="modal-score">${esc(candidate.score)}<small>/ 100</small></div>${rubricBreakdown}${analysisBlock}${projectBlock}${resume}<div class="evidence-list">${evidence}</div><button class="save-btn modal-save" data-modal-save="${esc(candidate.id)}">${isSaved ? 'Remove from shortlist' : 'Add to shortlist'}</button>`;
    document.getElementById('modal').classList.add('open');
    document.querySelector('[data-modal-save]').addEventListener('click', () => { toggleShortlist(candidate.id); openCandidate(candidate); });
    document.getElementById('requestCandidateApplication')?.addEventListener('click', () => requestApplication(candidate));
    document.getElementById('downloadCandidateResume')?.addEventListener('click', async () => {
      let blob;
      if (candidate.resume.data) blob = dataUrlToBlob(candidate.resume.data, candidate.resume.type);
      else blob = await getResume(candidate.resume.resumeId);
      if (!blob) { toast('Resume file is not available on this device'); return; }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url; link.download = candidate.resume.name; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  };

  function renderAdmin() {
    const filters = getFilters();
    const submissions = JSON.parse(localStorage.getItem('lions-submissions') || '[]');
    document.getElementById('adminAccountCount').textContent = getAccounts().length;
    document.getElementById('adminSubmissionCount').textContent = submissions.length;
    document.getElementById('adminScanCount').textContent = submissions.filter((item) => item.resumeAnalysis).length;
    document.getElementById('adminFilterCount').textContent = Object.values(filters).reduce((sum, values) => sum + values.length, 0);
    const renderSourceStats = (title, source, emptyCopy) => {
      const counts = {};
      source.forEach((tag) => { counts[tag] = (counts[tag] || 0) + 1; });
      const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);
      const max = rows[0]?.[1] || 1;
      return `<section class="ability-source"><div class="ability-source-head"><strong>${esc(title)}</strong><small>${rows.length} tags</small></div>${rows.length ? rows.map(([tag, count]) => `<div class="ability-row"><span>${esc(tag)}</span><i><b style="width:${Math.round(count / max * 100)}%"></b></i><strong>${count}</strong></div>`).join('') : `<div class="request-empty">${esc(emptyCopy)}</div>`}</section>`;
    };
    const resumeTags = submissions.flatMap((submission) => submission.resumeTags || submission.resumeAnalysis?.abilities || []);
    const projectTags = submissions.flatMap((submission) => submission.projectTags || submission.projectAnalysis?.tags || []);
    document.getElementById('abilityStats').innerHTML = `${renderSourceStats('Resume analysis', resumeTags, 'No published resume tags yet.')}${renderSourceStats('GitHub project analysis', projectTags, 'No published project tags yet.')}`;
    const labels = { skills: 'Skills', fields: 'Fields', schools: 'Schools', years: 'Graduation years', availability: 'Availability' };
    document.getElementById('filterGroups').innerHTML = Object.entries(filters).map(([key, values]) => `<div class="filter-group"><h4>${labels[key]}</h4><div class="filter-chips">${values.map((value, index) => `<span class="filter-chip">${esc(value)}<button data-remove-filter="${key}:${index}" aria-label="Remove ${esc(value)}">×</button></span>`).join('')}</div></div>`).join('');
    document.querySelectorAll('[data-remove-filter]').forEach((button) => button.addEventListener('click', () => {
      const [key, index] = button.dataset.removeFilter.split(':');
      const next = getFilters();
      next[key].splice(Number(index), 1);
      saveFilters(next); refreshFilterSelects(); renderAdmin(); toast('Filter option removed');
    }));
  }

  async function submitStudentProfile() {
    if (!projects.length && !activeResumeMeta) {
      toast('Add a project or attach your resume before submitting');
      return;
    }
    const pendingProjects = projects.filter((project) => !activeProjectAnalyses[project] || activeProjectAnalyses[project].pending);
    if (pendingProjects.length) {
      toast('Finishing GitHub project analysis before publishing');
      await Promise.all(pendingProjects.map(async (project) => {
        activeProjectAnalyses[project] = await analyzeProject(project);
      }));
      renderProjects();
    }
    if (!await saveCurrentProfile(true)) return;
    if (activeResumeAnalysis) saveResumeAnalysis(true);
    const shared = buildPublicProfile(currentUser);
    const resumeTags = uniqueText(activeResumeAnalysis?.abilities || []);
    const projectTags = currentProjectTags();
    const projectAnalysis = { tags: projectTags, items: Object.values(activeProjectAnalyses).filter((item) => !item.pending) };
    let submission = {
      id: `student-${currentUser.id}`, ownerId: currentUser.id, name: shared.name,
      role: 'Student candidate', detail: shared.org || 'Student candidate', avatar: shared.avatar,
      school: shared.org, graduationYear: shared.graduationYear,
      availability: shared.availability, initials: initials(currentUser.name), color: '#e85a33', recent: 0,
      resumeTags, projectTags, projectAnalysis, proofs: projectTags,
      bio: document.getElementById('studentBio').value.trim() || 'A student building practical projects.',
      contact: shared.contact, resume: activeResumeMeta, resumeAnalysis: activeResumeAnalysis,
      evidence: projects.length ? projects.map((project, index) => [`Submitted project ${index + 1}`, 'Student-authorised public repository', document.getElementById('privacyToggle').checked ? project : '']) : [['Resume submission', 'Student-authorised resume file', '']],
    };
    submission = evaluateCandidate(submission);
    const submissions = JSON.parse(localStorage.getItem('lions-submissions') || '[]').filter((item) => item.ownerId !== currentUser.id && item.ownerEmail !== currentUser.loginEmail);
    submissions.push(submission);
    localStorage.setItem('lions-submissions', JSON.stringify(submissions));
    document.querySelector('.status-text').textContent = 'Submitted';
    document.querySelector('.status-text').style.color = '#8fd0a5';
    toast('Submitted with your selected privacy settings');
  }

  async function initialize() {
    await migrateLegacyData();
    refreshFilterSelects();

    const savedWeights = JSON.parse(localStorage.getItem(RUBRIC_KEY) || 'null');
    if (Array.isArray(savedWeights) && savedWeights.length === rubric.length && savedWeights.every((value) => Number.isFinite(value) && value >= 0 && value <= 60) && savedWeights.reduce((sum, value) => sum + value, 0) === 100) {
      currentWeights = savedWeights.map(Number);
    }
    renderRubric();
    updateScores();

    const oldForm = document.getElementById('authForm');
    const authForm = oldForm.cloneNode(true);
    oldForm.replaceWith(authForm);
    authForm.addEventListener('submit', handleAuth);
    document.querySelectorAll('input[name="authRole"]').forEach((radio) => radio.addEventListener('change', updateAdminCodeVisibility));

    const logout = replaceWithClone('logoutBtn');
    logout.addEventListener('click', () => {
      sessionStorage.removeItem(SESSION_KEY);
      activeVaultKey = null; currentUser = null; activeResumeMeta = null; activeResumeAnalysis = null; activeProjectAnalyses = {};
      document.getElementById('authForm').reset(); setAuthMode('login');
      document.getElementById('authScreen').classList.remove('hidden');
    });

    const submit = replaceWithClone('submitEvidence');
    submit.addEventListener('click', submitStudentProfile);
    const addProject = replaceWithClone('addProject');
    addProject.addEventListener('click', async () => {
      const input = document.getElementById('projectInput');
      const raw = input.value.trim();
      if (!raw) { toast('Enter a project link first'); return; }
      const project = raw.replace(/^https?:\/\//i, '').replace(/\/$/, '');
      if (projects.some((item) => item.toLowerCase() === project.toLowerCase())) { toast('This project is already in your evidence'); return; }
      projects.push(project);
      activeProjectAnalyses[project] = { pending: true, summary: 'Analyzing public repository...', tags: [] };
      input.value = '';
      renderProjects();
      const analysis = await analyzeProject(project);
      if (!projects.includes(project)) return;
      activeProjectAnalyses[project] = analysis;
      renderProjects();
      toast(analysis.source === 'github' ? 'Project added and GitHub tags updated' : 'Project added; public metadata was unavailable');
    });

    const saveRubric = replaceWithClone('saveRubric');
    saveRubric.addEventListener('click', () => {
      if (currentWeights.reduce((sum, value) => sum + value, 0) !== 100) {
        toast('Adjust the rubric weights to total 100% before saving');
        return;
      }
      localStorage.setItem(RUBRIC_KEY, JSON.stringify(currentWeights));
      toast('Rubric saved · rankings updated');
    });
    const resetRubric = replaceWithClone('resetRubric');
    resetRubric.addEventListener('click', () => {
      currentWeights = rubric.map((item) => item[1]);
      localStorage.removeItem(RUBRIC_KEY);
      renderRubric();
      updateScores();
      toast('Rubric reset to role defaults');
    });
    document.getElementById('saveProfile').addEventListener('click', () => saveCurrentProfile());
    document.getElementById('saveResumeAnalysis').addEventListener('click', () => saveResumeAnalysis());
    document.getElementById('avatarInput').addEventListener('change', async (event) => {
      const file = event.target.files[0];
      if (!file) return;
      try {
        currentUser.avatar = await avatarFromFile(file);
        showAvatar(document.getElementById('profileAvatar'), currentUser);
        toast('Photo ready. Save your private profile to keep it.');
      } catch (error) { toast(error.message); }
      event.target.value = '';
    });

    document.getElementById('scanResume').addEventListener('click', async (event) => {
      const meta = activeResumeMeta || resumeFile;
      if (!meta?.resumeId) { toast('Attach a PDF or DOCX resume first'); return; }
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = 'Scanning...';
      try {
        const file = await getResume(meta.resumeId);
        if (!file) { toast('The resume file is no longer available on this device'); return; }
        await showExtracted(file, true);
      } finally {
        button.disabled = false;
        button.textContent = 'Analyze resume';
      }
    });

    document.getElementById('adminNav').addEventListener('click', () => showWorkspace('admin'));
    document.getElementById('mobileAdmin').addEventListener('click', () => showWorkspace('admin'));
    document.getElementById('profileNav').addEventListener('click', () => showWorkspace('profile'));
    document.getElementById('mobileProfile').addEventListener('click', () => showWorkspace('profile'));
    document.getElementById('profileShortcut').addEventListener('click', () => showWorkspace('profile'));
    document.getElementById('openAdminMarket').addEventListener('click', () => { shortlistOnly = false; showWorkspace('talent'); });
    document.getElementById('filterForm').addEventListener('submit', (event) => {
      event.preventDefault();
      const category = document.getElementById('filterCategory').value;
      const value = document.getElementById('filterValue').value.trim();
      const filters = getFilters();
      if (!value || filters[category].some((item) => item.toLowerCase() === value.toLowerCase())) { toast('Enter a new, unique filter option'); return; }
      filters[category].push(value); saveFilters(filters); document.getElementById('filterValue').value = '';
      refreshFilterSelects(); renderAdmin(); toast('Filter option added to the talent market');
    });
    ['schoolFilter', 'yearFilter', 'availabilityFilter'].forEach((id) => document.getElementById(id).addEventListener('change', renderTalentPool));
    window.addEventListener('storage', (event) => {
      if (event.key === REQUEST_KEY && currentUser?.role === 'student') renderStudentRequests();
      if (event.key === 'lions-submissions' && currentUser && currentUser.role !== 'student') renderTalentPool();
    });
    document.getElementById('clearFilters').addEventListener('click', () => {
      ['schoolFilter', 'yearFilter', 'availabilityFilter'].forEach((id) => { document.getElementById(id).value = ''; });
      renderTalentPool();
    });

    candidates.forEach((candidate) => Object.assign(candidate, decorateCandidate(candidate)));
    sessionStorage.removeItem(SESSION_KEY);
    currentUser = null;
    document.getElementById('authScreen').classList.remove('hidden');
  }

  initialize().catch((error) => {
    console.error('LIONS secure profile initialization failed', error);
    document.getElementById('authHint').textContent = 'The secure profile service could not start in this browser.';
  });
}());
