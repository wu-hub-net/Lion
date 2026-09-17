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

  const ui = (key, vars) => window.lionsT ? window.lionsT(key, vars) : String(key ?? '');
  const uiLocale = () => window.lionsLocale ? window.lionsLocale() : 'en-US';
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
      org: org.trim() || (role === 'student' ? 'Student workspace' : role === 'admin' ? 'LIONS administration' : 'Reviewer workspace'),
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
    const studentTypes = ['studentDashboard', 'student', 'resume', 'resumeUpload', 'resumeAnalysis', 'offers', 'interviews', 'jobs'];
    if (currentUser?.role === 'student' && !studentTypes.includes(type) && type !== 'profile') type = 'studentDashboard';
    if (currentUser?.role === 'admin' && !['admin', 'moderation', 'talent', 'profile'].includes(type)) type = 'admin';
    if (currentUser?.role === 'teacher' && ['admin', 'moderation'].includes(type)) type = 'overview';
    const profileView = document.getElementById('profileView');
    const offersView = document.getElementById('offersView');
    const extendedViews = ['studentDashboardView', 'resumeView', 'resumeUploadView', 'resumeAnalysisView', 'interviewsView', 'jobsView', 'applicationsView', 'adminModerationView'];
    document.getElementById('adminView').classList.remove('active');
    profileView.classList.remove('active');
    offersView.classList.remove('active');
    extendedViews.forEach((id) => document.getElementById(id)?.classList.remove('active'));
    const activate = (viewId, navId, render) => {
      employerView.style.display = 'none'; studentView.classList.remove('active'); talentView.classList.remove('active'); assessmentView.classList.remove('active');
      document.getElementById(viewId).classList.add('active');
      navItems.forEach((item) => item.classList.remove('active'));
      document.getElementById(navId)?.classList.add('active');
      render?.(); window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    if (type === 'studentDashboard') { activate('studentDashboardView', 'studentDashboardNav', renderStudentDashboard); return; }
    if (type === 'resume') { activate('resumeView', 'resumeNav', renderRemoteResumes); return; }
    if (type === 'resumeUpload') { activate('resumeUploadView', 'resumeNav'); return; }
    if (type === 'resumeAnalysis') { activate('resumeView', 'resumeNav', renderRemoteResumes); return; }
    if (type === 'interviews') { activate('interviewsView', 'interviewsNav', renderInterviews); return; }
    if (type === 'jobs') { activate('jobsView', 'jobsNav', renderStudentJobs); return; }
    if (type === 'applications') { activate('applicationsView', 'applicationsNav', renderApplications); return; }
    if (type === 'moderation') { activate('adminModerationView', 'adminModerationNav', renderModeration); return; }
    if (type === 'student') {
      employerView.style.display = 'none';
      studentView.classList.add('active'); talentView.classList.remove('active'); assessmentView.classList.remove('active');
      navItems.forEach((item) => item.classList.remove('active'));
      document.getElementById('studentNav')?.classList.add('active');
      renderStudentRequests(); renderRecommendedOffers();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (type === 'offers' && currentUser?.role === 'student') {
      employerView.style.display = 'none';
      studentView.classList.remove('active');
      talentView.classList.remove('active');
      assessmentView.classList.remove('active');
      offersView.classList.add('active');
      navItems.forEach((item) => item.classList.remove('active'));
      document.getElementById('offersNav').classList.add('active');
      document.querySelectorAll('.mobile-nav button').forEach((button) => button.classList.toggle('active', button.id === 'mobileOffers'));
      renderOffersPage();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
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
    if (type === 'student') { renderStudentRequests(); renderRecommendedOffers(); }
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
    document.getElementById('profileEyebrow').innerHTML = `${isStudent ? 'STUDENT' : currentUser.role === 'teacher' ? 'REVIEWER' : 'ADMINISTRATOR'} ACCOUNT <span>/</span> PERSONAL PROFILE`;
    document.getElementById('profileTitle').textContent = `${currentUser.name || 'Your'} profile`;
    document.getElementById('profileLead').textContent = isStudent
      ? 'Manage your identity and decide which contact details verified reviewers can see.'
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

  const OFFER_KEY = 'lions-offers';
  let remoteOffers = [];
  let offerApiOnline = false;
  let offerIdentity = null;
  function getOffers() {
    try { return JSON.parse(localStorage.getItem(OFFER_KEY) || '[]'); } catch (error) { return []; }
  }

  function saveOffers(offers) {
    localStorage.setItem(OFFER_KEY, JSON.stringify(offers));
  }

  function offerActorRole() { return currentUser?.role === 'teacher' ? 'reviewer' : currentUser?.role === 'admin' ? 'admin' : 'student'; }

  async function resolveOfferIdentity() {
    if (!currentUser?.loginEmail || !window.lionsApi?.resolveOfferIdentity) throw new Error('Offer API is unavailable');
    if (offerIdentity?.email === currentUser.loginEmail && offerIdentity.role === offerActorRole()) return offerIdentity;
    offerIdentity = await window.lionsApi.resolveOfferIdentity({
      username: currentUser.name || 'LIONS User', email: currentUser.loginEmail, role: offerActorRole(),
    });
    return offerIdentity;
  }

  function apiOfferToUi(offer) {
    return {
      id: String(offer.id), remote: true, company: offer.company_name, title: offer.job_title,
      type: offer.employment_type, location: offer.location || '', compensation: offer.salary || '',
      deadline: offer.deadline || '', skills: offer.skills || '', details: offer.message || '',
      status: offer.status, sentAt: offer.sent_at, createdAt: offer.created_at,
      candidateId: offer.candidate_id, studentId: offer.student_id, reviewerId: offer.reviewer_id,
      candidateName: offer.candidate_name, reviewerName: offer.reviewer_name, active: offer.status !== 'rejected',
    };
  }

  async function loadStudentOffers() {
    if (currentUser?.role !== 'student') return getOffers();
    try {
      const identity = await resolveOfferIdentity();
      remoteOffers = (await window.lionsApi.listOffers({ student_id: identity.id })).map(apiOfferToUi);
      offerApiOnline = true;
      return remoteOffers;
    } catch (error) {
      offerApiOnline = false;
      return getOffers();
    }
  }

  async function loadReviewerOffers() {
    try {
      const identity = await resolveOfferIdentity();
      return (await window.lionsApi.listOffers({ reviewer_id: identity.id })).map(apiOfferToUi);
    } catch (error) { return []; }
  }

  function renderReviewerOfferHistory(container, offers) {
    if (!container) return;
    container.innerHTML = offers.length
      ? `<div class="candidate-analysis"><div class="analysis-title"><span>SENT OFFERS</span><small>${offers.length}</small></div>${offers.map((offer) => `<div class="contact-item"><small>${esc(offer.candidateName || 'Student')} · ${esc(offerStatus(offer))}</small><strong>${esc(offer.company)} · ${esc(offer.title)}</strong></div>`).join('')}</div>`
      : '';
  }

  async function syncStudentOfferRecipient(submission) {
    if (!currentUser?.loginEmail || !window.lionsApi?.resolveStudentOfferRecipient) return null;
    try {
      const identity = await resolveOfferIdentity();
      const recipient = await window.lionsApi.resolveStudentOfferRecipient({
        user_id: identity.id, name: submission.name, email: currentUser.loginEmail,
        education: submission.role, location: submission.school || submission.detail || '', summary: submission.bio || '',
      });
      submission.backendCandidateId = recipient.id;
      submission.studentUserId = recipient.user_id;
      return recipient;
    } catch (error) { return null; }
  }

  function formatRemoteDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString(uiLocale(), { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function renderEmpty(container, copy) {
    container.innerHTML = `<div class="moderation-list-empty">${esc(ui(copy))}</div>`;
  }

  async function currentRemoteUser() {
    return resolveOfferIdentity();
  }

  async function renderStudentDashboard() {
    const metrics = document.getElementById('studentDashboardMetrics');
    const activity = document.getElementById('studentActivityList');
    try {
      const identity = await currentRemoteUser();
      const [resumes, offers, interviews, applications] = await Promise.all([
        window.lionsApi.listResumes(identity.id, identity.id),
        window.lionsApi.listOffers({ student_id: identity.id }),
        window.lionsApi.listInterviews({ student_id: identity.id, actor_id: identity.id }),
        window.lionsApi.listApplications({ student_id: identity.id }),
      ]);
      const pendingOffers = offers.filter((item) => item.status === 'sent').length;
      const upcoming = interviews.filter((item) => item.status === 'scheduled' && new Date(item.scheduled_at) >= new Date()).length;
      const latestResume = resumes[0];
      let analysis = null;
      if (latestResume?.status === 'analyzed') analysis = await window.lionsApi.getResumeAnalysis(latestResume.id, identity.id);
      metrics.innerHTML = [
        ['My resume', resumes.length], ['Resume score', analysis ? `${analysis.overall_score}/100` : '—'],
        ['Pending offers', pendingOffers], ['Upcoming interviews', upcoming], ['Applications', applications.length],
      ].map(([label, value]) => `<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('');
      const entries = [
        ...offers.map((offer) => ({ when: offer.updated_at, title: `Offer ${offer.status}`, copy: `${offer.company_name} · ${offer.job_title}` })),
        ...applications.map((application) => ({ when: application.updated_at, title: `Application ${application.status}`, copy: `${application.company_name} · ${application.job_title}` })),
        ...interviews.map((item) => ({ when: item.updated_at, title: `Interview ${item.student_response}`, copy: `${item.company_name} · ${item.job_title}` })),
        ...(analysis ? [{ when: analysis.updated_at, title: 'Resume analysis completed', copy: `Overall score ${analysis.overall_score}/100` }] : []),
      ].sort((a, b) => new Date(b.when) - new Date(a.when)).slice(0, 6);
      activity.innerHTML = entries.length ? entries.map((item) => `<div class="activity-row"><div><strong>${esc(item.title)}</strong><small>${esc(item.copy)}</small></div><small>${esc(formatRemoteDate(item.when))}</small></div>`).join('') : '<div class="moderation-list-empty">No recent employment activity yet.</div>';
    } catch (error) {
      renderEmpty(metrics, 'The employment service is unavailable. Start the LIONS API to load your dashboard.');
      renderEmpty(activity, 'No remote activity is available.');
    }
  }

  let resumeEditMode = false;
  const selectedResumeIds = new Set();

  async function renderRemoteResumes() {
    const list = document.getElementById('resumeManagerList');
    try {
      const identity = await currentRemoteUser();
      const resumes = await window.lionsApi.listResumes(identity.id, identity.id);
      const validIds = new Set(resumes.map((resume) => resume.id));
      [...selectedResumeIds].forEach((id) => { if (!validIds.has(id)) selectedResumeIds.delete(id); });
      const toolbar = resumeEditMode ? `<div class="resume-batch-toolbar"><label><input type="checkbox" id="selectAllResumes" ${resumes.length && selectedResumeIds.size === resumes.length ? 'checked' : ''}> <span>Select all</span></label><span id="resumeSelectionCount"><b>${selectedResumeIds.size}</b> <span>selected</span></span><button class="wb-btn wb-btn-danger" id="deleteSelectedResumes" ${selectedResumeIds.size ? '' : 'disabled'}>Delete selected</button><button class="wb-btn wb-btn-ghost" id="cancelResumeEdit">Cancel</button></div>` : '';
      list.innerHTML = resumes.length ? toolbar + `<div class="resume-table-head ${resumeEditMode ? 'editing' : ''}">${resumeEditMode ? '<span></span>' : ''}<span>Resume</span><span>Uploaded</span><span>Analysis</span><span>AI score</span><span></span></div>` + resumes.map((resume) => {
        const analyzed = resume.status === 'analyzed';
        const body = `<span class="resume-file-name">▤ <b>${esc(resume.file_name)}</b></span><span>${esc(formatRemoteDate(resume.uploaded_at))}</span><span class="resume-status ${analyzed ? 'done' : ''}">${analyzed ? '✓ Analysis ready' : 'Waiting for analysis'}</span><span>${analyzed ? 'View report' : '—'}</span><span>${resumeEditMode ? '' : '›'}</span>`;
        return resumeEditMode
          ? `<div class="resume-table-row editing"><label class="resume-select"><input type="checkbox" data-select-resume="${resume.id}" ${selectedResumeIds.has(resume.id) ? 'checked' : ''}><span></span></label>${body}</div>`
          : `<button class="resume-table-row" data-open-resume="${resume.id}">${body}</button>`;
      }).join('') : '<div class="moderation-list-empty">No resume uploaded yet.</div>';
      list.querySelectorAll('[data-open-resume]').forEach((button) => button.addEventListener('click', () => openResumeReport(Number(button.dataset.openResume))));
      list.querySelectorAll('[data-select-resume]').forEach((checkbox) => checkbox.addEventListener('change', () => {
        const id = Number(checkbox.dataset.selectResume);
        if (checkbox.checked) selectedResumeIds.add(id); else selectedResumeIds.delete(id);
        renderRemoteResumes();
      }));
      document.getElementById('selectAllResumes')?.addEventListener('change', (event) => {
        selectedResumeIds.clear();
        if (event.currentTarget.checked) resumes.forEach((resume) => selectedResumeIds.add(resume.id));
        renderRemoteResumes();
      });
      document.getElementById('cancelResumeEdit')?.addEventListener('click', () => {
        resumeEditMode = false; selectedResumeIds.clear(); renderRemoteResumes();
      });
      document.getElementById('deleteSelectedResumes')?.addEventListener('click', async (event) => {
        const ids = [...selectedResumeIds];
        if (!ids.length || !window.confirm(ui('Delete {count} selected resumes? This cannot be undone.', { count: ids.length }))) return;
        event.currentTarget.disabled = true;
        const results = await Promise.allSettled(ids.map((id) => window.lionsApi.deleteResume(id, identity.id)));
        const failedIds = ids.filter((id, index) => results[index].status === 'rejected');
        selectedResumeIds.clear();
        failedIds.forEach((id) => selectedResumeIds.add(id));
        if (!failedIds.length) {
          resumeEditMode = false;
          document.getElementById('resumeDetail').classList.add('hidden');
          toast('Selected resumes deleted');
        } else toast('Some resumes could not be deleted');
        renderRemoteResumes();
      });
    } catch (error) { renderEmpty(list, 'The resume service is unavailable.'); }
  }

  async function renderRemoteResumeAnalysis() {
    const panel = document.getElementById('remoteAnalysisPanel');
    try {
      const identity = await currentRemoteUser();
      const resumes = await window.lionsApi.listResumes(identity.id, identity.id);
      const latest = resumes[0];
      if (!latest) { renderEmpty(panel, 'Upload a resume before starting analysis.'); return; }
      let analysis;
      try { analysis = await window.lionsApi.getResumeAnalysis(latest.id, identity.id); }
      catch (error) { panel.innerHTML = `<div class="moderation-list-empty"><p>Analysis has not been run for ${esc(latest.file_name)}.</p><button class="save-btn" id="startRemoteAnalysis">Analyze resume</button></div>`; document.getElementById('startRemoteAnalysis').addEventListener('click', async () => { await window.lionsApi.analyzeResume(latest.id, identity.id); renderRemoteResumeAnalysis(); }); return; }
      const scores = [['Completeness', analysis.completeness_score], ['Skills', analysis.skill_score], ['Projects', analysis.project_score], ['Education', analysis.education_score], ['Experience', analysis.experience_score], ['Quality', analysis.quality_score]];
      const list = (items) => `<ul>${(items || []).map((item) => `<li>${esc(item)}</li>`).join('') || '<li>No details extracted yet.</li>'}</ul>`;
      const skills = (analysis.skills || []).map((item) => `<span class="profile-chip">${esc(item)}</span>`).join('');
      const projects = (analysis.projects || []).map((item) => `<li>${esc(item)}</li>`).join('');
      const points = scores.map(([, value], index) => { const angle = (-90 + index * 60) * Math.PI / 180; const radius = 72 * (Number(value) / 100); return `${100 + Math.cos(angle) * radius},${100 + Math.sin(angle) * radius}`; }).join(' ');
      panel.innerHTML = `<div class="analysis-overview"><div><span class="analysis-kicker">CORE EVALUATION</span><div class="analysis-score">${analysis.overall_score}<small>/ 100</small></div><p>${esc(analysis.summary || 'A concise, evidence-based profile generated from your resume.')}</p><small class="analysis-time">Analyzed ${esc(formatRemoteDate(analysis.updated_at || analysis.created_at))}</small></div><div class="radar-wrap"><svg viewBox="0 0 200 200" role="img" aria-label="Resume score radar"><polygon class="radar-grid" points="100,28 162,64 162,136 100,172 38,136 38,64"/><polygon class="radar-grid" points="100,52 141,76 141,124 100,148 59,124 59,76"/><polygon class="radar-shape" points="${points}"/></svg><div class="radar-labels">${scores.map(([label]) => `<span>${esc(label)}</span>`).join('')}</div></div></div><div class="analysis-grid">${scores.map(([label, value]) => `<div><span>${esc(label)}</span><strong>${value}</strong><i><b style="width:${value}%"></b></i></div>`).join('')}</div><div class="talent-card"><div class="talent-card-avatar">${esc((analysis.name || 'L').slice(0, 1).toUpperCase())}</div><div class="talent-card-main"><span class="analysis-kicker">LIONS TALENT CARD</span><h3>${esc(analysis.name || 'Candidate profile')}</h3><p>${esc([analysis.gender, analysis.age ? `${analysis.age} years` : '', analysis.email, analysis.phone].filter(Boolean).join(' · ') || 'Contact details can be added after review.')}</p><div class="profile-chips">${skills || '<span class="profile-chip muted">Skills will appear here</span>'}</div></div><span class="card-score">${analysis.overall_score}</span></div><div class="analysis-copy"><div><h4>Strengths</h4>${list(analysis.strengths)}</div><div><h4>Watch-outs</h4>${list(analysis.weaknesses)}</div><div><h4>Next improvements</h4>${list(analysis.suggestions)}</div></div>${projects ? `<div class="project-evidence"><h4>Project evidence</h4><ul>${projects}</ul></div>` : ''}`;
    } catch (error) { renderEmpty(panel, 'The resume analysis service is unavailable.'); }
  }

  function interviewStatus(item) {
    if (item.student_response === 'cancelled' || item.status === 'cancelled') return 'cancelled';
    if (item.status === 'rescheduled') return 'rescheduled';
    if (item.student_response === 'confirmed' || item.status === 'completed') return 'completed';
    if (item.scheduled_at && new Date(item.scheduled_at).getTime() < Date.now()) return 'expired';
    return 'pending';
  }

  const INTERVIEW_STATUS_LABELS = { pending: 'Pending', completed: 'Completed', cancelled: 'Cancelled', rescheduled: 'Rescheduled', expired: 'Expired' };
  function interviewStatusLabel(status) { return INTERVIEW_STATUS_LABELS[status] || 'Pending'; }
  function itemStatusClass(item) { return `wb-status-${interviewStatus(item)}`; }

  function roundLabel(round) {
    const value = String(round ?? '').trim();
    if (!value) return '';
    return /^\d+$/.test(value) ? `Round ${value}` : value;
  }

  function formatDateTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString(uiLocale(), { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  async function renderInterviews() {
    const list = document.getElementById('interviewList');
    const timeline = document.getElementById('interviewTimeline');
    const range = document.getElementById('timelineRange');
    const mode = window.interviewViewMode || 'week';
    try {
      const identity = await currentRemoteUser();
      const interviews = await window.lionsApi.listInterviews({ student_id: identity.id, actor_id: identity.id });
      const isList = mode === 'list';
      if (timeline) timeline.style.display = isList ? 'none' : '';
      if (list) list.style.display = isList ? '' : 'none';
      renderInterviewTimeline(timeline, range, interviews, mode);
      renderInterviewList(list, interviews, identity);
    } catch (error) { renderEmpty(list, 'The interview service is unavailable.'); }
  }

  function renderInterviewList(list, interviews, identity) {
    if (!list) return;
    if (!interviews.length) { list.innerHTML = '<div class="moderation-list-empty">No interviews are scheduled.</div>'; return; }
    const sorted = [...interviews].sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
    list.innerHTML = sorted.map((item) => {
      const status = interviewStatus(item);
      const label = interviewStatusLabel(status);
      const showStatus = status === 'pending' || status === 'expired';
      const meta = [];
      if (item.interview_round) meta.push(`<span><b>${esc(roundLabel(item.interview_round))}</b></span>`);
      if (item.interview_type) meta.push(`<span>Type <b>${esc(item.interview_type)}</b></span>`);
      if (item.scheduled_at) meta.push(`<span>Time <b>${esc(formatDateTime(item.scheduled_at))}</b></span>`);
      if (item.location) meta.push(`<span>Location <b>${esc(item.location)}</b></span>`);
      if (item.interviewer) meta.push(`<span>Interviewer <b>${esc(item.interviewer)}</b></span>`);
      const actions = [
        `<button class="wb-btn wb-btn-ghost" data-interview-view="${item.id}">View details</button>`,
        item.meeting_url ? `<button class="wb-btn wb-btn-primary" data-interview-link="${item.id}">Join</button>` : '',
        `<button class="wb-btn wb-btn-ghost" data-interview-edit="${item.id}">Edit</button>`,
        showStatus ? `<button class="wb-btn wb-btn-gradient" data-interview-complete="${item.id}">Mark completed</button>` : '',
        showStatus ? `<button class="wb-btn wb-btn-ghost" data-interview-cancel="${item.id}">Cancel interview</button>` : '',
        `<button class="wb-btn wb-btn-ghost" data-interview-delete="${item.id}">Delete</button>`,
      ].filter(Boolean).join('');
      return `<article class="wb-interview-card"><div class="wb-interview-card-head"><div><h4>${esc(item.company_name)}</h4><p>${esc(item.job_title)}</p></div><span class="wb-status-badge wb-status-${status}">${label}</span></div>${meta.length ? `<div class="wb-interview-meta">${meta.join('')}</div>` : ''}${item.notes ? `<p class="wb-interview-notes">${esc(item.notes)}</p>` : ''}<div class="wb-interview-actions">${actions}</div></article>`;
    }).join('');
    list.querySelectorAll('[data-interview-link]').forEach((button) => button.addEventListener('click', () => { const item = interviews.find((entry) => String(entry.id) === String(button.dataset.interviewLink)); if (item?.meeting_url) window.open(item.meeting_url, '_blank', 'noopener'); }));
    list.querySelectorAll('[data-interview-view]').forEach((button) => button.addEventListener('click', () => { const item = interviews.find((entry) => String(entry.id) === String(button.dataset.interviewView)); if (item) openInterviewDetails(item); }));
    list.querySelectorAll('[data-interview-edit]').forEach((button) => button.addEventListener('click', () => { const item = interviews.find((entry) => String(entry.id) === String(button.dataset.interviewEdit)); if (item) interviewForm(item); }));
    list.querySelectorAll('[data-interview-complete]').forEach((button) => button.addEventListener('click', () => { const item = interviews.find((entry) => String(entry.id) === String(button.dataset.interviewComplete)); if (item) setInterviewStatus(item, identity, 'completed'); }));
    list.querySelectorAll('[data-interview-cancel]').forEach((button) => button.addEventListener('click', () => { const item = interviews.find((entry) => String(entry.id) === String(button.dataset.interviewCancel)); if (item) setInterviewStatus(item, identity, 'cancelled'); }));
    list.querySelectorAll('[data-interview-delete]').forEach((button) => button.addEventListener('click', async () => {
      const item = interviews.find((entry) => String(entry.id) === String(button.dataset.interviewDelete));
      if (!item) return;
      if (!window.confirm(`Delete the interview with ${item.company_name}?`)) return;
      try { await window.lionsApi.deleteInterview(item.id, identity.id); toast('Interview deleted'); renderInterviews(); }
      catch (error) { toast('Interview could not be deleted'); }
    }));
  }

  async function setInterviewStatus(item, identity, status) {
    try {
      await window.lionsApi.updateInterview(item.id, { actor_id: identity.id, status });
      toast(status === 'completed' ? 'Interview marked as completed' : 'Interview cancelled');
      renderInterviews();
    } catch (error) { toast('Interview status could not be updated'); }
  }

  async function openResumeReport(resumeId) {
    const detail = document.getElementById('resumeDetail');
    const identity = await currentRemoteUser();
    const resumes = await window.lionsApi.listResumes(identity.id, identity.id);
    const resume = resumes.find((item) => item.id === resumeId);
    if (!resume) return;
    detail.classList.remove('hidden');
    detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
    try {
      let analysis;
      try { analysis = await window.lionsApi.getResumeAnalysis(resumeId, identity.id); }
      catch { detail.innerHTML = `<div class="resume-report-head"><button class="wb-btn wb-btn-ghost" data-close-report>← Back</button><div><h2>${esc(resume.file_name)}</h2><p>Uploaded ${esc(formatRemoteDate(resume.uploaded_at))}</p></div><button class="wb-btn wb-btn-gradient" id="analyzeSelectedResume">Analyze resume</button></div><div class="resume-report-empty">This resume has not been analyzed yet.</div>`; document.getElementById('analyzeSelectedResume').addEventListener('click', async () => { await window.lionsApi.analyzeResume(resumeId, identity.id); openResumeReport(resumeId); renderRemoteResumes(); }); detail.querySelector('[data-close-report]').addEventListener('click', () => detail.classList.add('hidden')); return; }
      const chips = (analysis.skills || []).map((skill) => `<span>${esc(skill)}</span>`).join('');
      detail.innerHTML = `<div class="resume-report-head"><button class="wb-btn wb-btn-ghost" data-close-report>← Back</button><div><h2>${esc(resume.file_name)}</h2><p>Uploaded ${esc(formatRemoteDate(resume.uploaded_at))} · AI analysis complete</p></div><button class="wb-btn wb-btn-gradient" data-build-card>Generate talent card</button></div><div class="resume-report-grid"><article class="resume-report-core"><h3>Core evaluation</h3><p>${esc(analysis.summary || 'Structured evidence-based analysis of this resume.')}</p><div class="resume-score-big">${analysis.overall_score}<small>/100</small></div><h4>Strengths</h4><ul>${(analysis.strengths || []).map((item) => `<li>${esc(item)}</li>`).join('')}</ul></article><article class="resume-report-dimensions"><h3>Multi-dimensional score</h3>${[['Skills',analysis.skill_score],['Projects',analysis.project_score],['Completeness',analysis.completeness_score],['Experience',analysis.experience_score],['Quality',analysis.quality_score]].map(([label,value]) => `<div class="resume-meter"><span>${label}</span><i><b style="width:${value}%"></b></i><strong>${value}</strong></div>`).join('')}<div class="resume-skill-chips">${chips}</div></article></div>`;
      detail.querySelector('[data-close-report]').addEventListener('click', () => detail.classList.add('hidden'));
      detail.querySelector('[data-build-card]').addEventListener('click', () => openTalentCard(analysis));
    } catch (error) { detail.innerHTML = '<div class="resume-report-empty">Unable to load this analysis report.</div>'; }
  }

  function openTalentCard(analysis) {
    const skills = uniqueText(analysis.skills || []);
    const visibleSkills = skills.slice(0, 18);
    openFlowModal('Your LIONS talent card', `<div class="generated-talent-card"><div class="generated-avatar">${esc((analysis.name || 'L').slice(0,1))}</div><h2>${esc(analysis.name || 'Candidate')}</h2><p>${esc(analysis.summary || 'Evidence-led candidate profile')}</p><div>${visibleSkills.map((skill) => `<span>${esc(skill)}</span>`).join('')}${skills.length > visibleSkills.length ? `<span>+${skills.length - visibleSkills.length}</span>` : ''}</div><strong>${analysis.overall_score}<small>/100</small></strong></div><div class="talent-card-save-actions"><button type="button" class="wb-btn wb-btn-gradient" id="saveTalentCard">↓ Save card as PNG</button></div>`);
    document.getElementById('saveTalentCard').addEventListener('click', () => saveTalentCard(analysis));
  }

  function drawWrappedText(context, text, x, y, maxWidth, lineHeight, maxLines) {
    const source = String(text || '');
    const isCjk = /[\u3400-\u9fff]/.test(source);
    const words = isCjk ? Array.from(source) : source.split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    for (const word of words) {
      const next = line ? `${line}${isCjk ? '' : ' '}${word}` : word;
      if (context.measureText(next).width <= maxWidth) line = next;
      else {
        if (line) lines.push(line);
        line = word;
        if (lines.length === maxLines - 1) break;
      }
    }
    if (line && lines.length < maxLines) lines.push(line);
    lines.forEach((item, index) => context.fillText(item, x, y + index * lineHeight));
    return y + lines.length * lineHeight;
  }

  function saveTalentCard(analysis) {
    const canvas = document.createElement('canvas');
    canvas.width = 1200; canvas.height = 675;
    const context = canvas.getContext('2d');
    context.fillStyle = '#202124'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#ed542b'; context.fillRect(0, 0, 18, canvas.height);
    context.fillStyle = '#ff7650'; context.font = '700 28px Arial, sans-serif'; context.fillText('LIONS', 70, 72);
    context.fillStyle = '#aeb5c4'; context.font = '400 18px Arial, sans-serif'; context.fillText('VERIFIED TALENT CARD', 70, 106);
    context.beginPath(); context.arc(1060, 90, 44, 0, Math.PI * 2); context.fillStyle = '#ed542b'; context.fill();
    context.fillStyle = '#ffffff'; context.font = '700 32px Arial, sans-serif'; context.textAlign = 'center'; context.fillText((analysis.name || 'L').slice(0, 1), 1060, 101); context.textAlign = 'left';
    context.fillStyle = '#ffffff'; context.font = '700 56px Arial, sans-serif'; context.fillText(analysis.name || 'Candidate', 70, 190);
    context.fillStyle = '#c9ced8'; context.font = '400 24px Arial, sans-serif';
    const skillsTop = drawWrappedText(context, analysis.summary || 'Evidence-led candidate profile', 70, 242, 920, 36, 3) + 28;
    const skills = uniqueText(analysis.skills || []).slice(0, 14);
    context.font = '500 20px Arial, sans-serif';
    let chipX = 70; let chipY = skillsTop;
    skills.forEach((skill) => {
      const width = Math.min(250, context.measureText(skill).width + 38);
      if (chipX + width > 1100) { chipX = 70; chipY += 54; }
      if (chipY > 510) return;
      context.fillStyle = '#fff1ea'; context.beginPath(); context.roundRect(chipX, chipY - 29, width, 40, 20); context.fill();
      context.fillStyle = '#b43d20'; context.fillText(skill, chipX + 19, chipY);
      chipX += width + 12;
    });
    context.fillStyle = '#ff9877'; context.font = '700 64px Arial, sans-serif'; context.fillText(String(analysis.overall_score || 0), 70, 610);
    context.font = '700 25px Arial, sans-serif'; context.fillText('/100', 158, 610);
    context.fillStyle = '#8f97a6'; context.font = '400 18px Arial, sans-serif'; context.textAlign = 'right'; context.fillText('Evidence-based resume evaluation', 1125, 607); context.textAlign = 'left';
    const saved = { ...analysis, savedAt: new Date().toISOString() };
    localStorage.setItem(userStorageKey('saved-talent-card'), JSON.stringify(saved));
    const link = document.createElement('a');
    link.download = `LIONS-${String(analysis.name || 'candidate').replace(/[\\/:*?"<>|]/g, '-')}-talent-card.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    toast('Talent card saved as PNG');
  }

  function openInterviewDetails(item) {
    const facts = [
      ['Company', item.company_name], ['Role', item.job_title], ['Round', roundLabel(item.interview_round)],
      ['Format', item.interview_type], ['Time', formatDateTime(item.scheduled_at)], ['Location', item.location || 'Not set'],
      ['Interviewer', item.interviewer || 'Not set'], ['Meeting link', item.meeting_url || 'Not set'],
    ];
    openFlowModal(`${item.company_name} interview`, `<div class="wb-interview-detail"><span class="wb-status-badge wb-status-${itemStatusClass(item)}">${interviewStatusLabel(interviewStatus(item))}</span><div class="wb-detail-grid">${facts.map(([label, value]) => `<div><small>${esc(label)}</small><strong>${esc(value)}</strong></div>`).join('')}</div>${item.notes ? `<div class="wb-detail-notes"><small>NOTES</small><p>${esc(item.notes)}</p></div>` : ''}<div class="wb-modal-actions">${item.meeting_url ? `<button class="wb-btn wb-btn-primary" id="detailJoinInterview">Join meeting</button>` : ''}<button class="wb-btn wb-btn-gradient" id="detailEditInterview">Edit interview</button></div></div>`);
    document.querySelector('#modalContent .modal-kicker').replaceChildren(document.createTextNode('INTERVIEW DETAILS'));
    document.getElementById('detailJoinInterview')?.addEventListener('click', () => window.open(item.meeting_url, '_blank', 'noopener'));
    document.getElementById('detailEditInterview').addEventListener('click', () => interviewForm(item));
  }

  function parseInterviewText(text) {
    const parsed = { company_name: '', job_title: '', scheduled_at: '', interview_round: '', interview_type: 'Video call', meeting_url: '', interviewer: '', notes: '' };
    if (!text) return parsed;
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const lineValue = (keys) => {
      for (const line of lines) {
        const match = line.match(new RegExp(`^(?:${keys})\\s*[:：]\\s*(.+)$`, 'i'));
        if (match && match[1]) return match[1].trim();
      }
      return '';
    };
    parsed.company_name = lineValue('公司|单位|组织|企业|公司名称|company|company\\s?name|organization|org');
    parsed.job_title = lineValue('岗位|职位|应聘|岗位名称|position|role|title|job\\s?title');
    parsed.interviewer = lineValue('面试官|面试人|面试负责人|interviewer');
    parsed.notes = lineValue('备注|说明|注意|补充|notes?|note');
    parsed.interview_type = lineValue('形式|方式|类型|interview\\s?type|type|mode');
    parsed.interview_round = lineValue('轮次|第几轮|面试轮|round');

    const urlMatch = text.match(/https?:\/\/[^\s"'<>）)】]+/i);
    if (urlMatch) parsed.meeting_url = urlMatch[0];

    const dateMatch = text.match(/(20\d{2})\s*[年\/\-.]\s*(\d{1,2})\s*[月\/\-.]\s*(\d{1,2})\s*日?\s*(?:[^0-9]{0,6}(\d{1,2})\s*[:：]\s*(\d{2}))?/) || text.match(/(\d{4})-(\d{1,2})-(\d{1,2})[T\s](\d{1,2}):(\d{2})/);
    if (dateMatch) {
      const date = new Date(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]), dateMatch[4] != null ? Number(dateMatch[4]) : 9, dateMatch[5] != null ? Number(dateMatch[5]) : 0);
      if (!Number.isNaN(date.getTime())) parsed.scheduled_at = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    }

    const type = parsed.interview_type;
    if (/视频|线上|远程|zoom|teams|meet|video|online/i.test(type)) parsed.interview_type = 'Video call';
    else if (/现场|线下|面对面|onsite|on-?site/i.test(type)) parsed.interview_type = 'On-site';
    else if (/电话|phone|telephone/i.test(type)) parsed.interview_type = 'Phone';
    else if (/笔试|测试|take-?home/i.test(type)) parsed.interview_type = 'Take-home review';

    const roundMatch = text.match(/第\s*([0-9一二三四五六七八九十]+)\s*轮/);
    if (roundMatch) {
      const cn = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
      const val = roundMatch[1];
      const num = /^\d+$/.test(val) ? Number(val) : (cn[val] || 1);
      parsed.interview_round = `Round ${num}`;
    } else if (!parsed.interview_round) {
      parsed.interview_round = 'First round';
    }

    return parsed;
  }

  let wbParsed = null;

  function interviewForm(existing) {
    const editing = !!existing;
    const base = existing && existing.scheduled_at ? new Date(existing.scheduled_at) : new Date(Date.now() + 86400000);
    const localDate = new Date(base.getTime() - base.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    wbParsed = {
      company_name: existing?.company_name || '',
      job_title: existing?.job_title || '',
      interview_round: existing?.interview_round || 'First round',
      interview_type: existing?.interview_type || 'Video call',
      scheduled_at: localDate,
      location: existing?.location || '',
      meeting_url: existing?.meeting_url || '',
      interviewer: existing?.interviewer || '',
      notes: existing?.notes || '',
    };
    openFlowModal(editing ? 'Edit interview' : 'Add interview', `
      <div class="wb-interview-modal">
        <div class="wb-modal-steps">
          <div class="wb-modal-step active" data-wb-step="1"><span class="wb-step-count">1</span>Paste invite</div>
          <div class="wb-modal-step" data-wb-step="2"><span class="wb-step-count">2</span>Review</div>
          <div class="wb-modal-step" data-wb-step="3"><span class="wb-step-count">3</span>Details</div>
        </div>
        <div class="wb-modal-step-pane" data-wb-pane="1">
          <p class="wb-form-hint">Paste the interview invitation (company, role, time, meeting link). LIONS will extract the details for you — or skip straight to the form.</p>
          <div class="wb-form-field"><label>Invitation text</label><textarea id="wbPasteText" placeholder="e.g. 字节跳动 · 数据分析实习生 · 2026-09-20 14:00 · 视频面试 · https://meet.example.com/abc"></textarea></div>
          <div class="wb-modal-actions"><button type="button" class="wb-btn wb-btn-ghost" id="wbSkipBtn">Skip to form</button><button type="button" class="wb-btn wb-btn-gradient" id="wbParseBtn">Parse text</button></div>
        </div>
        <div class="wb-modal-step-pane" data-wb-pane="2" hidden>
          <p class="wb-form-hint">Review the extracted details. Anything missing can be fixed on the next step.</p>
          <div class="wb-parse-preview" id="wbParsePreview"></div>
          <div class="wb-modal-actions"><button type="button" class="wb-btn wb-btn-ghost" data-wb-back="1">Back</button><button type="button" class="wb-btn wb-btn-gradient" id="wbContinueBtn">Continue to details</button></div>
        </div>
        <div class="wb-modal-step-pane" data-wb-pane="3" hidden>
          <form id="interviewForm">
            <div class="wb-form-row"><div class="wb-form-field"><label>Company</label><input id="interviewCompany" required placeholder="e.g. Northstar Labs" value="${esc(wbParsed.company_name)}"></div><div class="wb-form-field"><label>Role title</label><input id="interviewJob" required placeholder="e.g. Data Analyst Intern" value="${esc(wbParsed.job_title)}"></div></div>
            <div class="wb-form-row"><div class="wb-form-field"><label>Interview round</label><input id="interviewRound" required value="${esc(wbParsed.interview_round)}"></div><div class="wb-form-field"><label>Type</label><select id="interviewType">${['Video call', 'Phone', 'On-site', 'Take-home review'].map((option) => `<option${option === wbParsed.interview_type ? ' selected' : ''}>${option}</option>`).join('')}</select></div></div>
            <div class="wb-form-field"><label>Date and time</label><input id="interviewDate" type="datetime-local" required value="${esc(wbParsed.scheduled_at)}"></div>
            <div class="wb-form-row"><div class="wb-form-field"><label>Location</label><input id="interviewLocation" placeholder="Zoom / campus room"></div><div class="wb-form-field"><label>Meeting link</label><input id="interviewLink" type="url" placeholder="https://..."></div></div>
            <div class="wb-form-field"><label>Interviewer</label><input id="interviewInterviewer" placeholder="Who will run this interview?"></div>
            <div class="wb-form-field"><label>Notes</label><textarea id="interviewNotes" placeholder="What should you prepare for this stage?"></textarea></div>
          </form>
          <div class="wb-modal-actions"><button type="button" class="wb-btn wb-btn-ghost" data-wb-back="2">Back</button><button type="submit" form="interviewForm" class="wb-btn wb-btn-gradient" id="wbSaveBtn">Save interview</button></div>
        </div>
      </div>
    `);
    document.querySelector('#modalContent .modal-kicker').replaceChildren(document.createTextNode('STUDENT WORKSPACE'));

    const panes = { 1: document.querySelector('[data-wb-pane="1"]'), 2: document.querySelector('[data-wb-pane="2"]'), 3: document.querySelector('[data-wb-pane="3"]') };
    const steps = { 1: document.querySelector('[data-wb-step="1"]'), 2: document.querySelector('[data-wb-step="2"]'), 3: document.querySelector('[data-wb-step="3"]') };
    const showStep = (n) => {
      Object.values(panes).forEach((pane) => { if (pane) pane.hidden = true; });
      Object.values(steps).forEach((step) => step.classList.remove('active'));
      if (panes[n]) panes[n].hidden = false;
      if (steps[n]) steps[n].classList.add('active');
    };

    const renderPreview = () => {
      const rows = [
        ['Company', wbParsed.company_name], ['Role', wbParsed.job_title], ['Time', formatDateTime(wbParsed.scheduled_at)], ['Round', roundLabel(wbParsed.interview_round)], ['Type', wbParsed.interview_type], ['Interviewer', wbParsed.interviewer], ['Link', wbParsed.meeting_url], ['Notes', wbParsed.notes],
      ].filter(([, value]) => value);
      document.getElementById('wbParsePreview').innerHTML = rows.length ? rows.map(([key, value]) => `<div><b>${esc(key)}</b><span>${esc(value)}</span></div>`).join('') : '<div><b>Nothing found</b><span>No details could be extracted — continue to fill the form manually.</span></div>';
    };

    document.getElementById('interviewLocation').value = wbParsed.location || '';
    document.getElementById('interviewLink').value = wbParsed.meeting_url || '';
    document.getElementById('interviewInterviewer').value = wbParsed.interviewer || '';
    document.getElementById('interviewNotes').value = wbParsed.notes || '';

    const syncFormFromParsed = () => {
      document.getElementById('interviewCompany').value = wbParsed.company_name;
      document.getElementById('interviewJob').value = wbParsed.job_title;
      document.getElementById('interviewRound').value = wbParsed.interview_round;
      document.getElementById('interviewType').value = wbParsed.interview_type;
      document.getElementById('interviewDate').value = wbParsed.scheduled_at;
      document.getElementById('interviewLocation').value = wbParsed.location || '';
      document.getElementById('interviewLink').value = wbParsed.meeting_url || '';
      document.getElementById('interviewInterviewer').value = wbParsed.interviewer || '';
      document.getElementById('interviewNotes').value = wbParsed.notes || '';
    };

    document.getElementById('wbSkipBtn').addEventListener('click', () => showStep(3));
    document.getElementById('wbParseBtn').addEventListener('click', () => {
      Object.assign(wbParsed, parseInterviewText(document.getElementById('wbPasteText').value));
      syncFormFromParsed();
      renderPreview();
      showStep(2);
    });
    document.getElementById('wbContinueBtn').addEventListener('click', () => showStep(3));
    document.querySelectorAll('[data-wb-back]').forEach((button) => button.addEventListener('click', () => showStep(Number(button.dataset.wbBack))));

    document.getElementById('interviewForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const saveBtn = document.getElementById('wbSaveBtn');
      saveBtn.disabled = true;
      const fields = {
        company_name: document.getElementById('interviewCompany').value.trim(),
        job_title: document.getElementById('interviewJob').value.trim(),
        interview_round: document.getElementById('interviewRound').value.trim(),
        interview_type: document.getElementById('interviewType').value,
        scheduled_at: new Date(document.getElementById('interviewDate').value).toISOString(),
        location: document.getElementById('interviewLocation').value.trim() || null,
        meeting_url: document.getElementById('interviewLink').value.trim() || null,
        interviewer: document.getElementById('interviewInterviewer').value.trim() || null,
        notes: document.getElementById('interviewNotes').value.trim() || null,
      };
      try {
        const identity = await currentRemoteUser();
        if (editing) { await window.lionsApi.updateInterview(existing.id, { actor_id: identity.id, ...fields }); toast('Interview updated'); }
        else { await window.lionsApi.createInterview({ actor_id: identity.id, student_id: identity.id, ...fields }); toast('Interview added to your schedule'); }
        document.getElementById('modal').classList.remove('open');
        document.querySelector('.candidate-modal').classList.remove('flow-modal');
        renderInterviews();
      } catch (error) { toast(error.message || 'Interview could not be saved'); }
      finally { saveBtn.disabled = false; }
    });
  }

  let interviewTimelineStart = null;
  function renderInterviewTimeline(container, range, interviews, mode = 'week') {
    if (!container) return;
    if (mode === 'list') { container.innerHTML = ''; return; }
    const valid = interviews.filter((item) => item.scheduled_at && !Number.isNaN(new Date(item.scheduled_at).getTime()));
    if (!interviewTimelineStart) interviewTimelineStart = new Date();
    const anchor = new Date(interviewTimelineStart);
    const dayKey = (date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    const today = new Date();

    const wire = () => container.querySelectorAll('[data-timeline-interview]').forEach((button) => button.addEventListener('click', () => {
      const item = valid.find((entry) => String(entry.id) === String(button.dataset.timelineInterview));
      if (item) openInterviewDetails(item);
    }));

    if (mode === 'month') {
      const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
      const monday = new Date(first); monday.setDate(first.getDate() - ((first.getDay() + 6) % 7));
      const days = Array.from({ length: 42 }, (_, index) => { const day = new Date(monday); day.setDate(day.getDate() + index); return day; });
      if (range) range.textContent = anchor.toLocaleDateString(uiLocale(), { month: 'long', year: 'numeric' });
      const cells = days.map((day) => {
        const items = valid.filter((item) => dayKey(new Date(item.scheduled_at)) === dayKey(day));
        const outside = day.getMonth() !== anchor.getMonth();
        const isToday = dayKey(day) === dayKey(today);
        const events = items.map((item) => `<button class="wb-event ${itemStatusClass(item)}" data-timeline-interview="${item.id}"><strong>${esc(item.company_name)}</strong><small>${new Date(item.scheduled_at).toLocaleTimeString(uiLocale(), { hour: '2-digit', minute: '2-digit' })}</small></button>`).join('');
        return `<div class="wb-month-cell${outside ? ' is-outside' : ''}${isToday ? ' is-today' : ''}"><span class="wb-day-num">${day.getDate()}</span>${events}</div>`;
      }).join('');
      container.innerHTML = `<div class="wb-cal-weekdays">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => `<span>${day}</span>`).join('')}</div><div class="wb-month-grid">${cells}</div>`;
      wire();
      return;
    }

    const count = mode === 'day' ? 1 : 7;
    const monday = new Date(anchor); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    const days = Array.from({ length: count }, (_, index) => { const day = new Date(monday); day.setDate(day.getDate() + index); return day; });
    if (range) {
      if (mode === 'day') range.textContent = anchor.toLocaleDateString(uiLocale(), { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
      else range.textContent = `${days[0].toLocaleDateString(uiLocale(), { month: 'short', day: 'numeric' })} – ${days[days.length - 1].toLocaleDateString(uiLocale(), { month: 'short', day: 'numeric', year: 'numeric' })}`;
    }
    const hours = Array.from({ length: 15 }, (_, index) => `<span>${String(index + 8).padStart(2, '0')}:00</span>`).join('');
    const bars = valid.map((item) => {
      const date = new Date(item.scheduled_at);
      const idx = days.findIndex((day) => dayKey(day) === dayKey(date));
      if (idx < 0) return '';
      const startMinutes = date.getHours() * 60 + date.getMinutes();
      const top = Math.max(0, Math.min(98, ((startMinutes - 480) / 900) * 100));
      const left = (idx / count) * 100;
      const width = (1 / count) * 100;
      return `<button class="wb-event-bar ${itemStatusClass(item)}" style="left:${(left + 0.4).toFixed(2)}%;top:${top.toFixed(2)}%;width:${(width - 0.8).toFixed(2)}%" data-timeline-interview="${item.id}"><strong>${esc(item.company_name)}</strong><small>${date.toLocaleTimeString(uiLocale(), { hour: '2-digit', minute: '2-digit' })} · ${esc(item.job_title)}</small></button>`;
    }).join('');

    if (mode === 'day') {
      const isToday = dayKey(anchor) === dayKey(today);
      container.innerHTML = `<div class="wb-day"><div class="wb-week-corner"></div><div class="wb-day-head${isToday ? ' is-today' : ''}"><strong>${anchor.toLocaleDateString(uiLocale(), { weekday: 'long' })}</strong><small>${anchor.toLocaleDateString(uiLocale(), { month: 'short', day: 'numeric' })}</small></div><div class="wb-time-gutter">${hours}</div><div class="wb-day-body">${bars}</div></div>`;
    } else {
      const head = days.map((day) => `<div class="wb-day-col-head${dayKey(day) === dayKey(today) ? ' is-today' : ''}"><strong>${day.toLocaleDateString(uiLocale(), { weekday: 'short' })}</strong><small>${day.toLocaleDateString(uiLocale(), { month: 'numeric', day: 'numeric' })}</small></div>`).join('');
      const cols = days.map(() => '<div class="wb-day-col"></div>').join('');
      container.innerHTML = `<div class="wb-week"><div class="wb-week-corner"></div><div class="wb-week-head">${head}</div><div class="wb-time-gutter">${hours}</div><div class="wb-week-body">${cols}${bars}</div></div>`;
    }
    wire();
  }

  async function renderStudentJobs() {
    const list = document.getElementById('studentJobList');
    try {
      const identity = await currentRemoteUser();
      const [jobs, applications] = await Promise.all([window.lionsApi.listJobs(), window.lionsApi.listApplications({ student_id: identity.id })]);
      const byJob = new Map(applications.map((item) => [item.job_id, item]));
      list.innerHTML = jobs.length ? jobs.map((job) => { const application = byJob.get(job.id); return `<article class="job-card"><span class="offer-badge">${esc(job.company_name)}</span><h3>${esc(job.title)}</h3><small>${esc(job.employment_type)} · ${esc(job.location || 'Remote')}</small><p>${esc(job.description || 'No further job description provided.')}</p><div class="offer-meta"><span>${esc(job.salary || 'Compensation not listed')}</span>${job.skills ? `<span>${esc(job.skills)}</span>` : ''}</div>${application ? `<span class="service-state">Application: ${esc(application.status)}</span>` : `<button type="button" class="save-btn" data-apply-job="${job.id}">Apply now</button>`}</article>`; }).join('') : '<div class="moderation-list-empty">No published jobs are available.</div>';
      list.querySelectorAll('[data-apply-job]').forEach((button) => button.addEventListener('click', async () => { button.disabled = true; try { await window.lionsApi.createApplication({ job_id: Number(button.dataset.applyJob), student_id: identity.id }); toast('Application submitted'); renderStudentJobs(); } catch (error) { toast('Application could not be submitted'); button.disabled = false; } }));
    } catch (error) { renderEmpty(list, 'The job service is unavailable.'); }
  }

  async function renderApplications() {
    const list = document.getElementById('applicationList');
    if (!list || currentUser?.role !== 'teacher') return;
    try {
      const identity = await currentRemoteUser();
      const applications = await window.lionsApi.listApplications({ reviewer_id: identity.id });
      list.innerHTML = applications.length ? applications.map((item) => `<div class="interview-row"><div><strong>${esc(item.candidate_name || 'Student')} · ${esc(item.job_title)}</strong><small>${esc(item.company_name)} · ${esc(item.cover_note || 'No cover note')}</small></div><div class="service-actions"><select data-application-status="${item.id}"><option value="submitted" ${item.status === 'submitted' ? 'selected' : ''}>Submitted</option><option value="reviewing" ${item.status === 'reviewing' ? 'selected' : ''}>Reviewing</option><option value="interview" ${item.status === 'interview' ? 'selected' : ''}>Interview</option><option value="rejected" ${item.status === 'rejected' ? 'selected' : ''}>Rejected</option><option value="accepted" ${item.status === 'accepted' ? 'selected' : ''}>Accepted</option></select></div></div>`).join('') : '<div class="moderation-list-empty">No applications yet.</div>';
      list.querySelectorAll('[data-application-status]').forEach((select) => select.addEventListener('change', async () => { try { await window.lionsApi.updateApplication(select.dataset.applicationStatus, { actor_id: identity.id, status: select.value }); toast('Application status updated'); } catch (error) { toast('Application status could not be updated'); } }));
    } catch (error) { renderEmpty(list, 'The application service is unavailable.'); }
  }

  let moderationTab = 'jobs';
  async function renderModeration() {
    const stats = document.getElementById('moderationStats');
    const list = document.getElementById('moderationList');
    try {
      const admin = await currentRemoteUser();
      const [jobs, offers] = await Promise.all([window.lionsApi.listJobs({ admin_id: admin.id }), window.lionsApi.listOffers({ admin_id: admin.id, include_moderated: true })]);
      const count = (items, predicate) => items.filter(predicate).length;
      stats.innerHTML = [['Total jobs', jobs.length], ['Pending review', count(jobs, (job) => job.status === 'pending_review')], ['Published', count(jobs, (job) => job.status === 'published')], ['Taken down', count(jobs, (job) => job.status === 'taken_down')], ['Flagged jobs', count(jobs, (job) => job.risk_status === 'flagged')], ['Total offers', offers.length]].map(([label, value]) => `<div><span>${esc(label)}</span><strong>${value}</strong></div>`).join('');
      document.querySelectorAll('[data-moderation-tab]').forEach((button) => button.classList.toggle('selected', button.dataset.moderationTab === moderationTab));
      if (moderationTab === 'jobs') {
        list.innerHTML = jobs.length ? jobs.map((job) => `<div class="moderation-row"><div class="moderation-copy"><strong>${esc(job.company_name)} · ${esc(job.title)}</strong><small>${esc(job.employment_type)} · ${esc(job.salary || 'Salary not listed')} · ${esc(job.location || 'Location not listed')}</small><p>${esc(job.status)}${job.moderation_reason ? ` · ${esc(job.moderation_reason)}` : ''}</p></div><div class="moderation-actions"><button class="moderation-state ${job.risk_status === 'flagged' ? 'flagged' : ''}" data-normal-job="${job.id}">${esc(job.risk_status)}</button>${!job.is_deleted && job.status !== 'taken_down' ? `<button data-moderate-job="take_down:${job.id}">Take down</button>` : `<button data-moderate-job="publish:${job.id}">Publish</button>`}${!job.is_deleted ? `<button data-moderate-job="delete:${job.id}">Delete</button>` : ''}</div></div>`).join('') : '<div class="moderation-list-empty">No jobs found.</div>';
        list.querySelectorAll('[data-moderate-job]').forEach((button) => button.addEventListener('click', async () => { const [action, id] = button.dataset.moderateJob.split(':'); button.disabled = true; try { await window.lionsApi.moderateJob(id, { actor_id: admin.id, action, reason: '', risk_status: action === 'delete' ? 'flagged' : 'normal' }); renderModeration(); toast(action === 'take_down' ? 'Job taken down' : action === 'delete' ? 'Job deleted' : 'Job published'); } catch (error) { toast(error.message || 'Job moderation could not be saved'); button.disabled = false; } }));
        list.querySelectorAll('[data-normal-job]').forEach((button) => button.addEventListener('click', async () => { const job = jobs.find((item) => String(item.id) === String(button.dataset.normalJob)); if (!job || job.risk_status === 'normal') return; try { await window.lionsApi.moderateJob(job.id, { actor_id: admin.id, action: 'normal', reason: '', risk_status: 'normal' }); renderModeration(); toast('Risk status marked normal'); } catch (error) { toast(error.message || 'Risk status could not be updated'); } }));
      } else {
        list.innerHTML = offers.length ? offers.map((offer) => `<div class="moderation-row"><div class="moderation-copy"><strong>${esc(offer.company_name)} · ${esc(offer.job_title)}</strong><small>${esc(offer.candidate_name)} · ${esc(offer.salary || 'Salary not listed')} · ${esc(formatRemoteDate(offer.sent_at))}</small><p>${esc(offer.status)}${offer.moderation_reason ? ` · ${esc(offer.moderation_reason)}` : ''}</p></div><div class="moderation-actions"><span class="moderation-state">${offer.is_deleted ? 'deleted' : offer.is_active ? 'active' : 'taken down'}</span>${offer.is_active && !offer.is_deleted ? `<button data-moderate-offer="take_down:${offer.id}">Take down</button>` : `<button data-moderate-offer="restore:${offer.id}">Restore</button>`}${!offer.is_deleted ? `<button data-moderate-offer="delete:${offer.id}">Delete</button>` : ''}</div></div>`).join('') : '<div class="moderation-list-empty">No offers found.</div>';
        list.querySelectorAll('[data-moderate-offer]').forEach((button) => button.addEventListener('click', async () => { const [action, id] = button.dataset.moderateOffer.split(':'); button.disabled = true; try { await window.lionsApi.moderateOffer(id, { actor_id: admin.id, action, reason: '' }); renderModeration(); toast(action === 'take_down' ? 'Offer taken down' : action === 'delete' ? 'Offer deleted' : 'Offer restored'); } catch (error) { toast(error.message || 'Offer moderation could not be saved'); button.disabled = false; } }));
      }
    } catch (error) { renderEmpty(stats, 'The moderation service is unavailable.'); renderEmpty(list, 'No moderation data is available.'); }
  }

  function eligibleOfferCandidates(preselected) {
    const candidates = allCandidates().filter((candidate) => candidate && candidate.name);
    if (preselected && !candidates.some((candidate) => String(candidate.id) === String(preselected.id))) candidates.unshift(preselected);
    return candidates;
  }

  async function ensureBackendCandidate(candidate) {
    if (!candidate) throw new Error('Candidate is required');
    if (candidate.backendCandidateId || candidate.apiCandidateId) return candidate;
    if (!window.lionsApi?.createCandidate) throw new Error('Candidate service unavailable');
    const skills = [
      ...(candidate.resumeTags || []),
      ...(candidate.projectTags || []),
      ...(candidate.proofs || []),
    ].filter(Boolean);
    const created = await window.lionsApi.createCandidate({
      name: candidate.name,
      education: candidate.role || '',
      location: candidate.school || candidate.detail || '',
      summary: candidate.bio || '',
      skills: [...new Set(skills)],
    });
    candidate.backendCandidateId = created.id;
    candidate.apiCandidateId = created.id;
    const submissions = JSON.parse(localStorage.getItem('lions-submissions') || '[]');
    const stored = submissions.find((item) => String(item.id) === String(candidate.id));
    if (stored) {
      stored.backendCandidateId = created.id;
      stored.apiCandidateId = created.id;
      localStorage.setItem('lions-submissions', JSON.stringify(submissions));
    }
    return candidate;
  }

  function offerForm(preselectedCandidate) {
    const company = currentUser?.org || currentUser?.school || 'Northstar Labs';
    const candidates = eligibleOfferCandidates(preselectedCandidate);
    if (!candidates.length) { toast('No published student profiles are connected to the Offer database yet.'); return; }
    openFlowModal('Send an offer', `<form class="offer-form" id="offerForm">
      <label>Candidate<select id="offerCandidate" required>${candidates.map((candidate) => `<option value="${esc(candidate.id)}" ${String(candidate.id) === String(preselectedCandidate?.id) ? 'selected' : ''}>${esc(candidate.name)} · ${esc(candidate.school || candidate.detail || 'Student')}</option>`).join('')}</select></label>
      <div class="offer-grid"><label>Company<input id="offerCompany" required value="${esc(company)}"></label><label>Role title<input id="offerTitle" required placeholder="e.g. Junior Data Analyst"></label></div>
      <div class="offer-grid"><label>Offer type<select id="offerType"><option>Full-time</option><option>Part-time</option><option>Internship</option><option>Project contract</option></select></label><label>Location<input id="offerLocation" required placeholder="Hong Kong · Hybrid"></label></div>
      <div class="offer-grid"><label>Compensation<input id="offerCompensation" required placeholder="e.g. HK$18,000 / month"></label><label>Application deadline<input id="offerDeadline" type="date"></label></div>
      <label>Skills sought<input id="offerSkills" placeholder="Python, SQL, data analysis"></label>
      <label>Offer details<textarea id="offerDetails" required placeholder="Describe the role, responsibilities and what the student will work on."></textarea></label>
      <button class="save-btn" type="submit">Publish offer</button>
      <div id="reviewerOfferHistory"></div>
    </form>`);
    loadReviewerOffers().then((offers) => renderReviewerOfferHistory(document.getElementById('reviewerOfferHistory'), offers));
    document.getElementById('offerForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = event.currentTarget.querySelector('[type=submit]');
      button.disabled = true;
      try {
        const identity = await resolveOfferIdentity();
        const selectedId = document.getElementById('offerCandidate').value;
        const selectedCandidate = candidates.find((candidate) => String(candidate.id) === String(selectedId));
        const syncedCandidate = await ensureBackendCandidate(selectedCandidate);
        const created = await window.lionsApi.createOffer({
          candidate_id: Number(syncedCandidate.backendCandidateId || syncedCandidate.apiCandidateId), reviewer_id: identity.id,
          company_name: document.getElementById('offerCompany').value.trim(), job_title: document.getElementById('offerTitle').value.trim(),
          employment_type: document.getElementById('offerType').value, location: document.getElementById('offerLocation').value.trim(),
          salary: document.getElementById('offerCompensation').value.trim(), deadline: document.getElementById('offerDeadline').value,
          skills: document.getElementById('offerSkills').value.trim(), message: document.getElementById('offerDetails').value.trim(),
        });
        remoteOffers = [apiOfferToUi(created), ...remoteOffers];
        offerApiOnline = true;
        renderReviewerOfferHistory(document.getElementById('reviewerOfferHistory'), await loadReviewerOffers());
        event.currentTarget.reset();
        toast('Offer sent to the selected student');
      } catch (error) {
        toast(error.message || 'Offer could not be sent. Start the API and ensure the student has published a profile.');
      } finally { button.disabled = false; }
    });
  }

  function jobForm() {
    const company = currentUser?.org || currentUser?.school || 'Northstar Labs';
    openFlowModal('Publish a job', `<form class="offer-form" id="jobForm"><div class="offer-grid"><label>Company<input id="jobCompany" required value="${esc(company)}"></label><label>Role title<input id="jobTitle" required placeholder="e.g. Junior Data Analyst"></label></div><div class="offer-grid"><label>Employment type<select id="jobType"><option>Full-time</option><option>Part-time</option><option>Internship</option><option>Project contract</option></select></label><label>Location<input id="jobLocation" placeholder="Hong Kong · Hybrid"></label></div><div class="offer-grid"><label>Salary range<input id="jobSalary" placeholder="e.g. HK$18,000 / month"></label><label>Skills<input id="jobSkills" placeholder="Python, SQL, data analysis"></label></div><label>Job description<textarea id="jobDescription" required placeholder="Describe responsibilities, outcomes and hiring criteria."></textarea></label><button class="save-btn" type="submit">Submit for review</button><p class="auth-hint">New jobs are reviewed by the LIONS administration team before students can see them.</p></form>`);
    document.getElementById('jobForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = event.currentTarget.querySelector('[type=submit]'); button.disabled = true;
      try {
        await window.lionsApi.createJob({ company_name: document.getElementById('jobCompany').value.trim(), title: document.getElementById('jobTitle').value.trim(), employment_type: document.getElementById('jobType').value, location: document.getElementById('jobLocation').value.trim(), salary: document.getElementById('jobSalary').value.trim(), skills: document.getElementById('jobSkills').value.trim(), description: document.getElementById('jobDescription').value.trim(), status: 'pending_review' });
        document.getElementById('modal').classList.remove('open'); toast('Job submitted for administrator review');
      } catch (error) { toast('Job could not be submitted'); button.disabled = false; }
    });
  }

  function openOffer(offer) {
    openFlowModal(offer.title, `<span class="offer-badge">${esc(offer.company)} · ${esc(offer.type)}</span><div class="contact-grid"><div class="contact-item"><small>Location</small><strong>${esc(offer.location)}</strong></div><div class="contact-item"><small>Compensation</small><strong>${esc(offer.compensation)}</strong></div></div><div class="candidate-analysis"><div class="analysis-title"><span>OFFER DETAILS</span><small>${offer.deadline ? `Apply by ${esc(offer.deadline)}` : 'Open until filled'}</small></div><p>${esc(offer.details)}</p></div>${offer.skills ? `<div class="offer-meta"><span>${esc(offer.skills)}</span></div>` : ''}<button class="save-btn" onclick="document.getElementById('modal').classList.remove('open')">Close</button>`);
  }

  async function renderRecommendedOffers() {
    const list = document.getElementById('studentOfferList');
    if (!list || currentUser?.role !== 'student') return;
    const now = new Date().toISOString().slice(0, 10);
    const offers = (await loadStudentOffers()).filter((offer) => offer.active !== false && (!offer.deadline || offer.deadline >= now)).slice(0, 4);
    list.innerHTML = offers.length ? offers.map((offer) => `<article class="offer-card"><span class="offer-badge">${esc(offer.company)}</span><strong>${esc(offer.title)}</strong><small>${esc(offer.type)} · ${esc(offer.location)}</small><p>${esc(offer.details.slice(0, 120))}${offer.details.length > 120 ? '...' : ''}</p><div class="offer-meta"><span>${esc(offer.compensation)}</span>${offer.skills ? `<span>${esc(offer.skills)}</span>` : ''}</div><button type="button" data-offer-id="${esc(offer.id)}">View offer</button></article>`).join('') : '<div class="offer-empty">No recommended offers yet.</div>';
    list.querySelectorAll('[data-offer-id]').forEach((button) => button.addEventListener('click', () => {
      const offer = offers.find((item) => item.id === button.dataset.offerId);
      if (offer) openOffer(offer);
    }));
  }

  function offerStatus(offer) { return ({ draft: 'Draft', sent: 'Pending', accepted: 'Accepted', rejected: 'Rejected' })[offer.status] || 'Pending'; }

  function renderOfferDetail(offer) {
    const panel = document.getElementById('offerDetailPanel');
    if (!panel || !offer) return;
    const actions = offer.remote && offer.status === 'sent' ? `<div class="offer-response-actions"><button type="button" class="save-btn" data-offer-response="accepted">Accept</button><button type="button" class="outline-btn" data-offer-response="rejected">Reject</button></div>` : `<div class="offer-meta"><span>${offerStatus(offer)}</span></div>`;
    panel.innerHTML = `<div class="offer-detail-head"><span class="offer-badge">${esc(offer.company)}</span><h2>${esc(offer.title)}</h2><p>${esc(offer.type)} · ${esc(offer.location)}</p></div><div class="offer-detail-facts"><div><small>COMPENSATION</small><strong>${esc(offer.compensation)}</strong></div><div><small>SENT AT</small><strong>${offer.sentAt ? esc(new Date(offer.sentAt).toLocaleDateString(uiLocale())) : '—'}</strong></div></div><div class="offer-detail-copy"><span class="section-index">ROLE DETAILS</span><p>${esc(offer.details)}</p>${offer.skills ? `<div class="offer-detail-skills"><strong>Skills sought</strong><div class="offer-meta"><span>${esc(offer.skills)}</span></div></div>` : ''}${offer.reviewerName ? `<p><strong>Reviewer:</strong> ${esc(offer.reviewerName)}</p>` : ''}</div>${actions}`;
    panel.querySelectorAll('[data-offer-response]').forEach((button) => button.addEventListener('click', async () => {
      try {
        const identity = await resolveOfferIdentity();
        const updated = await window.lionsApi.updateOffer(offer.id, { actor_id: identity.id, status: button.dataset.offerResponse });
        const next = apiOfferToUi(updated);
        remoteOffers = remoteOffers.map((item) => item.id === next.id ? next : item);
        renderOfferDetail(next); renderOffersPage(); renderRecommendedOffers();
        toast(next.status === 'accepted' ? 'Offer accepted' : 'Offer rejected');
      } catch (error) { toast('Offer status could not be updated'); }
    }));
  }

  async function renderOffersPage() {
    const list = document.getElementById('offersPageList');
    if (!list || currentUser?.role !== 'student') return;
    const now = new Date().toISOString().slice(0, 10);
    const query = document.getElementById('offersSearch')?.value.trim().toLowerCase() || '';
    const type = document.getElementById('offersTypeFilter')?.value || '';
    const location = document.getElementById('offersLocationFilter')?.value || '';
    const allOffers = await loadStudentOffers();
    const offers = allOffers.filter((offer) => {
      if (offer.active === false || (offer.deadline && offer.deadline < now)) return false;
      const haystack = [offer.title, offer.company, offer.skills, offer.details, offer.location].join(' ').toLowerCase();
      return (!query || haystack.includes(query)) && (!type || offer.type === type) && (!location || offer.location === location);
    });
    document.getElementById('offersCount').textContent = `${offers.length} offer${offers.length === 1 ? '' : 's'}`;
    const locationSelect = document.getElementById('offersLocationFilter');
    const selectedLocation = locationSelect.value;
    const locations = [...new Set(allOffers.filter((offer) => offer.active !== false).map((offer) => offer.location).filter(Boolean))];
    locationSelect.innerHTML = `<option value="">All locations</option>${locations.map((item) => `<option value="${esc(item)}">${esc(item)}</option>`).join('')}`;
    locationSelect.value = locations.includes(selectedLocation) ? selectedLocation : '';
    list.innerHTML = offers.length ? offers.map((offer, index) => `<button type="button" class="offer-listing ${index === 0 ? 'selected' : ''}" data-page-offer="${esc(offer.id)}"><span class="listing-mark">${esc((offer.company || 'O').slice(0, 1).toUpperCase())}</span><span class="listing-copy"><strong>${esc(offer.title)}</strong><small>${esc(offer.company)} · ${esc(offer.location)}</small><span>${esc(offer.compensation)} · ${esc(offer.type)}</span></span><span class="listing-arrow">›</span></button>`).join('') : '<div class="offer-page-empty"><strong>No offers match your search</strong><p>Try clearing a filter or check back after companies publish new opportunities.</p></div>';
    list.querySelectorAll('[data-page-offer]').forEach((button) => button.addEventListener('click', () => {
      list.querySelectorAll('.offer-listing').forEach((item) => item.classList.remove('selected'));
      button.classList.add('selected');
      renderOfferDetail(offers.find((offer) => offer.id === button.dataset.pageOffer));
    }));
    if (offers[0]) renderOfferDetail(offers[0]);
  }

  function returnToLogin() {
    if (window.lionsAuth?.logout) {
      window.lionsAuth.logout();
      return;
    }
    localStorage.removeItem('lions-session');
    sessionStorage.removeItem(SESSION_KEY);
    activeVaultKey = null; currentUser = null;
    document.getElementById('authForm').reset();
    setAuthMode('login');
    document.getElementById('authScreen').classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  window.lionsSetActiveUser = function (user, key) {
    activeVaultKey = key || null;
    currentUser = user;
    applyRole(user);
  };

  window.lionsClearActiveUser = function () {
    activeVaultKey = null;
    activeResumeMeta = null;
    activeResumeAnalysis = null;
    activeProjectAnalyses = {};
    currentUser = null;
  };

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
    document.getElementById('applicationsNav').classList.toggle('hidden', !isTeacher);
    document.getElementById('newJob').classList.toggle('hidden', !isTeacher);
    document.getElementById('talentNav').classList.toggle('hidden', isStudent);
    document.getElementById('studentNav').classList.toggle('hidden', !isStudent);
    document.getElementById('studentDashboardNav').classList.toggle('hidden', !isStudent);
    document.getElementById('resumeNav').classList.toggle('hidden', !isStudent);
    document.getElementById('resumeAnalysisNav').classList.add('hidden');
    document.getElementById('offersNav').classList.toggle('hidden', !isStudent);
    document.getElementById('interviewsNav').classList.toggle('hidden', !isStudent);
    document.getElementById('jobsNav').classList.toggle('hidden', !isStudent);
    document.getElementById('adminNav').classList.toggle('hidden', !isAdmin);
    document.getElementById('adminModerationNav').classList.toggle('hidden', !isAdmin);
    document.getElementById('mobileOverview').classList.toggle('hidden', !isTeacher);
    document.getElementById('mobileTalent').classList.toggle('hidden', isStudent);
    document.getElementById('mobileSubmit').classList.toggle('hidden', !isStudent);
    document.getElementById('mobileOffers').classList.toggle('hidden', !isStudent);
    document.getElementById('mobileAdmin').classList.toggle('hidden', !isAdmin);
    document.getElementById('profileNav').classList.remove('hidden');
    document.getElementById('mobileProfile').classList.remove('hidden');
    populateProfile();
    syncPublishedProfile();
    if (isStudent) {
      renderRecommendedOffers();
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
      const proofs = candidate.proofs || [];
      const haystack = [candidate.name, candidate.role, candidate.detail, candidate.bio, ...proofs, ...(candidate.evidence || []).flat(), candidate.school, candidate.graduationYear, candidate.availability].join(' ').toLowerCase();
      return (!filters.query || haystack.includes(filters.query))
        && (!filters.skill || proofs.some((proof) => proof.toLowerCase().includes(filters.skill)))
        && (!filters.field || candidate.role.toLowerCase() === filters.field)
        && (!filters.school || candidate.school?.toLowerCase() === filters.school)
        && (!filters.year || String(candidate.graduationYear) === filters.year)
        && (!filters.availability || candidate.availability?.toLowerCase() === filters.availability)
        && (!shortlistOnly || shortlist.has(candidate.id));
    });
    results.sort((a, b) => filters.sort === 'recent' ? b.recent - a.recent : filters.sort === 'coverage' ? b.coverage - a.coverage : b.score - a.score);
    document.getElementById('poolResultCount').textContent = results.length;
    document.getElementById('talentList').innerHTML = results.length ? results.map((candidate) => {
      const proofs = uniqueText(candidate.proofs || []);
      const visibleProofs = proofs.slice(0, 4);
      const avatarStyle = candidate.avatar ? `background-image:url('${esc(candidate.avatar)}')` : '';
      const saved = shortlist.has(candidate.id);
      const tone = Array.from(String(candidate.id || candidate.name)).reduce((sum, char) => sum + char.charCodeAt(0), 0) % 3;
      return `<article class="talent-card tone-${tone}">
        <div class="talent-card-top"><span class="candidate-avatar ${candidate.avatar ? 'avatar-img' : ''}" style="${avatarStyle}">${esc(candidate.initials)}</span><div class="talent-identity"><strong>${esc(candidate.name)}</strong><small>${esc(candidate.role)} · ${esc(candidate.school || candidate.detail || 'Student')}</small></div><div class="match-badge"><strong>${esc(candidate.score)}</strong><small>MATCH</small></div></div>
        <p class="talent-bio">${esc(candidate.bio || 'No personal overview shared.')}</p>
        <div class="talent-proof-block"><small>CORE SKILLS</small><div class="talent-tags">${visibleProofs.map((proof) => `<span>${esc(proof)}</span>`).join('') || '<span>Profile evidence</span>'}${proofs.length > visibleProofs.length ? `<span class="talent-more-tag">+${proofs.length - visibleProofs.length}</span>` : ''}</div></div>
        <div class="talent-coverage"><div><span>Evidence coverage</span><strong>${esc(candidate.coverage)}%</strong></div><i><b style="width:${Math.max(0, Math.min(100, Number(candidate.coverage) || 0))}%"></b></i></div>
        <div class="talent-meta"><span>Evidence verified</span><span>Active ${esc(candidate.recent)}d ago</span></div>
        <div class="talent-actions"><button class="view-profile" data-view="${esc(candidate.id)}">View evidence</button><button class="shortlist-btn ${saved ? 'saved' : ''}" data-shortlist="${esc(candidate.id)}">${saved ? 'Saved' : 'Save'}</button></div>
      </article>`;
    }).join('') : '<div class="pool-empty"><strong>No matching profiles</strong><p>Try another skill or clear the active filters.</p></div>';
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
    document.getElementById('modalContent').innerHTML = `<div class="public-profile-head"><span class="modal-avatar ${profile.avatar ? 'avatar-img' : ''}" style="${avatarStyle}">${esc(initials(profile.name))}</span><div><div class="modal-kicker">REVIEWER PROFILE</div><div class="modal-name">${esc(profile.name)}</div><div class="modal-role">Reviewer</div></div></div><section class="public-information"><span>PERSONAL INFORMATION</span><div class="public-profile-facts">${information.map(([label, value]) => `<div><small>${esc(label)}</small><strong>${esc(value)}</strong></div>`).join('')}</div></section>`;
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
      return `<article class="request-row"><div><button class="request-profile" data-teacher-profile="${esc(request.id)}" title="View ${esc(profile.name)} profile"><span class="request-avatar ${profile.avatar ? 'avatar-img' : ''}" style="${avatarStyle}">${esc(initials(profile.name))}</span><span><strong>${esc(profile.name)}</strong><small>${esc(profile.org || 'Reviewer workspace')}</small></span></button><p>${request.status === 'approved' ? 'Application sent · this reviewer can view your resume' : request.status === 'declined' ? 'Request declined' : 'Invited you to apply and share your original resume'}</p></div><div class="request-actions">${request.status === 'pending' ? `<button data-request-decision="approved:${esc(request.id)}">Apply & share resume</button><button class="decline" data-request-decision="declined:${esc(request.id)}">Decline</button>` : `<span class="request-state ${esc(request.status)}">${request.status}</span>`}</div></article>`;
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
      toast(status === 'approved' ? 'Application sent. Resume access granted to this reviewer.' : 'Application request declined');
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
    if (currentUser?.role === 'teacher' && (candidate.backendCandidateId || candidate.apiCandidateId)) {
      const sendButton = document.createElement('button');
      sendButton.type = 'button'; sendButton.className = 'outline-btn'; sendButton.textContent = 'Send offer';
      sendButton.addEventListener('click', () => offerForm(candidate));
      document.querySelector('[data-modal-save]').insertAdjacentElement('afterend', sendButton);
    }
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
    await syncStudentOfferRecipient(submission);
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

    document.querySelectorAll('input[name="authRole"]').forEach((radio) => radio.addEventListener('change', updateAdminCodeVisibility));

    const logout = document.getElementById('logoutBtn');
    logout.addEventListener('click', () => window.lionsAuth?.logout());

    document.getElementById('workspaceBack').addEventListener('click', returnToLogin);
    document.getElementById('sendOffer').addEventListener('click', async () => {
      await window.lionsSyncCandidates?.();
      offerForm();
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
    document.getElementById('adminModerationNav').addEventListener('click', () => showWorkspace('moderation'));
    document.getElementById('studentDashboardNav').addEventListener('click', () => showWorkspace('studentDashboard'));
    document.getElementById('resumeNav').addEventListener('click', () => showWorkspace('resume'));
    document.getElementById('resumeAnalysisNav').addEventListener('click', () => showWorkspace('resumeAnalysis'));
    document.getElementById('interviewsNav').addEventListener('click', () => showWorkspace('interviews'));
    document.getElementById('jobsNav').addEventListener('click', () => showWorkspace('jobs'));
    const resumeEditButton = document.createElement('button');
    resumeEditButton.type = 'button';
    resumeEditButton.className = 'wb-btn wb-btn-ghost';
    resumeEditButton.id = 'editResumes';
    resumeEditButton.textContent = 'Manage resumes';
    document.querySelector('.resume-manager-actions').prepend(resumeEditButton);
    resumeEditButton.addEventListener('click', () => {
      resumeEditMode = !resumeEditMode;
      selectedResumeIds.clear();
      document.getElementById('resumeDetail').classList.add('hidden');
      renderRemoteResumes();
    });
    const resumeUploadDialog = document.getElementById('resumeUploadDialog');
    const resumeUploadBack = document.createElement('button');
    resumeUploadBack.type = 'button';
    resumeUploadBack.className = 'resume-upload-back';
    resumeUploadBack.setAttribute('aria-label', 'Back to resume management');
    resumeUploadBack.textContent = '←';
    resumeUploadDialog.prepend(resumeUploadBack);
    document.getElementById('resumeUploadMount').appendChild(resumeUploadDialog);
    resumeUploadDialog.classList.remove('hidden');
    document.getElementById('resumeUploadBtn').innerHTML = 'Upload and build my card <span>→</span>';
    resumeUploadBack.addEventListener('click', () => showWorkspace('resume'));
    const syncResumeFileState = () => {
      const input = document.getElementById('remoteResumeInput');
      const drop = document.getElementById('resumeDropzone');
      const file = input.files?.[0];
      drop.classList.toggle('has-file', !!file);
      if (file) {
        document.getElementById('resumeFileSelectedName').textContent = file.name;
        document.getElementById('resumeFileSelectedSize').textContent = `${Math.ceil(file.size / 1024)} KB`;
      }
    };
    document.getElementById('remoteResumeInput').addEventListener('change', syncResumeFileState);
    document.getElementById('resumeFileRemove').addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      document.getElementById('remoteResumeInput').value = '';
      syncResumeFileState();
    });
    const resumeDropzone = document.getElementById('resumeDropzone');
    ['dragenter', 'dragover'].forEach((type) => resumeDropzone.addEventListener(type, (event) => { event.preventDefault(); resumeDropzone.classList.add('is-dragover'); }));
    ['dragleave', 'drop'].forEach((type) => resumeDropzone.addEventListener(type, (event) => { event.preventDefault(); resumeDropzone.classList.remove('is-dragover'); }));
    resumeDropzone.addEventListener('drop', (event) => {
      const file = event.dataTransfer?.files?.[0];
      if (!file) return;
      const input = document.getElementById('remoteResumeInput');
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      syncResumeFileState();
    });
    document.getElementById('remoteResumeForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const input = document.getElementById('remoteResumeInput');
      const file = input.files?.[0];
      if (!file) { toast('Choose a resume file first'); return; }
      const button = document.getElementById('resumeUploadBtn');
      button.disabled = true;
      button.textContent = 'Uploading...';
      let identity;
      let created;
      try {
        identity = await currentRemoteUser();
        created = await window.lionsApi.uploadResume(identity.id, identity.id, file);
      } catch (error) {
        toast(error.message || 'Resume upload failed');
        button.disabled = false;
        button.innerHTML = 'Upload and build my card <span>→</span>';
        return;
      }
      button.textContent = 'Analyzing resume...';
      try {
        await window.lionsApi.analyzeResume(created.id, identity.id);
        toast('Resume uploaded and analyzed');
      } catch (error) {
        toast('Resume uploaded. Analysis can be retried from resume management.');
      } finally {
        input.value = '';
        syncResumeFileState();
        showWorkspace('resume');
        await renderRemoteResumes();
        await openResumeReport(created.id);
        button.disabled = false;
        button.innerHTML = 'Upload and build my card <span>→</span>';
      }
    });
    document.getElementById('openResumeUpload').addEventListener('click', () => showWorkspace('resumeUpload'));
    document.getElementById('makeTalentCard').addEventListener('click', async () => {
      try {
        const identity = await currentRemoteUser();
        const resumes = await window.lionsApi.listResumes(identity.id, identity.id);
        const analyzedResume = resumes.find((resume) => resume.status === 'analyzed');
        if (!analyzedResume) { toast('Upload and analyze a resume first'); return; }
        openTalentCard(await window.lionsApi.getResumeAnalysis(analyzedResume.id, identity.id));
      } catch (error) { toast(error.message || 'Analyze a resume before generating the card'); }
    });
    window.interviewViewMode = 'week';
    document.querySelectorAll('[data-interview-view]').forEach((button) => button.addEventListener('click', () => { window.interviewViewMode = button.dataset.interviewView; document.querySelectorAll('[data-interview-view]').forEach((tab) => tab.classList.toggle('active', tab === button)); renderInterviews(); }));
    document.getElementById('addInterview').addEventListener('click', () => interviewForm());
    document.getElementById('timelinePrevious').addEventListener('click', () => { interviewTimelineStart = new Date(interviewTimelineStart || new Date()); interviewTimelineStart.setDate(interviewTimelineStart.getDate() - (window.interviewViewMode === 'month' ? 35 : window.interviewViewMode === 'day' ? 1 : 7)); renderInterviews(); });
    document.getElementById('timelineNext').addEventListener('click', () => { interviewTimelineStart = new Date(interviewTimelineStart || new Date()); interviewTimelineStart.setDate(interviewTimelineStart.getDate() + (window.interviewViewMode === 'month' ? 35 : window.interviewViewMode === 'day' ? 1 : 7)); renderInterviews(); });
    document.getElementById('timelineToday').addEventListener('click', () => { interviewTimelineStart = new Date(); renderInterviews(); });
    document.getElementById('newJob').addEventListener('click', jobForm);
    document.getElementById('applicationsNav').addEventListener('click', () => showWorkspace('applications'));
    document.getElementById('offersNav').addEventListener('click', () => showWorkspace('offers'));
    document.getElementById('mobileOffers').addEventListener('click', () => showWorkspace('offers'));
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
    document.getElementById('offersSearch').addEventListener('input', renderOffersPage);
    document.getElementById('offersTypeFilter').addEventListener('change', renderOffersPage);
    document.getElementById('offersLocationFilter').addEventListener('change', renderOffersPage);
    document.getElementById('clearOfferFilters').addEventListener('click', () => {
      document.getElementById('offersSearch').value = '';
      document.getElementById('offersTypeFilter').value = '';
      document.getElementById('offersLocationFilter').value = '';
      renderOffersPage();
    });
    window.addEventListener('storage', (event) => {
      if (event.key === REQUEST_KEY && currentUser?.role === 'student') renderStudentRequests();
      if (event.key === 'lions-submissions' && currentUser && currentUser.role !== 'student') renderTalentPool();
      if (event.key === OFFER_KEY && currentUser?.role === 'student') { renderRecommendedOffers(); renderOffersPage(); }
    });
    window.addEventListener('lions-language-change', () => {
      if (!currentUser) return;
      renderCandidates();
      renderRubric();
      renderShortlistSummary();
      if (document.getElementById('talentView')?.classList.contains('active')) renderTalentPool();
      if (document.getElementById('assessmentView')?.classList.contains('active')) renderAssessments();
      if (document.getElementById('studentView')?.classList.contains('active')) { renderProjects(); renderStudentRequests(); renderRecommendedOffers(); }
      if (document.getElementById('studentDashboardView')?.classList.contains('active')) renderStudentDashboard();
      if (document.getElementById('resumeView')?.classList.contains('active')) renderRemoteResumes();
      if (document.getElementById('interviewsView')?.classList.contains('active')) renderInterviews();
      if (document.getElementById('jobsView')?.classList.contains('active')) renderStudentJobs();
      if (document.getElementById('applicationsView')?.classList.contains('active')) renderApplications();
      if (document.getElementById('offersView')?.classList.contains('active')) { renderOffersPage(); renderRecommendedOffers(); }
      if (document.getElementById('adminView')?.classList.contains('active')) renderAdmin();
      if (document.getElementById('adminModerationView')?.classList.contains('active')) renderModeration();
    });
    document.getElementById('clearFilters').addEventListener('click', () => {
      ['schoolFilter', 'yearFilter', 'availabilityFilter'].forEach((id) => { document.getElementById(id).value = ''; });
      renderTalentPool();
    });

    candidates.forEach((candidate) => Object.assign(candidate, decorateCandidate(candidate)));
    if (window.__lionsBootstrapAuth) {
      const bootstrapAuth = window.__lionsBootstrapAuth;
      delete window.__lionsBootstrapAuth;
      activeVaultKey = bootstrapAuth.key;
      currentUser = bootstrapAuth.user;
      applyRole(currentUser);
    } else {
      currentUser = null;
      document.getElementById('authScreen')?.classList.remove('hidden');
    }
  }

  window.lionsProfileReady = initialize().catch((error) => {
    console.error('LIONS secure profile initialization failed', error);
    const hint = document.getElementById('authHint');
    if (hint) hint.textContent = 'The secure profile service could not start in this browser.';
  });
}());
