function setMobileActive(id){document.querySelectorAll('.mobile-nav button').forEach(button=>button.classList.toggle('active',button.id===id))}
function mobileEsc(value){return String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]))}

renderCandidates=function(){
  const ranked=allCandidates().filter(candidate=>shortlist.has(candidate.id)).sort((a,b)=>currentSort==='recent'?b.recent-a.recent:b.score-a.score);
  list.innerHTML=ranked.length?ranked.map(candidate=>{const github=(candidate.projectTags||[]).slice(0,2),resume=(candidate.resumeTags||[]).slice(0,2);const sourceTags=`${github.map(proof=>`<span class="proof github-proof">GitHub · ${mobileEsc(proof)}</span>`).join('')}${resume.map(proof=>`<span class="proof resume-proof">Resume · ${mobileEsc(proof)}</span>`).join('')}`||'<span class="proof-empty">No tagged evidence</span>';return `<article class="candidate-row"><button class="candidate-main candidate-public-link" data-public-candidate="${mobileEsc(candidate.id)}" title="View ${mobileEsc(candidate.name)} public profile"><span class="candidate-avatar" style="background:${mobileEsc(candidate.color)}">${mobileEsc(candidate.initials)}</span><span><strong>${mobileEsc(candidate.name)}</strong><small>${mobileEsc(candidate.role)} · ${mobileEsc(candidate.detail)}</small></span></button><div class="proofs source-proofs">${sourceTags}</div><button class="score candidate-evidence-link" data-candidate="${mobileEsc(candidate.id)}" title="View evidence">${mobileEsc(candidate.score)}<small>/ 100</small></button></article>`}).join(''):`<div class="shortlist-overview-empty"><strong>Your shortlist is empty</strong><p>Save candidates from the Talent pool to compare them here.</p><button id="discoverTalent">Discover talent</button></div>`;
  list.querySelectorAll('[data-public-candidate]').forEach(button=>button.addEventListener('click',()=>window.openCandidatePublicProfile?.(allCandidates().find(candidate=>candidate.id===button.dataset.publicCandidate))));
  list.querySelectorAll('[data-candidate]').forEach(button=>button.addEventListener('click',()=>openCandidate(allCandidates().find(candidate=>candidate.id===button.dataset.candidate))));
  document.querySelector('#discoverTalent')?.addEventListener('click',()=>{shortlistOnly=false;showWorkspace('talent');setMobileActive('mobileTalent')});
  const total=48+JSON.parse(localStorage.getItem('lions-submissions')||'[]').length;
  document.querySelector('.hero-meta span:first-child').textContent=`${total} candidates`;
  document.querySelector('.mini-stats div:first-child strong').textContent=total;
  document.querySelector('.panel-foot span').textContent=ranked.length?`Showing all ${ranked.length} saved candidates`:'No saved candidates yet';
};
renderCandidates();

const baseToggleShortlist=toggleShortlist;
toggleShortlist=function(id){baseToggleShortlist(id);renderCandidates()};

document.querySelector('#mobileOverview').addEventListener('click',()=>{shortlistOnly=false;showWorkspace('overview');setMobileActive('mobileOverview')});
document.querySelector('#mobileTalent').addEventListener('click',()=>{shortlistOnly=false;showWorkspace('talent');setMobileActive('mobileTalent')});
document.querySelector('#mobileSubmit').addEventListener('click',()=>{showWorkspace('student');setMobileActive('mobileSubmit')});
document.querySelector('#loadMore').addEventListener('click',()=>{shortlistOnly=true;showWorkspace('talent');setMobileActive('mobileTalent')});

document.querySelector('#exportPool').addEventListener('click',()=>{const saved=allCandidates().filter(candidate=>shortlist.has(candidate.id));if(!saved.length)return;const rows=[['Name','Field','Detail','Match','Resume tags','GitHub tags'],...saved.map(candidate=>[candidate.name,candidate.role,candidate.detail,candidate.score,(candidate.resumeTags||[]).join('; '),(candidate.projectTags||[]).join('; ')])];const csv=rows.map(row=>row.map(value=>`"${String(value).replaceAll('"','""')}"`).join(',')).join('\r\n');const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));link.download='lions-shortlist.csv';link.click();URL.revokeObjectURL(link.href)});

document.querySelector('#submitEvidence').addEventListener('click',()=>setTimeout(renderCandidates,0));
if(new URLSearchParams(location.search).get('view')==='talent'){shortlistOnly=false;showWorkspace('talent');setMobileActive('mobileTalent')}
