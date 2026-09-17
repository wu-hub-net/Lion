(function () {
  'use strict';

  const baseUrl = (window.LIONS_API_BASE_URL || 'http://127.0.0.1:8000/api').replace(/\/$/, '');

  async function request(path, options) {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
      ...options,
    });
    if (!response.ok) {
      let detail = '';
      try { const body = await response.json(); detail = body.detail || body.error || ''; } catch (error) { /* non-JSON error */ }
      throw new Error(detail || `LIONS API request failed: ${response.status}`);
    }
    return response.status === 204 ? null : response.json();
  }

  function queryPath(path, filters) {
    const query = new URLSearchParams(Object.entries(filters || {}).filter(([, value]) => value !== undefined && value !== null && value !== ''));
    return `${path}${query.size ? `?${query}` : ''}`;
  }

  window.lionsApi = {
    baseUrl,
    health: () => request('/health'),
    listCandidates: () => request('/candidates'),
    getCandidate: (id) => request(`/candidates/${id}`),
    createCandidate: (candidate) => request('/candidates', { method: 'POST', body: JSON.stringify(candidate) }),
    updateCandidate: (id, candidate) => request(`/candidates/${id}`, { method: 'PUT', body: JSON.stringify(candidate) }),
    deleteCandidate: (id) => request(`/candidates/${id}`, { method: 'DELETE' }),
    listSkills: () => request('/skills'),
    resolveOfferIdentity: (identity) => request('/offers/identities', { method: 'POST', body: JSON.stringify(identity) }),
    resolveStudentOfferRecipient: (student) => request('/offers/students/resolve', { method: 'POST', body: JSON.stringify(student) }),
    listOffers: (filters = {}) => request(queryPath('/offers', filters)),
    getOffer: (id) => request(`/offers/${id}`),
    createOffer: (offer) => request('/offers', { method: 'POST', body: JSON.stringify(offer) }),
    updateOffer: (id, offer) => request(`/offers/${id}`, { method: 'PUT', body: JSON.stringify(offer) }),
    deleteOffer: (id, actorId) => request(`/offers/${id}?actor_id=${encodeURIComponent(actorId)}`, { method: 'DELETE' }),
    moderateOffer: (id, moderation) => request(`/offers/${id}/moderate`, { method: 'PUT', body: JSON.stringify(moderation) }),
    listJobs: (filters = {}) => request(queryPath('/jobs', filters)),
    getJob: (id, filters = {}) => request(queryPath(`/jobs/${id}`, filters)),
    createJob: (job) => request('/jobs', { method: 'POST', body: JSON.stringify(job) }),
    updateJob: (id, job) => request(`/jobs/${id}`, { method: 'PUT', body: JSON.stringify(job) }),
    moderateJob: (id, moderation) => request(`/jobs/${id}/moderate`, { method: 'PUT', body: JSON.stringify(moderation) }),
    deleteJob: (id, actorId) => request(`/jobs/${id}?actor_id=${encodeURIComponent(actorId)}`, { method: 'DELETE' }),
    listApplications: (filters = {}) => request(queryPath('/applications', filters)),
    createApplication: (application) => request('/applications', { method: 'POST', body: JSON.stringify(application) }),
    updateApplication: (id, application) => request(`/applications/${id}`, { method: 'PUT', body: JSON.stringify(application) }),
    listResumes: (studentId, actorId) => request(queryPath('/resumes', { student_id: studentId, actor_id: actorId })),
    getResume: (id, actorId) => request(queryPath(`/resumes/${id}`, { actor_id: actorId })),
    uploadResume: (studentId, actorId, file) => {
      const body = new FormData(); body.append('student_id', studentId); body.append('actor_id', actorId); body.append('file', file);
      return fetch(`${baseUrl}/resumes`, { method: 'POST', body }).then(async (response) => {
        if (!response.ok) { let detail = ''; try { const body = await response.json(); detail = body.detail || body.error || ''; } catch (error) { /* non-JSON error */ } throw new Error(detail || `LIONS API request failed: ${response.status}`); }
        return response.json();
      });
    },
    analyzeResume: (id, actorId) => request(queryPath(`/resumes/${id}/analyze`, { actor_id: actorId }), { method: 'POST' }),
    getResumeAnalysis: (id, actorId) => request(queryPath(`/resumes/${id}/analysis`, { actor_id: actorId })),
    deleteResume: (id, actorId) => request(queryPath(`/resumes/${id}`, { actor_id: actorId }), { method: 'DELETE' }),
    resumeDownloadUrl: (id, actorId) => `${baseUrl}/resumes/${id}/download?actor_id=${encodeURIComponent(actorId)}`,
    listInterviews: (filters = {}) => request(queryPath('/interviews', filters)),
    createInterview: (interview) => request('/interviews', { method: 'POST', body: JSON.stringify(interview) }),
    updateInterview: (id, interview) => request(`/interviews/${id}`, { method: 'PUT', body: JSON.stringify(interview) }),
    deleteInterview: (id, actorId) => request(`/interviews/${id}?actor_id=${encodeURIComponent(actorId)}`, { method: 'DELETE' }),
  };
}());
