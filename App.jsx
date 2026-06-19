// ══════════════════════════════════════════════════════════════════════════
// GSMI RMIS — Geology and Sustainable Mining Institute / UM6P
// Research Management Information System
// ══════════════════════════════════════════════════════════════════════════
import { useState, useEffect, useCallback } from 'react'
import { C, GSMI_FULL_NAME, GSMI_AXES, ACADEMIC_YEARS, CURRENT_ACADEMIC_YEAR, ROLES, ROLE_LABELS, tauxColor, tauxLabel } from './constants.js'
import { T, fieldLabel } from './i18n.js'
import {
  upsertChercheur, getChercheurs, getChercheur,
  upsertAffilie, getAffilies, getAffilie,
  upsertPublication, getPublications, getPublicationsByDeclarant, deletePublication,
  upsertProjet, getProjets, deleteProjet,
  getEncadrementsByPerson, setEncadrements,
  getPrestationsByPerson, setPrestations,
  getRayonnementsByPerson, setRayonnements,
  getEnseignementsByPerson, setEnseignements,
  getAffectationsByAffilie, setAffectations, affectationTotal,
  upsertPrevision, getPrevision, addRevision, getLastRevision, getRevisions,
  clearAllData, getStorageSizeKB, getAuditLog,
} from './db.js'
import { computeRealisations, buildComparatif, computeScoreChercheur, computeCompletude, computeAlertes } from './kpi_engine.js'
import { fetchDoiMetadata } from './crossref.js'
import {
  IDENTIFICATION_FIELDS, PUBLICATION_TABLE, ENSEIGNEMENT_TABLE, ENCADREMENT_TABLE,
  PRESTATION_TABLE, RAYONNEMENT_TABLE, PROJET_FIELDS, PREVISION_FIELDS,
  AFFILIE_IDENTIFICATION_FIELDS, AFFECTATION_TABLE,
  computeContractDuration, isContractExpiringSoon,
} from './fields.js'
import { openCVForPrint } from './cv_generator.js'
import { generateRapportChercheur, generateRapportAxe, generateRapportInstitutionnel } from './reports.js'

const ADMIN_CODE = (() => { try { return import.meta.env.VITE_ADMIN_CODE || 'GSMI2025' } catch { return 'GSMI2025' } })()

// ══════════════════════════════════════════════════════════════════════════
// UI PRIMITIVES
// ══════════════════════════════════════════════════════════════════════════
function Toast({ t, bottom = 28 }) {
  return (
    <div style={{ position:'fixed', bottom, left:'50%', transform:'translateX(-50%)',
      background: t.type==='error' ? C.red : t.type==='info' ? C.blue : t.type==='warning' ? C.amber : C.navy,
      color:'#fff', padding:'12px 24px', borderRadius:10, fontSize:13, fontWeight:500,
      zIndex:9999, maxWidth:'90vw', textAlign:'center', boxShadow:'0 4px 20px rgba(0,0,0,.22)' }}>
      {t.msg}
    </div>
  )
}

// Bouton FR/EN visible en permanence sur toutes les vues (coin supérieur droit)
function LangToggle({ lang, onSwitch }) {
  return (
    <div style={{ position:'fixed', top:12, right:14, zIndex:9000 }}>
      <div style={{ display:'flex', background:'rgba(13,27,42,.85)', border:'1px solid rgba(255,255,255,.18)', borderRadius:8, overflow:'hidden', backdropFilter:'blur(4px)' }}>
        {['fr','en'].map(l => (
          <button key={l} onClick={() => onSwitch(l)}
            style={{ padding:'5px 11px', border:'none', cursor:'pointer', fontSize:11, fontWeight:700, fontFamily:'inherit',
                     background: lang===l ? C.blue : 'transparent',
                     color: lang===l ? '#fff' : 'rgba(255,255,255,.55)',
                     transition:'background .15s' }}>
            {l==='fr' ? '🇫🇷 FR' : '🇬🇧 EN'}
          </button>
        ))}
      </div>
    </div>
  )
}

function ScoreBadge({ score, size = 'md' }) {
  const color = score >= 70 ? C.green : score >= 40 ? C.amber : C.red
  const dims = size === 'lg' ? 72 : 48
  const fontSize = size === 'lg' ? 22 : 15
  return (
    <div style={{ width:dims, height:dims, borderRadius:'50%', background:`conic-gradient(${color} ${score}%, ${C.g3} ${score}%)`,
                  display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
      <div style={{ width:dims-10, height:dims-10, borderRadius:'50%', background:'#fff', display:'flex', alignItems:'center', justifyContent:'center' }}>
        <span style={{ fontSize, fontWeight:700, color }}>{score}</span>
      </div>
    </div>
  )
}

// DOI field — vérifie sur doi.org et, si onAutoFill fourni, interroge CrossRef
// pour pré-remplir titre / auteurs / journal / année / volume / pages / type.
function DoiField({ value, onChange, onAutoFill }) {
  const [busy, setBusy] = useState(false)
  const [st, setSt] = useState(null)

  async function verify() {
    if (!value) return
    setBusy(true); setSt({ ok:null, msg: onAutoFill ? '🔍 Récupération des métadonnées…' : '🔍 Vérification…' })
    const result = await fetchDoiMetadata(value)
    if (result.ok) {
      setSt({ ok:true, msg: onAutoFill ? '✅ DOI vérifié — champs remplis automatiquement' : '✅ DOI vérifié' })
      if (onAutoFill) onAutoFill(result.data)
    } else {
      setSt({ ok:false, msg: `⚠️ ${result.error}` })
    }
    setBusy(false)
  }

  return (
    <div>
      <div style={{ display:'flex', gap:6 }}>
        <input type="text" value={value||''} onChange={e=>onChange(e.target.value)}
          placeholder="10.XXXX/XXXXX"
          style={{ flex:1, padding:'8px 10px', fontFamily:'monospace', fontSize:12, color:C.gd,
                   border:`1.5px solid ${st?.ok===true?C.green:st?.ok===false?C.red:C.g3}`, borderRadius:6, outline:'none', background:'#fff' }}/>
        <button onClick={verify} disabled={busy}
          style={{ padding:'8px 10px', background:C.blue, color:'#fff', border:'none', borderRadius:6, fontSize:11, cursor:'pointer', whiteSpace:'nowrap' }}>
          {busy ? '…' : '🔍 Vérifier'}
        </button>
      </div>
      {st && <p style={{ fontSize:11, margin:'3px 0 0', color:st.ok===true?C.green:st.ok===false?C.red:C.amber }}>{st.msg}</p>}
    </div>
  )
}

function Field({ f, form, onChange, errors, lang = 'fr' }) {
  const val = form[f.id] ?? ''
  const err = errors[f.id]
  const [focused, setFoc] = useState(false)
  const label = fieldLabel(f.label, lang)
  const hint  = f.hint  ? fieldLabel(f.hint,  lang) : null
  const ph    = f.placeholder ? fieldLabel(f.placeholder, lang) : ''
  const base = {
    width:'100%', padding:'9px 11px', outline:'none', fontFamily:'inherit', boxSizing:'border-box',
    border:`1.5px solid ${err?C.red:focused?C.blue:C.g3}`, borderRadius:8, fontSize:13, color:C.gd,
    background:'#fff', transition:'border-color .15s', boxShadow: focused?`0 0 0 3px ${C.blue}18`:'none',
  }
  const ch = e => onChange(f.id, e.target.value)

  return (
    <div style={{ marginBottom:16 }}>
      <label style={{ display:'block', fontSize:12, fontWeight:600, color:C.gd, marginBottom:4 }}>
        {label}{f.required && <span style={{ color:C.red, marginLeft:3 }}>*</span>}
      </label>
      {hint && <p style={{ fontSize:11, color:C.gt, margin:'0 0 5px', lineHeight:1.4 }}>{hint}</p>}
      {f.type === 'textarea'
        ? <textarea value={val} onChange={ch} placeholder={ph} onFocus={()=>setFoc(true)} onBlur={()=>setFoc(false)} style={{...base, minHeight:70, resize:'vertical', lineHeight:1.5}}/>
        : f.type === 'select'
        ? <select value={val} onChange={ch} onFocus={()=>setFoc(true)} onBlur={()=>setFoc(false)} style={{...base, cursor:'pointer'}}>
            <option value="">{lang==='fr' ? '— Sélectionner —' : '— Select —'}</option>
            {f.options.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        : <input type={f.type==='number'?'number':f.type==='date'?'date':'text'} value={val} onChange={ch}
            placeholder={ph} min={f.min} max={f.max}
            onFocus={()=>setFoc(true)} onBlur={()=>setFoc(false)} style={base}/>
      }
      {err && <p style={{ fontSize:11, color:C.red, margin:'4px 0 0' }}>⚠ {err}</p>}
    </div>
  )
}

function DetailTable({ tbl, rows, onChange, lang = 'fr' }) {
  const add = () => onChange([...rows, {}])
  const del = i => onChange(rows.filter((_,j)=>j!==i))
  const set = (i,id,v) => { const n=[...rows]; n[i]={...n[i],[id]:v}; onChange(n) }
  const setMany = (i, patch) => { const n=[...rows]; n[i]={...n[i], ...patch}; onChange(n) }

  return (
    <div style={{ marginBottom:20 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:10 }}>
        <div>
          <h4 style={{ margin:0, fontSize:13, fontWeight:700, color:tbl.color }}>{tbl.icon} {tbl.title}</h4>
          {tbl.hint && <p style={{ margin:'3px 0 0', fontSize:11, color:C.gt }}>{tbl.hint}</p>}
        </div>
        <button onClick={add} style={{ padding:'7px 13px', background:tbl.color, color:'#fff', border:'none', borderRadius:8, fontSize:11, cursor:'pointer', whiteSpace:'nowrap', flexShrink:0 }}>
          {lang==='fr' ? '+ Ligne' : '+ Row'}
        </button>
      </div>

      {rows.length === 0
        ? <div style={{ border:`1.5px dashed ${C.g3}`, borderRadius:10, padding:'18px', textAlign:'center', color:C.gt, fontSize:12 }}>{lang==='fr' ? 'Cliquer "+ Ligne" pour ajouter' : 'Click "+ Row" to add'}</div>
        : <div style={{ overflowX:'auto', borderRadius:10, border:`1px solid ${C.g3}` }}>
            <table style={{ borderCollapse:'collapse', fontSize:12, width:'100%', minWidth:'max-content' }}>
              <thead>
                <tr style={{ background:tbl.color }}>
                  {tbl.cols.map(c => (
                    <th key={c.id} style={{ padding:'7px 9px', color:'#fff', fontWeight:600, whiteSpace:'nowrap', minWidth:c.w, textAlign:'left', fontSize:10 }}>
                      {c.label}{c.required && <span style={{color:C.gold, marginLeft:2}}>*</span>}
                    </th>
                  ))}
                  <th style={{ padding:'7px', width:28 }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} style={{ borderBottom:`0.5px solid ${C.g3}`, background:i%2===0?'#fff':C.g1 }}>
                    {tbl.cols.map(c => (
                      <td key={c.id} style={{ padding:'4px 6px', minWidth:c.w }}>
                        {c.type === 'doi'
                          ? <DoiField value={row[c.id]||''} onChange={v=>set(i,c.id,v)}
                              onAutoFill={data => {
                                const patch = {}
                                ;['title','authors','source','year','volume','numero','pages','doc_type','citations','nb_auteurs_total'].forEach(k => {
                                  if (tbl.cols.some(col => col.id === k) && data[k] !== undefined && data[k] !== '') patch[k] = data[k]
                                })
                                patch.doi = data.doi
                                setMany(i, patch)
                              }}/>
                          : c.type === 'select'
                          ? <select value={row[c.id]||''} onChange={e=>set(i,c.id,e.target.value)}
                              style={{ width:'100%', padding:'5px 7px', border:`1px solid ${C.g3}`, borderRadius:6, fontSize:11, color:C.gd, background:'#fff', outline:'none' }}>
                              <option value="">—</option>
                              {c.options.map(o=><option key={o} value={o}>{o}</option>)}
                            </select>
                          : <input type={c.type==='number'?'number':'text'} value={row[c.id]===undefined?'':row[c.id]}
                              onChange={e=>set(i,c.id,c.type==='number'?+e.target.value:e.target.value)}
                              min={c.min} max={c.max}
                              style={{ width:'100%', padding:'5px 7px', border:`1px solid ${C.g3}`, borderRadius:6, fontSize:11, color:C.gd, background:'transparent', outline:'none', boxSizing:'border-box' }}/>
                        }
                      </td>
                    ))}
                    <td style={{ padding:'4px 5px', textAlign:'center' }}>
                      <button onClick={()=>del(i)} style={{ background:'transparent', border:'none', color:C.red, cursor:'pointer', fontSize:13 }}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
      }

      {rows.length > 0 && (
        <div style={{ marginTop:8, display:'flex', flexWrap:'wrap', gap:6 }}>
          {tbl.aggregates.map(agg => (
            <div key={agg.k} style={{ background:tbl.color+'18', border:`1px solid ${tbl.color}35`, borderRadius:7, padding:'4px 10px' }}>
              <span style={{ fontSize:10, color:C.gt }}>{agg.k}: </span>
              <strong style={{ fontSize:12, color:tbl.color }}>{agg.fn(rows)}</strong>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// MAIN APP
// ══════════════════════════════════════════════════════════════════════════
export default function App({ lang = 'fr' }) {
  // lang reçu depuis main.jsx (état unique) — le changement FR/EN force le re-render complet
  const t = T[lang]

  const [view, setView]   = useState('home')
  const [role, setRole]   = useState(null)
  const [annee, setAnnee] = useState(CURRENT_ACADEMIC_YEAR)
  const [toast, setToast] = useState(null)
  const [loading, setLoading] = useState(false)

  const [myEmail, setMyEmail] = useState('')
  const [form, setForm]       = useState({})
  const [errors, setErrors]   = useState({})

  const [pubRows, setPubRows]   = useState([])
  const [ensRows, setEnsRows]   = useState([])
  const [encRows, setEncRows]   = useState([])
  const [presRows, setPresRows] = useState([])
  const [rayRows, setRayRows]   = useState([])
  const [affectRows, setAffectRows] = useState([])

  const [adminCode, setAdminCode] = useState('')
  const [adminOk, setAdminOk]     = useState(false)
  const [adminRole, setAdminRole] = useState(ROLES.DIRECTION)
  const [adminTab, setAdminTab]   = useState('overview')
  const [adminSearch, setAdminSearch] = useState('')
  const [adminAxe, setAdminAxe]   = useState('Tous')

  const [refreshKey, setRefreshKey] = useState(0)
  function bump() { setRefreshKey(k => k+1) }
  function showToast(msg, type='success') { setToast({msg,type}); setTimeout(()=>setToast(null), 4500) }

  function handleChange(id, v) { setForm(p=>({...p,[id]:v})); setErrors(p=>{const n={...p};delete n[id];return n}) }

  function validateFields(fieldList) {
    const errs = {}
    fieldList.forEach(f => {
      const val = form[f.id] ?? ''
      if (f.required && (!val||val==='')) { errs[f.id]='Champ obligatoire'; return }
      if (f.validate) { const m=f.validate(val,form); if (m) errs[f.id]=m }
    })
    setErrors(errs)
    return Object.keys(errs).length===0
  }

  function loadMyProfile(email, kind) {
    const profile = kind==='chercheur' ? getChercheur(email) : getAffilie(email)
    if (profile) {
      setForm(profile)
      setPubRows(getPublicationsByDeclarant(email))
      setEnsRows(getEnseignementsByPerson(email))
      setEncRows(getEncadrementsByPerson(email))
      setPresRows(getPrestationsByPerson(email))
      setRayRows(getRayonnementsByPerson(email))
      if (kind==='affilie' || profile.grade==='Postdoctorant') setAffectRows(getAffectationsByAffilie(email))
      showToast(t.profile_loaded, 'info')
    } else {
      setForm({ email })
      setPubRows([]); setEnsRows([]); setEncRows([]); setPresRows([]); setRayRows([]); setAffectRows([])
    }
  }

  function startChercheur() { setRole('chercheur'); setForm({}); setMyEmail(''); setView('profil_chercheur') }
  function startAffilie()   { setRole('affilie');   setForm({}); setMyEmail(''); setView('profil_affilie') }

  async function saveChercheurAll() {
    if (!validateFields(IDENTIFICATION_FIELDS)) { showToast(t.err_fields, 'error'); return }
    // Validation Postdoc : affectation projets obligatoire à 100%
    if (form.grade === 'Postdoctorant') {
      const total = affectationTotal(affectRows)
      if (total < 100) {
        showToast(lang==='fr' ? `Affectation incomplète : ${total}% sur 100% requis` : `Incomplete assignment: ${total}% of 100% required`, 'error')
        return
      }
      if (total > 100) {
        showToast(lang==='fr' ? `Affectation dépasse 100% (${total}%)` : `Assignment exceeds 100% (${total}%)`, 'error')
        return
      }
    }
    setLoading(true)
    const chercheur = upsertChercheur(form)
    const email = chercheur.email
    pubRows.forEach(p => {
      if (!p.title) return
      upsertPublication({ ...p, declarant_email: email, declarant_nom: `${form.prenom||''} ${form.nom||''}`.trim(), declarant_type:'chercheur' })
    })
    setEnseignements(email, ensRows.filter(r=>r.module))
    setEncadrements(email, encRows.filter(r=>r.etudiant))
    setPrestations(email, presRows.filter(r=>r.intitule))
    setRayonnements(email, rayRows.filter(r=>r.titre))
    if (form.grade === 'Postdoctorant') setAffectations(email, affectRows.filter(r=>r.num_as||r.intitule))
    showToast(t.saved_profile)
    setLoading(false)
    setView('thanks')
  }

  async function saveAffilieAll() {
    if (!validateFields(AFFILIE_IDENTIFICATION_FIELDS)) { showToast(t.err_fields, 'error'); return }
    const total = affectationTotal(affectRows)
    if (total > 100) { showToast(`Le total des affectations (${total}%) dépasse 100% — corriger avant de soumettre`, 'error'); return }
    setLoading(true)
    const affilie = upsertAffilie(form)
    const email = affilie.email
    pubRows.forEach(p => { if (p.title) upsertPublication({ ...p, declarant_email: email, declarant_nom: `${form.prenom||''} ${form.nom||''}`.trim(), declarant_type:'affilie' }) })
    setEnseignements(email, ensRows.filter(r=>r.module))
    setEncadrements(email, encRows.filter(r=>r.etudiant))
    setPrestations(email, presRows.filter(r=>r.intitule))
    setRayonnements(email, rayRows.filter(r=>r.titre))
    setAffectations(email, affectRows.filter(r=>r.intitule))
    showToast(t.saved_affilie)
    setLoading(false)
    setView('thanks')
  }

  function submitPrevision() {
    const allFields = PREVISION_FIELDS.flatMap(s=>s.fields)
    if (!validateFields(allFields)) { showToast(t.err_fields,'error'); return }
    upsertPrevision(myEmail, annee, form)
    showToast(t.prev_saved + annee)
    setView('thanks')
  }

  function submitRevision() {
    if (!form.motif) { showToast('Le motif de révision est obligatoire','error'); return }
    addRevision(myEmail, annee, form)
    showToast(t.rev_saved)
    setView('thanks')
  }

  // ── HOME ──────────────────────────────────────────────────────────────
  if (view === 'home') return (
    <div style={{ minHeight:'100vh', background:C.g1, fontFamily:'system-ui,-apple-system,sans-serif' }}>
      <style>{`*{box-sizing:border-box}button{font-family:inherit;transition:opacity .15s,transform .1s}button:hover{opacity:.87}button:active{transform:scale(.97)}`}</style>

      <div style={{ background:C.navy, padding:'44px 24px 36px', textAlign:'center' }}>
        <p style={{ color:C.gold, fontSize:11, letterSpacing:'.14em', textTransform:'uppercase', margin:'0 0 10px', fontWeight:700 }}>
          {GSMI_FULL_NAME} · UM6P
        </p>
        <h1 style={{ color:'#fff', fontSize:30, fontWeight:700, margin:'0 0 8px' }}>{t.app_title}</h1>
        <p style={{ color:'#8899BB', fontSize:14, margin:'0 0 4px', maxWidth:480, marginLeft:'auto', marginRight:'auto', lineHeight:1.6 }}>
          {t.subtitle}
        </p>
      </div>

      <div style={{ maxWidth:760, margin:'0 auto', padding:'28px 18px 0' }}>
        <div style={{ background:'#fff', border:`0.5px solid ${C.g3}`, borderRadius:12, padding:'16px 20px', marginBottom:18 }}>
          <p style={{ margin:0, fontSize:12, color:C.gt, lineHeight:1.6 }}>
            <strong style={{color:C.navy}}>{t.principle_title} :</strong> {t.principle_text}
          </p>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))', gap:12, marginBottom:14 }}>
          <button onClick={startChercheur} style={{ background:'#fff', border:`1.5px solid ${C.g3}`, borderRadius:12, padding:'18px', textAlign:'left', borderTop:`4px solid ${C.blue}` }}>
            <div style={{ fontSize:26, marginBottom:8 }}>👤</div>
            <p style={{ margin:'0 0 4px', fontWeight:700, fontSize:14, color:C.gd }}>{t.space_chercheur}</p>
            <p style={{ margin:0, fontSize:11, color:C.gt, lineHeight:1.4 }}>{t.space_aff_sub}</p>
          </button>
          <button onClick={startAffilie} style={{ background:'#fff', border:`1.5px solid ${C.g3}`, borderRadius:12, padding:'18px', textAlign:'left', borderTop:`4px solid ${C.teal}` }}>
            <div style={{ fontSize:26, marginBottom:8 }}>🪪</div>
            <p style={{ margin:'0 0 4px', fontWeight:700, fontSize:14, color:C.gd }}>{t.space_affilie}</p>
            <p style={{ margin:0, fontSize:11, color:C.gt, lineHeight:1.4 }}>{t.space_cher_sub}</p>
          </button>
          <button onClick={() => { setMyEmail(''); setView('prevision_select') }} style={{ background:'#fff', border:`1.5px solid ${C.g3}`, borderRadius:12, padding:'18px', textAlign:'left', borderTop:`4px solid ${C.violet}` }}>
            <div style={{ fontSize:26, marginBottom:8 }}>🎯</div>
            <p style={{ margin:'0 0 4px', fontWeight:700, fontSize:14, color:C.gd }}>{t.space_prev}</p>
            <p style={{ margin:0, fontSize:11, color:C.gt, lineHeight:1.4 }}>{t.space_prev_sub}</p>
          </button>
          <button onClick={() => { setMyEmail(''); setView('mon_dashboard') }} style={{ background:'#fff', border:`1.5px solid ${C.g3}`, borderRadius:12, padding:'18px', textAlign:'left', borderTop:`4px solid ${C.green}` }}>
            <div style={{ fontSize:26, marginBottom:8 }}>📊</div>
            <p style={{ margin:'0 0 4px', fontWeight:700, fontSize:14, color:C.gd }}>{t.space_dash}</p>
            <p style={{ margin:0, fontSize:11, color:C.gt, lineHeight:1.4 }}>{t.space_dash_sub}</p>
          </button>
        </div>

        {/* Récapitulatif professeur */}
        <div style={{ background:'#fff', border:`1.5px solid ${C.g3}`, borderRadius:12, padding:'16px 18px', marginBottom:14, display:'flex', alignItems:'center', gap:14 }}>
          <span style={{ fontSize:26 }}>📋</span>
          <div style={{ flex:1 }}>
            <p style={{ margin:'0 0 3px', fontWeight:700, fontSize:14, color:C.gd }}>{lang==='fr'?'Mon récapitulatif':'My Summary'}</p>
            <p style={{ margin:0, fontSize:11, color:C.gt }}>{lang==='fr'?'Historique complet : prévisions, révisions, réalisations et KPI':'Full history: forecasts, revisions, achievements and KPIs'}</p>
          </div>
          <button onClick={() => { setMyEmail(''); setView('recap') }}
            style={{ padding:'9px 16px', background:C.navy, color:'#fff', border:'none', borderRadius:8, fontSize:12, fontWeight:600, cursor:'pointer', whiteSpace:'nowrap' }}>
            {lang==='fr'?'Accéder →':'Access →'}
          </button>
        </div>

        <div style={{ textAlign:'center', paddingBottom:36 }}>
          <button onClick={() => setView('admin')} style={{ background:'transparent', color:C.gt, border:`0.5px solid ${C.g3}`, borderRadius:8, padding:'9px 18px', fontSize:13, cursor:'pointer' }}>
            {t.admin_access}
          </button>
        </div>
      </div>
      {toast && <Toast t={toast}/>}
    </div>
  )

  // ── PROFIL CHERCHEUR / AFFILIÉ ──────────────────────────────────────────
  if (view === 'profil_chercheur' || view === 'profil_affilie') {
    const isAffilie = view === 'profil_affilie'
    const idFields = isAffilie ? AFFILIE_IDENTIFICATION_FIELDS : IDENTIFICATION_FIELDS
    const duree = isAffilie ? computeContractDuration(form.date_debut, form.date_fin) : null
    const totalAffect = isAffilie ? affectationTotal(affectRows) : 0
    const overLimit = totalAffect > 100

    return (
      <div style={{ minHeight:'100vh', background:C.g1, fontFamily:'system-ui,-apple-system,sans-serif' }}>
        <style>{`*{box-sizing:border-box}button:hover{opacity:.87}button:active{transform:scale(.97)}`}</style>
        <div style={{ background:C.navy, padding:'14px 20px', position:'sticky', top:0, zIndex:10 }}>
          <div style={{ maxWidth:1100, margin:'0 auto', display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:10 }}>
            <div style={{ display:'flex', alignItems:'center', gap:12 }}>
              <button onClick={()=>setView('home')} style={{ background:'transparent', border:'none', color:'rgba(255,255,255,.7)', fontSize:12, cursor:'pointer', padding:0 }}>{t.back_home}</button>
              <h2 style={{ color:'#fff', fontSize:14, fontWeight:700, margin:0 }}>{isAffilie?'🪪 Espace Expert / Affilié':t.profile_space_c}</h2>
            </div>
            <button onClick={isAffilie?saveAffilieAll:saveChercheurAll} disabled={loading}
              style={{ background:C.green, color:'#fff', border:'none', borderRadius:8, padding:'8px 16px', fontSize:12, fontWeight:600, cursor:'pointer' }}>
              {loading?'…':'✓ Enregistrer'}
            </button>
          </div>
        </div>

        <div style={{ maxWidth:1100, margin:'0 auto', padding:'20px 16px 40px' }}>
          <div style={{ background:'#EFF6FF', borderRadius:10, padding:'14px 16px', marginBottom:18, borderLeft:`3px solid ${C.blue}` }}>
            <p style={{ margin:'0 0 8px', fontSize:12, color:'#1e40af', fontWeight:600 }}>{t.load_profile_hint}</p>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              <input value={myEmail} onChange={e=>setMyEmail(e.target.value)} placeholder="votre.email@um6p.ma"
                style={{ flex:1, minWidth:200, padding:'8px 12px', border:`1.5px solid ${C.g3}`, borderRadius:8, fontSize:13, outline:'none' }}/>
              <button onClick={()=>loadMyProfile(myEmail, isAffilie?'affilie':'chercheur')}
                style={{ padding:'8px 16px', background:C.navy, color:'#fff', border:'none', borderRadius:8, fontSize:12, cursor:'pointer', whiteSpace:'nowrap' }}>
                {t.load_profile_btn}
              </button>
            </div>
          </div>

          <div style={{ background:'#fff', border:`0.5px solid ${C.g3}`, borderRadius:12, padding:'16px 18px', marginBottom:16 }}>
            <h3 style={{ margin:'0 0 12px', fontSize:13, fontWeight:700, color:C.navy }}>👤 Identification</h3>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))', gap:10 }}>
              {idFields.map(f => <Field key={f.id} f={f} form={form} onChange={handleChange} errors={errors} lang={lang}/>)}
            </div>
            {duree && <div style={{ marginTop:4, background:C.g1, borderRadius:8, padding:'8px 12px', display:'inline-block' }}>
              <span style={{ fontSize:11, color:C.gt }}>{t.contract_duration} : </span>
              <strong style={{ fontSize:12, color:C.navy }}>{duree}</strong>
            </div>}
          </div>

          {isAffilie && (
            <div style={{ background:'#fff', border:`0.5px solid ${C.g3}`, borderRadius:12, padding:'16px 18px', marginBottom:14 }}>
              <DetailTable tbl={AFFECTATION_TABLE} rows={affectRows} onChange={setAffectRows} lang={lang}/>
              <div style={{ marginTop:8, display:'flex', alignItems:'center', gap:8 }}>
                <div style={{ flex:1, height:9, background:C.g3, borderRadius:5, overflow:'hidden' }}>
                  <div style={{ width:`${Math.min(totalAffect,100)}%`, height:'100%', background:overLimit?C.red:totalAffect===100?C.green:C.blue }}/>
                </div>
                <span style={{ fontSize:12, fontWeight:700, color:overLimit?C.red:totalAffect===100?C.green:C.gd }}>{totalAffect}% / 100%</span>
              </div>
              {overLimit && <p style={{ marginTop:6, fontSize:11, color:C.red, fontWeight:600 }}>⚠ {t.affectation_over}</p>}
            </div>
          )}

          {/* Bloc affectation Postdoc — s'affiche dès que grade=Postdoc est sélectionné */}
          {!isAffilie && form.grade === 'Postdoctorant' && (() => {
            const postdocTotal = affectationTotal(affectRows)
            const postdocOver  = postdocTotal > 100
            const postdocOk    = postdocTotal === 100
            return (
              <div style={{ background:'#fff', border:`2px solid ${postdocOver?C.red:postdocOk?C.green:C.amber}`, borderRadius:12, padding:'16px 18px', marginBottom:14 }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14, flexWrap:'wrap', gap:8 }}>
                  <div>
                    <h3 style={{ margin:'0 0 3px', fontSize:13, fontWeight:700, color:C.navy }}>
                      📌 {lang==='fr' ? 'Affectation aux projets' : 'Project assignments'}
                      <span style={{ marginLeft:8, fontSize:11, background:'#EFF6FF', color:C.blue, padding:'2px 8px', borderRadius:6, fontWeight:600, verticalAlign:'middle' }}>Postdoc</span>
                    </h3>
                    <p style={{ margin:0, fontSize:11, color:C.gt }}>
                      {lang==='fr'
                        ? "Obligatoire — le total doit atteindre exactement 100%"
                        : "Required — total must reach exactly 100%"}
                    </p>
                  </div>
                  <span style={{ fontSize:22, fontWeight:800, color:postdocOver?C.red:postdocOk?C.green:C.amber }}>
                    {postdocTotal}%
                  </span>
                </div>

                {/* Barre de progression */}
                <div style={{ height:8, background:C.g3, borderRadius:4, overflow:'hidden', marginBottom:14 }}>
                  <div style={{ width:`${Math.min(postdocTotal,100)}%`, height:'100%', borderRadius:4, transition:'width .3s',
                    background:postdocOver?C.red:postdocOk?C.green:C.amber }}/>
                </div>

                {/* Tableau N°AS / Intitulé / % */}
                <div style={{ border:`1px solid ${C.g3}`, borderRadius:8, overflow:'hidden', marginBottom:12 }}>
                  <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
                    <thead>
                      <tr style={{ background:C.navy }}>
                        <th style={{ padding:'9px 12px', color:'#fff', fontWeight:600, textAlign:'left', fontSize:12, width:130 }}>N° AS</th>
                        <th style={{ padding:'9px 12px', color:'#fff', fontWeight:600, textAlign:'left', fontSize:12 }}>
                          {lang==='fr' ? 'Intitulé du projet' : 'Project title'}
                        </th>
                        <th style={{ padding:'9px 12px', color:'#fff', fontWeight:600, textAlign:'center', fontSize:12, width:130 }}>
                          {lang==='fr' ? 'Affectation (%)' : 'Assignment (%)'}
                        </th>
                        <th style={{ width:36 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {affectRows.length === 0 && (
                        <tr>
                          <td colSpan={4} style={{ padding:'20px', textAlign:'center', color:C.gt, fontSize:12 }}>
                            {lang==='fr' ? 'Cliquer "+ Ajouter" pour saisir vos projets' : 'Click "+ Add" to enter your projects'}
                          </td>
                        </tr>
                      )}
                      {affectRows.map((row, i) => (
                        <tr key={i} style={{ borderTop:`0.5px solid ${C.g3}`, background:i%2===0?'#fff':C.g1 }}>
                          <td style={{ padding:'7px 10px' }}>
                            <input value={row.num_as||''} placeholder="AS-XXXX"
                              onChange={e => { const n=[...affectRows]; n[i]={...n[i],num_as:e.target.value}; setAffectRows(n) }}
                              style={{ width:'100%', padding:'6px 8px', border:`1px solid ${C.g3}`, borderRadius:6, fontSize:12, outline:'none', boxSizing:'border-box' }}/>
                          </td>
                          <td style={{ padding:'7px 10px' }}>
                            <input value={row.intitule||''} placeholder={lang==='fr' ? 'Intitulé du projet' : 'Project title'}
                              onChange={e => { const n=[...affectRows]; n[i]={...n[i],intitule:e.target.value}; setAffectRows(n) }}
                              style={{ width:'100%', padding:'6px 8px', border:`1px solid ${C.g3}`, borderRadius:6, fontSize:12, outline:'none', boxSizing:'border-box' }}/>
                          </td>
                          <td style={{ padding:'7px 10px', textAlign:'center' }}>
                            <div style={{ display:'flex', alignItems:'center', gap:6, justifyContent:'center' }}>
                              <input type="number" value={row.pourcentage||''} min={0} max={100}
                                onChange={e => { const n=[...affectRows]; n[i]={...n[i],pourcentage:Math.min(100,+e.target.value)}; setAffectRows(n) }}
                                style={{ width:64, padding:'6px 8px', border:`1px solid ${C.g3}`, borderRadius:6, fontSize:12, textAlign:'center', outline:'none' }}/>
                              <span style={{ fontSize:13, color:C.gt }}>%</span>
                            </div>
                          </td>
                          <td style={{ padding:'6px', textAlign:'center' }}>
                            <button onClick={() => setAffectRows(affectRows.filter((_,j)=>j!==i))}
                              style={{ background:'transparent', border:'none', color:C.red, cursor:'pointer', fontSize:15 }}>✕</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:10 }}>
                  <button
                    onClick={() => setAffectRows([...affectRows, {num_as:'',intitule:'',pourcentage:''}])}
                    disabled={postdocTotal >= 100}
                    style={{ padding:'8px 16px', background:postdocTotal>=100?C.g3:C.blue, color:postdocTotal>=100?C.gt:'#fff',
                             border:'none', borderRadius:8, fontSize:12, fontWeight:600, cursor:postdocTotal>=100?'not-allowed':'pointer' }}>
                    + {lang==='fr' ? 'Ajouter un projet' : 'Add project'}
                    {postdocTotal < 100 && (
                      <span style={{ marginLeft:6, fontWeight:400, fontSize:11 }}>
                        ({100-postdocTotal}% {lang==='fr' ? 'restant' : 'remaining'})
                      </span>
                    )}
                  </button>
                  {postdocOk  && <span style={{ fontSize:13, color:C.green, fontWeight:700 }}>✅ {lang==='fr' ? 'Affectation complète (100%)' : 'Full assignment (100%)'}</span>}
                  {!postdocOk && !postdocOver && postdocTotal > 0 && <span style={{ fontSize:12, color:C.amber, fontWeight:600 }}>⚠ {100-postdocTotal}% {lang==='fr' ? 'restant' : 'remaining'}</span>}
                  {postdocOver && <span style={{ fontSize:12, color:C.red, fontWeight:600 }}>⛔ +{postdocTotal-100}% {lang==='fr' ? 'dépassement' : 'over limit'}</span>}
                </div>
              </div>
            )
          })()}

          <div style={{ background:'#fff', border:`0.5px solid ${C.g3}`, borderRadius:12, padding:'16px 18px', marginBottom:14 }}>
            <DetailTable tbl={PUBLICATION_TABLE} rows={pubRows} onChange={setPubRows} lang={lang}/>
          </div>
          <div style={{ background:'#fff', border:`0.5px solid ${C.g3}`, borderRadius:12, padding:'16px 18px', marginBottom:14 }}>
            <DetailTable tbl={ENSEIGNEMENT_TABLE} rows={ensRows} onChange={setEnsRows} lang={lang}/>
          </div>
          <div style={{ background:'#fff', border:`0.5px solid ${C.g3}`, borderRadius:12, padding:'16px 18px', marginBottom:14 }}>
            <DetailTable tbl={ENCADREMENT_TABLE} rows={encRows} onChange={setEncRows} lang={lang}/>
          </div>
          <div style={{ background:'#fff', border:`0.5px solid ${C.g3}`, borderRadius:12, padding:'16px 18px', marginBottom:14 }}>
            <DetailTable tbl={PRESTATION_TABLE} rows={presRows} onChange={setPresRows} lang={lang}/>
          </div>
          <div style={{ background:'#fff', border:`0.5px solid ${C.g3}`, borderRadius:12, padding:'16px 18px', marginBottom:14 }}>
            <DetailTable tbl={RAYONNEMENT_TABLE} rows={rayRows} onChange={setRayRows} lang={lang}/>
          </div>

          <div style={{ textAlign:'right' }}>
            <button onClick={isAffilie?saveAffilieAll:saveChercheurAll} disabled={loading}
              style={{ background:C.navy, color:'#fff', border:'none', borderRadius:10, padding:'12px 26px', fontSize:13, fontWeight:600, cursor:'pointer' }}>
              {loading?'…':t.save_all}
            </button>
          </div>
        </div>
        {toast && <Toast t={toast}/>}
      </div>
    )
  }

  // ── PRÉVISION : sélection email + année ──────────────────────────────
  if (view === 'prevision_select') return (
    <div style={{ minHeight:'100vh', background:C.g1, display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'system-ui,sans-serif', padding:20 }}>
      <style>{`*{box-sizing:border-box}button:hover{opacity:.87}`}</style>
      <div style={{ background:'#fff', border:`0.5px solid ${C.g3}`, borderRadius:14, padding:'28px 26px', width:'100%', maxWidth:380 }}>
        <h2 style={{ margin:'0 0 6px', fontSize:16, fontWeight:700, color:C.gd }}>{t.prev_page_title}</h2>
        <p style={{ margin:'0 0 18px', fontSize:12, color:C.gt }}>{t.prev_page_hint}</p>
        <input value={myEmail} onChange={e=>setMyEmail(e.target.value)} placeholder="votre.email@um6p.ma"
          style={{ width:'100%', padding:'10px 12px', border:`1.5px solid ${C.g3}`, borderRadius:8, fontSize:13, outline:'none', marginBottom:10, boxSizing:'border-box' }}/>
        <select value={annee} onChange={e=>setAnnee(e.target.value)}
          style={{ width:'100%', padding:'10px 12px', border:`1.5px solid ${C.g3}`, borderRadius:8, fontSize:13, outline:'none', marginBottom:16, boxSizing:'border-box', background:'#fff' }}>
          {ACADEMIC_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <div style={{ display:'flex', gap:8, marginBottom:10 }}>
          <button onClick={() => { if(!myEmail){showToast(t.err_email,'error');return} const existing=getPrevision(myEmail,annee); setForm(existing||{}); setView('prevision_form') }}
            style={{ flex:1, padding:'11px', background:C.blue, color:'#fff', border:'none', borderRadius:8, fontSize:12, fontWeight:600, cursor:'pointer' }}>
            {t.prev_btn}
          </button>
          <button onClick={() => { if(!myEmail){showToast(t.err_email,'error');return} setForm({}); setView('revision_form') }}
            style={{ flex:1, padding:'11px', background:C.teal, color:'#fff', border:'none', borderRadius:8, fontSize:12, fontWeight:600, cursor:'pointer' }}>
            {t.rev_btn}
          </button>
        </div>
        <button onClick={()=>setView('home')} style={{ width:'100%', background:'transparent', color:C.gt, border:'none', fontSize:12, cursor:'pointer', padding:6 }}>{t.back}</button>
      </div>
      {toast && <Toast t={toast}/>}
    </div>
  )

  // ── PRÉVISION : formulaire ────────────────────────────────────────────
  if (view === 'prevision_form') return (
    <div style={{ minHeight:'100vh', background:C.g1, fontFamily:'system-ui,-apple-system,sans-serif' }}>
      <style>{`*{box-sizing:border-box}button:hover{opacity:.87}`}</style>
      <div style={{ background:C.blue, padding:'16px 20px', position:'sticky', top:0, zIndex:10 }}>
        <div style={{ maxWidth:680, margin:'0 auto', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div>
            <button onClick={()=>setView('home')} style={{ background:'transparent', border:'none', color:'rgba(255,255,255,.7)', fontSize:12, cursor:'pointer', padding:0, marginBottom:6, display:'block' }}>{t.back_home}</button>
            <h2 style={{ color:'#fff', fontSize:16, fontWeight:700, margin:0 }}>{t.prev_title} — {annee}</h2>
          </div>
          <button onClick={submitPrevision} style={{ background:'#fff', color:C.blue, border:'none', borderRadius:8, padding:'9px 18px', fontSize:12, fontWeight:700, cursor:'pointer' }}>{t.save}</button>
        </div>
      </div>
      <div style={{ maxWidth:680, margin:'0 auto', padding:'22px 18px 50px' }}>
        <div style={{ background:'#FFF8E6', borderRadius:8, padding:'10px 14px', marginBottom:18, borderLeft:`3px solid ${C.gold}` }}>
          <p style={{ margin:0, fontSize:12, color:C.amber }}>{t.prev_hint}</p>
        </div>
        {PREVISION_FIELDS.map(sec => (
          <div key={sec.section} style={{ background:'#fff', border:`0.5px solid ${C.g3}`, borderRadius:12, padding:'16px 18px', marginBottom:14 }}>
            <h3 style={{ margin:'0 0 12px', fontSize:13, fontWeight:700, color:C.navy }}>{fieldLabel(sec.section, lang)}</h3>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))', gap:10 }}>
              {sec.fields.map(f => <Field key={f.id} f={f} form={form} onChange={handleChange} errors={errors} lang={lang}/>)}
            </div>
          </div>
        ))}
        <div style={{ textAlign:'right' }}>
          <button onClick={submitPrevision} style={{ background:C.blue, color:'#fff', border:'none', borderRadius:10, padding:'12px 26px', fontSize:13, fontWeight:600, cursor:'pointer' }}>{t.prev_save}</button>
        </div>
      </div>
      {toast && <Toast t={toast}/>}
    </div>
  )

  // ── RÉVISION : formulaire ─────────────────────────────────────────────
  if (view === 'revision_form') {
    const prev = getPrevision(myEmail, annee)
    return (
      <div style={{ minHeight:'100vh', background:C.g1, fontFamily:'system-ui,-apple-system,sans-serif' }}>
        <style>{`*{box-sizing:border-box}button:hover{opacity:.87}`}</style>
        <div style={{ background:C.teal, padding:'16px 20px', position:'sticky', top:0, zIndex:10 }}>
          <div style={{ maxWidth:680, margin:'0 auto', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <div>
              <button onClick={()=>setView('home')} style={{ background:'transparent', border:'none', color:'rgba(255,255,255,.7)', fontSize:12, cursor:'pointer', padding:0, marginBottom:6, display:'block' }}>{t.back_home}</button>
              <h2 style={{ color:'#fff', fontSize:16, fontWeight:700, margin:0 }}>{t.rev_title} — {annee}</h2>
            </div>
            <button onClick={submitRevision} style={{ background:'#fff', color:C.teal, border:'none', borderRadius:8, padding:'9px 18px', fontSize:12, fontWeight:700, cursor:'pointer' }}>{t.submit}</button>
          </div>
        </div>
        <div style={{ maxWidth:680, margin:'0 auto', padding:'22px 18px 50px' }}>
          {!prev && <div style={{ background:'#FEF2F2', borderRadius:8, padding:'10px 14px', marginBottom:18, borderLeft:`3px solid ${C.red}` }}>
            <p style={{ margin:0, fontSize:12, color:C.red }}>Aucune prévision initiale trouvée pour {myEmail} / {annee}. Vous pouvez quand même soumettre une révision si nécessaire.</p>
          </div>}
          <div style={{ background:'#fff', border:`0.5px solid ${C.g3}`, borderRadius:12, padding:'16px 18px', marginBottom:14 }}>
            <h3 style={{ margin:'0 0 12px', fontSize:13, fontWeight:700, color:C.navy }}>{t.rev_motif_title}</h3>
            <Field f={{id:'motif',label:'Motif',type:'textarea',required:true,placeholder:t.rev_motif_ph}} form={form} onChange={handleChange} errors={errors} lang={lang}/>
          </div>
          {PREVISION_FIELDS.map(sec => (
            <div key={sec.section} style={{ background:'#fff', border:`0.5px solid ${C.g3}`, borderRadius:12, padding:'16px 18px', marginBottom:14 }}>
              <h3 style={{ margin:'0 0 12px', fontSize:13, fontWeight:700, color:C.navy }}>{fieldLabel(sec.section, lang)} {t.rev_values}</h3>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))', gap:10 }}>
                {sec.fields.map(f => <Field key={f.id} f={{...f, required:false}} form={form} onChange={handleChange} errors={errors} lang={lang}/>)}
              </div>
            </div>
          ))}
          <p style={{ fontSize:11, color:C.gt, marginBottom:12 }}>{t.rev_workflow}</p>
          <div style={{ textAlign:'right' }}>
            <button onClick={submitRevision} style={{ background:C.teal, color:'#fff', border:'none', borderRadius:10, padding:'12px 26px', fontSize:13, fontWeight:600, cursor:'pointer' }}>{t.rev_submit}</button>
          </div>
        </div>
        {toast && <Toast t={toast}/>}
      </div>
    )
  }

  // ── MON DASHBOARD & CV ────────────────────────────────────────────────
  if (view === 'mon_dashboard') {
    const chercheur = getChercheur(myEmail) || getAffilie(myEmail)
    const real = myEmail ? computeRealisations(myEmail, annee) : null
    const prev = myEmail ? getPrevision(myEmail, annee) : null
    const rev  = myEmail ? getLastRevision(myEmail, annee) : null
    const comparatif = real ? buildComparatif(prev, rev, real) : []
    const score = real ? computeScoreChercheur(real) : null
    const completude = chercheur ? computeCompletude(chercheur, prev) : 0

    return (
      <div style={{ minHeight:'100vh', background:C.g1, fontFamily:'system-ui,-apple-system,sans-serif' }}>
        <style>{`*{box-sizing:border-box}button:hover{opacity:.87}`}</style>
        <div style={{ background:C.navy, padding:'16px 20px', position:'sticky', top:0, zIndex:10 }}>
          <div style={{ maxWidth:1000, margin:'0 auto', display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:10 }}>
            <button onClick={()=>setView('home')} style={{ background:'transparent', border:'none', color:'rgba(255,255,255,.7)', fontSize:12, cursor:'pointer', padding:0 }}>{t.back_home}</button>
            <h2 style={{ color:'#fff', fontSize:15, fontWeight:700, margin:0 }}>{t.dash_title}</h2>
          </div>
        </div>

        <div style={{ maxWidth:1000, margin:'0 auto', padding:'20px 16px 40px' }}>
          <div style={{ background:'#fff', border:`0.5px solid ${C.g3}`, borderRadius:12, padding:'14px 16px', marginBottom:16, display:'flex', gap:10, flexWrap:'wrap', alignItems:'center' }}>
            <input value={myEmail} onChange={e=>setMyEmail(e.target.value)} placeholder="votre.email@um6p.ma"
              style={{ flex:1, minWidth:200, padding:'9px 12px', border:`1.5px solid ${C.g3}`, borderRadius:8, fontSize:13, outline:'none' }}/>
            <select value={annee} onChange={e=>setAnnee(e.target.value)}
              style={{ padding:'9px 12px', border:`1.5px solid ${C.g3}`, borderRadius:8, fontSize:13, outline:'none', background:'#fff' }}>
              {ACADEMIC_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <button onClick={bump} style={{ padding:'9px 16px', background:C.navy, color:'#fff', border:'none', borderRadius:8, fontSize:12, cursor:'pointer' }}>{t.dash_load_btn}</button>
          </div>

          {!chercheur ? (
            <div style={{ background:'#fff', border:`0.5px solid ${C.g3}`, borderRadius:12, padding:'40px', textAlign:'center', color:C.gt }}>
              Saisissez votre email puis cliquez "Charger" pour voir votre dashboard.
            </div>
          ) : (
            <>
              <div style={{ background:'#fff', border:`0.5px solid ${C.g3}`, borderRadius:12, padding:'18px 20px', marginBottom:16, display:'flex', alignItems:'center', gap:18, flexWrap:'wrap' }}>
                <ScoreBadge score={score.total} size="lg"/>
                <div style={{ flex:1, minWidth:200 }}>
                  <p style={{ margin:'0 0 3px', fontWeight:700, fontSize:16, color:C.gd }}>{chercheur.prenom||''} {chercheur.nom}</p>
                  <p style={{ margin:0, fontSize:12, color:C.gt }}>{chercheur.grade} · {chercheur.axe_principal||chercheur.axe} · {t.score_label} {score.total}/100</p>
                  <div style={{ marginTop:8, display:'flex', gap:6, flexWrap:'wrap' }}>
                    {Object.entries(score.detail).map(([k,v]) => (
                      <span key={k} style={{ fontSize:10, background:C.g1, borderRadius:6, padding:'2px 8px', color:C.gt }}>{k}: {v}</span>
                    ))}
                  </div>
                </div>
                <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                  <button onClick={()=>openCVForPrint(chercheur,{lang:'fr',short:false})} style={{ padding:'9px 14px', background:C.blue, color:'#fff', border:'none', borderRadius:8, fontSize:11, cursor:'pointer', whiteSpace:'nowrap' }}>{t.cv_fr}</button>
                  <button onClick={()=>openCVForPrint(chercheur,{lang:'en',short:true})} style={{ padding:'9px 14px', background:C.violet, color:'#fff', border:'none', borderRadius:8, fontSize:11, cursor:'pointer', whiteSpace:'nowrap' }}>{t.cv_en}</button>
                  <button onClick={()=>generateRapportChercheur(chercheur, annee)} style={{ padding:'9px 14px', background:C.green, color:'#fff', border:'none', borderRadius:8, fontSize:11, cursor:'pointer', whiteSpace:'nowrap' }}>{t.report_excel}</button>
                </div>
              </div>

              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(110px,1fr))', gap:8, marginBottom:16 }}>
                {[
                  {l:t.profile_complete, v:`${completude}%`, c: completude>=80?C.green:completude>=50?C.amber:C.red},
                  {l:t.kpi_publications, v:real.publications.acceptees, c:C.teal},
                  {l:'Q1', v:real.publications.q1, c:C.green},
                  {l:t.kpi_citations, v:real.impact.citations, c:C.violet},
                  {l:t.kpi_doctorants, v:real.formation.doctorants, c:C.blue},
                  {l:t.kpi_prestations, v:real.prestations.total, c:C.orange},
                ].map(k=>(
                  <div key={k.l} style={{ background:'#fff', border:`0.5px solid ${C.g3}`, borderRadius:10, padding:'10px 12px', borderTop:`3px solid ${k.c}` }}>
                    <p style={{ margin:'0 0 4px', fontSize:10, color:C.gt }}>{k.l}</p>
                    <p style={{ margin:0, fontSize:18, fontWeight:700, color:C.gd }}>{k.v}</p>
                  </div>
                ))}
              </div>

              {/* Point 6 — KPI Projets : calculés automatiquement, aucune ressaisie */}
              <div style={{ background:'#fff', border:`0.5px solid ${C.g3}`, borderRadius:12, padding:'14px 16px', marginBottom:16 }}>
                <h4 style={{ margin:'0 0 10px', fontSize:12, fontWeight:700, color:C.navy }}>
                  💰 {t.proj_section}
                </h4>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))', gap:8 }}>
                  {[
                    {l:t.proj_soumis,    v:real.projets.soumis,       c:C.blue},
                    {l:t.proj_obtenus,   v:real.projets.obtenus,      c:C.green},
                    {l:t.proj_taux,      v:real.projets.tauxSucces!==null?`${real.projets.tauxSucces}%`:'—', c:tauxColor(real.projets.tauxSucces)},
                    {l:t.proj_budget,    v:real.projets.budgetTotal.toLocaleString('fr-MA'), c:C.teal},
                    {l:t.proj_budget_pi, v:real.projets.budgetPI.toLocaleString('fr-MA'),   c:C.violet},
                    {l:t.proj_internat,  v:real.projets.internationaux, c:C.orange},
                  ].map(k=>(
                    <div key={k.l} style={{ background:C.g1, borderRadius:8, padding:'8px 10px', borderLeft:`3px solid ${k.c}` }}>
                      <p style={{ margin:'0 0 3px', fontSize:10, color:C.gt, lineHeight:1.3 }}>{k.l}</p>
                      <p style={{ margin:0, fontSize:15, fontWeight:700, color:C.gd }}>{k.v}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ background:'#fff', border:`0.5px solid ${C.g3}`, borderRadius:12, overflow:'hidden' }}>
                <div style={{ background:C.navy, padding:'10px 16px' }}>
                  <h3 style={{ color:'#fff', margin:0, fontSize:13, fontWeight:600 }}>{t.comparatif_title} — {annee}</h3>
                </div>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                  <thead><tr style={{ background:C.g1 }}>
                    {[t.col_indicator, t.col_prevu, t.col_revise, t.col_real, t.col_ecart, t.col_taux, t.col_statut].map((h,idx)=>(
                      <th key={idx} style={{ padding:'8px 12px', color:C.gt, fontWeight:600, textAlign:idx===0?'left':'center', fontSize:11 }}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {comparatif.filter(r=>r.A!==undefined||r.C!==undefined).map((r,i)=>(
                      <tr key={i} style={{ borderBottom:`0.5px solid ${C.g3}`, background:i%2===0?'#fff':C.g1 }}>
                        <td style={{ padding:'8px 12px', color:C.gd }}>{r.label}</td>
                        <td style={{ padding:'8px 12px', textAlign:'center', color:C.blue, fontWeight:600 }}>{r.A ?? '—'}</td>
                        <td style={{ padding:'8px 12px', textAlign:'center', color:C.teal, fontWeight:600 }}>{r.B ?? '—'}</td>
                        <td style={{ padding:'8px 12px', textAlign:'center', color:C.violet, fontWeight:600 }}>{r.C ?? '—'}</td>
                        <td style={{ padding:'8px 12px', textAlign:'center', fontWeight:700, color: r.ecart1===null?C.gt:r.ecart1>=0?C.green:C.red }}>{r.ecart1===null?'—':(r.ecart1>=0?'+':'')+r.ecart1}</td>
                        <td style={{ padding:'8px 12px', textAlign:'center', fontWeight:700, color: tauxColor(r.taux) }}>{r.taux===null?'—':r.taux+'%'}</td>
                        <td style={{ padding:'8px 12px', textAlign:'center' }}>
                          {r.taux!==null && <span style={{ background:tauxColor(r.taux)+'18', color:tauxColor(r.taux), fontSize:10, padding:'2px 8px', borderRadius:8, fontWeight:600 }}>{tauxLabel(r.taux)}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
        {toast && <Toast t={toast}/>}
      </div>
    )
  }

  // ── THANKS ─────────────────────────────────────────────────────────────
  if (view === 'thanks') return (
    <div style={{ minHeight:'100vh', background:C.g1, display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'system-ui,sans-serif', padding:20 }}>
      <div style={{ textAlign:'center', maxWidth:400 }}>
        <div style={{ width:64, height:64, borderRadius:'50%', background:'#D1FAE5', display:'flex', alignItems:'center', justifyContent:'center', fontSize:30, margin:'0 auto 16px' }}>✓</div>
        <h2 style={{ color:C.gd, fontSize:20, fontWeight:700, margin:'0 0 8px' }}>{t.thanks_title}</h2>
        <p style={{ color:C.gt, fontSize:13, lineHeight:1.6, margin:'0 0 22px' }}>{t.thanks_text}</p>
        <button onClick={()=>setView('home')} style={{ background:C.blue, color:'#fff', border:'none', borderRadius:10, padding:'11px 24px', fontSize:13, fontWeight:600, cursor:'pointer' }}>{t.thanks_back}</button>
      </div>
    </div>
  )

  // ── ADMIN — Responsable d'Axe / Direction / Présidence ──────────────────
  if (view === 'admin') {
    if (!adminOk) return (
      <div style={{ minHeight:'100vh', background:C.g1, display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'system-ui,sans-serif' }}>
        <style>{`*{box-sizing:border-box}button:hover{opacity:.87}input:focus{outline:none;border-color:#1A56DB!important}`}</style>
        <div style={{ background:'#fff', border:`0.5px solid ${C.g3}`, borderRadius:14, padding:'30px 26px', width:'100%', maxWidth:340 }}>
          <div style={{ width:50, height:50, borderRadius:12, background:'#EFF6FF', display:'flex', alignItems:'center', justifyContent:'center', fontSize:24, marginBottom:16 }}>🔒</div>
          <h2 style={{ margin:'0 0 6px', fontSize:16, fontWeight:700, color:C.gd }}>{t.admin_restricted}</h2>
          <p style={{ margin:'0 0 14px', fontSize:12, color:C.gt }}>{t.admin_level_hint}</p>
          <select value={adminRole} onChange={e=>setAdminRole(e.target.value)}
            style={{ width:'100%', padding:'9px 12px', border:`1.5px solid ${C.g3}`, borderRadius:8, fontSize:13, marginBottom:10, background:'#fff', boxSizing:'border-box' }}>
            <option value={ROLES.RESPONSABLE_AXE}>{ROLE_LABELS[ROLES.RESPONSABLE_AXE]}</option>
            <option value={ROLES.DIRECTION}>{ROLE_LABELS[ROLES.DIRECTION]}</option>

          </select>
          {adminRole===ROLES.RESPONSABLE_AXE && (
            <select value={adminAxe} onChange={e=>setAdminAxe(e.target.value)}
              style={{ width:'100%', padding:'9px 12px', border:`1.5px solid ${C.g3}`, borderRadius:8, fontSize:13, marginBottom:10, background:'#fff', boxSizing:'border-box' }}>
              {GSMI_AXES.map(a=><option key={a} value={a}>{a}</option>)}
            </select>
          )}
          <input type="password" value={adminCode} onChange={e=>setAdminCode(e.target.value)} placeholder={t.admin_code_ph}
            style={{ width:'100%', padding:'10px 12px', border:`1.5px solid ${C.g3}`, borderRadius:8, fontSize:13, boxSizing:'border-box', marginBottom:12 }}
            onKeyDown={e=>e.key==='Enter' && (adminCode===ADMIN_CODE?setAdminOk(true):showToast(t.wrong_code,'error'))}/>
          <button onClick={()=>adminCode===ADMIN_CODE?setAdminOk(true):showToast(t.wrong_code,'error')}
            style={{ width:'100%', background:C.navy, color:'#fff', border:'none', borderRadius:8, padding:'11px', fontSize:13, fontWeight:600, cursor:'pointer', marginBottom:8 }}>
            {t.admin_login}
          </button>
          <button onClick={()=>setView('home')} style={{ width:'100%', background:'transparent', color:C.gt, border:'none', fontSize:12, cursor:'pointer', padding:6 }}>{t.back}</button>
        </div>
        {toast && <Toast t={toast}/>}
      </div>
    )

    const chercheurs = getChercheurs()
    const affilies = getAffilies()
    const projets = getProjets()
    const publications = getPublications()
    const personnes = adminRole===ROLES.RESPONSABLE_AXE
      ? [...chercheurs, ...affilies].filter(p => (p.axe_principal||p.axe)===adminAxe)
      : [...chercheurs, ...affilies]

    const filteredPersonnes = personnes.filter(p =>
      !adminSearch || (p.nom||'').toLowerCase().includes(adminSearch.toLowerCase()) || (p.email||'').toLowerCase().includes(adminSearch.toLowerCase()))

    const alerts = computeAlertes({ chercheurs, affilies, projets, publications })

    const axeScores = GSMI_AXES.map(axe => {
      const people = [...chercheurs, ...affilies].filter(p => (p.axe_principal||p.axe)===axe)
      const reals = people.map(p => computeRealisations(p.email, annee))
      const totalPub = reals.reduce((a,r)=>a+r.publications.acceptees,0)
      const totalQ1 = reals.reduce((a,r)=>a+r.publications.q1,0)
      const totalCit = reals.reduce((a,r)=>a+r.impact.citations,0)
      const totalDoct = reals.reduce((a,r)=>a+r.formation.doctorants,0)
      const avgHIndex = people.length ? Math.round(people.reduce((a,p)=>a+(+p.h_index||0),0)/people.length*10)/10 : 0
      const totalRevenus = reals.reduce((a,r)=>a+r.prestations.revenus,0)
      const totalBrevets = reals.reduce((a,r)=>a+r.rayonnement.brevets,0)
      const scores = reals.map(computeScoreChercheur)
      const avgScore = scores.length ? Math.round(scores.reduce((a,s)=>a+s.total,0)/scores.length) : 0
      return { axe, effectif:people.length, totalPub, totalQ1, totalCit, totalDoct, avgHIndex, totalRevenus, totalBrevets, avgScore }
    }).sort((a,b)=>b.avgScore-a.avgScore)

    const TABS = adminRole===ROLES.RESPONSABLE_AXE
      ? [{id:'overview',l:t.tab_my_axis},{id:'people',l:t.tab_my_people},{id:'reports',l:t.tab_reports}]
      : [{id:'overview',l:t.tab_overview},{id:'axes',l:t.tab_axes},{id:'people',l:t.tab_people},{id:'reports',l:t.tab_reports},{id:'alerts',l:t.tab_alerts},{id:'audit',l:t.tab_audit}]

    return (
      <div style={{ minHeight:'100vh', background:C.g1, fontFamily:'system-ui,-apple-system,sans-serif' }}>
        <style>{`*{box-sizing:border-box}button:hover{opacity:.87}`}</style>
        <div style={{ background:C.navy, padding:'14px 20px', display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:10, position:'sticky', top:0, zIndex:10 }}>
          <div>
            <p style={{ color:C.gold, fontSize:10, letterSpacing:'.1em', margin:'0 0 2px', textTransform:'uppercase', fontWeight:600 }}>{ROLE_LABELS[adminRole]}{adminRole===ROLES.RESPONSABLE_AXE?` · ${adminAxe}`:''}</p>
            <h1 style={{ color:'#fff', fontSize:16, fontWeight:700, margin:0 }}>{t.admin_dashboard}</h1>
          </div>
          <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
            <select value={annee} onChange={e=>setAnnee(e.target.value)} style={{ padding:'7px 10px', borderRadius:7, border:'none', fontSize:12, background:'#1B2A3B', color:'#fff' }}>
              {ACADEMIC_YEARS.map(y=><option key={y} value={y}>{y}</option>)}
            </select>
            <button onClick={()=>{ setAdminOk(false); setAdminCode(''); setView('home') }} style={{ background:'transparent', color:'#8899BB', border:'1.5px solid #2D3F55', borderRadius:8, padding:'7px 12px', fontSize:11, cursor:'pointer' }}>{t.admin_logout}</button>
          </div>
        </div>

        <div style={{ background:'#fff', borderBottom:`1px solid ${C.g3}`, padding:'0 20px', display:'flex', gap:0, overflowX:'auto' }}>
          {TABS.map(tab => (
            <button key={tab.id} onClick={()=>setAdminTab(tab.id)}
              style={{ padding:'12px 16px', background:'none', border:'none', borderBottom:adminTab===tab.id?`3px solid ${C.blue}`:'3px solid transparent',
                       fontWeight:adminTab===tab.id?700:400, color:adminTab===tab.id?C.blue:C.gt, cursor:'pointer', fontSize:12, whiteSpace:'nowrap' }}>
              {tab.l}
            </button>
          ))}
        </div>

        <div style={{ maxWidth:1100, margin:'0 auto', padding:'20px 16px 40px' }}>

          {/* Vue d'ensemble */}
          {adminTab==='overview' && (() => {
            const reals = personnes.map(p => computeRealisations(p.email, annee))
            const totalPub = reals.reduce((a,r)=>a+r.publications.acceptees,0)
            const totalQ1 = reals.reduce((a,r)=>a+r.publications.q1,0)
            const totalCit = reals.reduce((a,r)=>a+r.impact.citations,0)
            const avgHIndex = personnes.length ? Math.round(personnes.reduce((a,p)=>a+(+p.h_index||0),0)/personnes.length*10)/10 : 0
            const totalDoct = reals.reduce((a,r)=>a+r.formation.doctorants,0)
            const totalRevenus = reals.reduce((a,r)=>a+r.prestations.revenus,0)
            const totalBrevets = reals.reduce((a,r)=>a+r.rayonnement.brevets,0)
            const totalPrest = reals.reduce((a,r)=>a+r.prestations.total,0)
            return (
              <div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))', gap:10, marginBottom:20 }}>
                  {[
                    {l:t.kpi_effectif, v:personnes.length, c:C.navy},
                    {l:t.kpi_publications, v:totalPub, c:C.teal},
                    {l:t.kpi_q1, v:totalQ1, c:C.green},
                    {l:t.kpi_citations, v:totalCit, c:C.violet},
                    {l:t.kpi_hindex, v:avgHIndex, c:C.blue},
                    {l:t.kpi_doctorants, v:totalDoct, c:C.orange},
                    {l:t.kpi_prestations, v:totalPrest, c:C.amber},
                    {l:t.kpi_revenus, v:totalRevenus.toLocaleString('fr-MA'), c:C.green},
                    {l:t.kpi_brevets, v:totalBrevets, c:C.red},
                  ].map(k=>(
                    <div key={k.l} style={{ background:'#fff', border:`0.5px solid ${C.g3}`, borderRadius:10, padding:'12px 14px', borderTop:`3px solid ${k.c}` }}>
                      <p style={{ margin:'0 0 5px', fontSize:10, color:C.gt }}>{k.l}</p>
                      <p style={{ margin:0, fontSize:18, fontWeight:700, color:C.gd }}>{k.v}</p>
                    </div>
                  ))}
                </div>
                {adminRole===ROLES.DIRECTION && (
                  <div style={{ background:'#fff', border:`0.5px solid ${C.g3}`, borderRadius:12, padding:'16px 18px' }}>
                    <p style={{ margin:'0 0 10px', fontSize:12, fontWeight:700, color:C.navy }}>{t.ranking_title}</p>
                    {axeScores.map((a,i)=>(
                      <div key={a.axe} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 0', borderBottom:i<axeScores.length-1?`0.5px solid ${C.g3}`:'none' }}>
                        <span style={{ fontSize:12, color:C.gd }}>{i===0?'🥇':i===1?'🥈':'🥉'} {a.axe}</span>
                        <span style={{ fontSize:13, fontWeight:700, color:C.blue }}>{a.avgScore}/100</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })()}

          {/* KPI par Axe */}
          {adminTab==='axes' && (
            <div>
              {axeScores.map((a,i) => {
                const col = [C.teal,C.green,C.violet][i%3]
                return (
                  <div key={a.axe} style={{ background:'#fff', border:`0.5px solid ${C.g3}`, borderRadius:12, marginBottom:14, overflow:'hidden' }}>
                    <div style={{ background:col, padding:'11px 16px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                      <h3 style={{ color:'#fff', margin:0, fontSize:13, fontWeight:700 }}>{a.axe}</h3>
                      <span style={{ background:'rgba(255,255,255,.2)', color:'#fff', borderRadius:6, padding:'2px 9px', fontSize:11 }}>{a.effectif} pers. · Score {a.avgScore}/100</span>
                    </div>
                    <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(110px,1fr))' }}>
                      {[
                        {l:t.kpi_publications, v:a.totalPub}, {l:'Q1', v:a.totalQ1}, {l:t.kpi_citations, v:a.totalCit},
                        {l:t.kpi_doctorants, v:a.totalDoct}, {l:'H-index moy.', v:a.avgHIndex}, {l:t.kpi_brevets, v:a.totalBrevets},
                        {l:t.kpi_revenus, v:a.totalRevenus.toLocaleString('fr-MA')},
                      ].map((k,j)=>(
                        <div key={k.l} style={{ padding:'11px 13px', borderTop:`0.5px solid ${C.g3}`, borderRight:`0.5px solid ${C.g3}` }}>
                          <p style={{ margin:'0 0 4px', fontSize:10, color:C.gt }}>{k.l}</p>
                          <p style={{ margin:0, fontSize:15, fontWeight:700, color:C.gd }}>{k.v}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Chercheurs & Affiliés */}
          {adminTab==='people' && (
            <div>
              <input value={adminSearch} onChange={e=>setAdminSearch(e.target.value)} placeholder="Rechercher (nom ou email)…"
                style={{ width:'100%', maxWidth:340, padding:'9px 12px', border:`1.5px solid ${C.g3}`, borderRadius:8, fontSize:13, outline:'none', marginBottom:14 }}/>
              <div style={{ background:'#fff', border:`0.5px solid ${C.g3}`, borderRadius:12, overflow:'auto' }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12, minWidth:760 }}>
                  <thead><tr style={{ background:C.navy }}>
                    {['Nom','Grade','Axe','Pub. acc.','Q1',t.kpi_citations,'Score','Rapport'].map(h=>(
                      <th key={h} style={{ padding:'9px 11px', color:'#fff', fontWeight:600, textAlign:'left', fontSize:10 }}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {filteredPersonnes.length===0
                      ? <tr><td colSpan={8} style={{ padding:'28px', textAlign:'center', color:C.gt }}>{t.no_results}</td></tr>
                      : filteredPersonnes.map((p,i) => {
                          const real = computeRealisations(p.email, annee)
                          const score = computeScoreChercheur(real)
                          return (
                            <tr key={i} style={{ borderBottom:`0.5px solid ${C.g3}`, background:i%2===0?'#fff':C.g1 }}>
                              <td style={{ padding:'8px 11px', fontWeight:600, color:C.gd }}>{p.nom}<br/><span style={{fontSize:9,color:C.gt,fontWeight:400}}>{p.email}</span></td>
                              <td style={{ padding:'8px 11px', color:C.gt }}>{p.grade}</td>
                              <td style={{ padding:'8px 11px', color:C.gt, fontSize:10 }}>{(p.axe_principal||p.axe||'').replace('Mining and Mineral Processing (MMP)','MMP').replace('Sustainability and Mining Environment (SME)','SME')}</td>
                              <td style={{ padding:'8px 11px', textAlign:'center' }}>{real.publications.acceptees}</td>
                              <td style={{ padding:'8px 11px', textAlign:'center' }}>{real.publications.q1}</td>
                              <td style={{ padding:'8px 11px', textAlign:'center' }}>{real.impact.citations}</td>
                              <td style={{ padding:'8px 11px', textAlign:'center', fontWeight:700, color: score.total>=70?C.green:score.total>=40?C.amber:C.red }}>{score.total}</td>
                              <td style={{ padding:'8px 11px' }}>
                                <button onClick={()=>generateRapportChercheur(p, annee)} style={{ padding:'5px 10px', background:C.navy, color:'#fff', border:'none', borderRadius:6, fontSize:10, cursor:'pointer', whiteSpace:'nowrap' }}>⬇ Excel</button>
                              </td>
                            </tr>
                          )
                        })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Rapports */}
          {adminTab==='reports' && (
            <div style={{ display:'grid', gap:14 }}>
              <div style={{ background:'#fff', border:`0.5px solid ${C.g3}`, borderRadius:12, padding:'18px 20px' }}>
                <h3 style={{ margin:'0 0 10px', fontSize:13, fontWeight:700, color:C.navy }}>📄 {t.report_inst_title} ({annee})</h3>
                <p style={{ margin:'0 0 12px', fontSize:12, color:C.gt }}>{t.report_inst_desc}</p>
                <button onClick={()=>generateRapportInstitutionnel(chercheurs, affilies, annee)} style={{ padding:'9px 16px', background:C.navy, color:'#fff', border:'none', borderRadius:8, fontSize:12, fontWeight:600, cursor:'pointer' }}>{t.report_inst_btn}</button>
              </div>
              {adminRole===ROLES.DIRECTION ? GSMI_AXES.map(axe => (
                <div key={axe} style={{ background:'#fff', border:`0.5px solid ${C.g3}`, borderRadius:12, padding:'16px 18px' }}>
                  <h4 style={{ margin:'0 0 8px', fontSize:12, fontWeight:700, color:C.navy }}>{axe}</h4>
                  <button onClick={()=>generateRapportAxe(axe, [...chercheurs,...affilies].filter(p=>(p.axe_principal||p.axe)===axe), annee)}
                    style={{ padding:'7px 14px', background:C.blue, color:'#fff', border:'none', borderRadius:8, fontSize:11, cursor:'pointer' }}>{t.report_axe_btn}</button>
                </div>
              )) : (
                <div style={{ background:'#fff', border:`0.5px solid ${C.g3}`, borderRadius:12, padding:'16px 18px' }}>
                  <h4 style={{ margin:'0 0 8px', fontSize:12, fontWeight:700, color:C.navy }}>{adminAxe}</h4>
                  <button onClick={()=>generateRapportAxe(adminAxe, personnes, annee)} style={{ padding:'7px 14px', background:C.blue, color:'#fff', border:'none', borderRadius:8, fontSize:11, cursor:'pointer' }}>{t.report_axe_btn}</button>
                </div>
              )}
            </div>
          )}

          {/* Alertes */}
          {adminTab==='alerts' && (
            <div style={{ background:'#fff', border:`0.5px solid ${C.g3}`, borderRadius:12, padding:'16px 18px' }}>
              <h3 style={{ margin:'0 0 12px', fontSize:13, fontWeight:700, color:C.navy }}>⚠️ {t.alerts_title} ({alerts.length})</h3>
              {alerts.length===0 ? <p style={{ color:C.gt, fontSize:12 }}>{t.no_alerts}</p> : alerts.map((a,i)=>(
                <div key={i} style={{ display:'flex', gap:10, padding:'9px 0', borderBottom:i<alerts.length-1?`0.5px solid ${C.g3}`:'none' }}>
                  <span style={{ fontSize:14 }}>{a.severity==='error'?'🔴':a.severity==='warning'?'🟡':'ℹ️'}</span>
                  <span style={{ fontSize:12, color:C.gd }}>{a.msg}</span>
                </div>
              ))}
            </div>
          )}

          {/* Audit log + reset (Direction seulement) */}
          {adminTab==='audit' && (
            <div>
              <div style={{ background:'#fff', border:`0.5px solid ${C.g3}`, borderRadius:12, padding:'16px 18px', marginBottom:14 }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
                  <h3 style={{ margin:0, fontSize:13, fontWeight:700, color:C.navy }}>📜 {t.audit_title}</h3>
                  <span style={{ fontSize:11, color:C.gt }}>{t.storage_used} : {getStorageSizeKB()} Ko</span>
                </div>
                <div style={{ maxHeight:340, overflowY:'auto' }}>
                  {getAuditLog(100).map((l,i)=>(
                    <div key={i} style={{ fontSize:11, padding:'5px 0', borderBottom:`0.5px solid ${C.g3}`, color:C.gt }}>
                      <strong style={{color:C.gd}}>{l.table}</strong> · {l.action} · {l.summary} · {new Date(l.ts).toLocaleString('fr-MA')}
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ background:'#FEF2F2', border:`1px solid ${C.red}30`, borderRadius:12, padding:'16px 18px' }}>
                <p style={{ margin:'0 0 10px', fontSize:12, color:C.red, fontWeight:600 }}>{t.danger_zone}</p>
                <button onClick={()=>{ if(confirm(t.reset_confirm)){ clearAllData(); showToast('Données effacées','warning'); bump() } }}
                  style={{ padding:'8px 16px', background:C.red, color:'#fff', border:'none', borderRadius:8, fontSize:12, cursor:'pointer' }}>
                  🗑 Réinitialiser toutes les données
                </button>
              </div>
            </div>
          )}
        </div>
        {toast && <Toast t={toast}/>}
      </div>
    )
  }

  // ── RÉCAPITULATIF PROFESSEUR ────────────────────────────────────────────
  if (view === 'recap') {
    const chercheur = myEmail ? (getChercheur(myEmail) || getAffilie(myEmail)) : null
    const prev  = myEmail ? getPrevision(myEmail, annee) : null
    const revs  = myEmail ? getRevisions(myEmail, annee) : []
    const real  = myEmail && chercheur ? computeRealisations(myEmail, annee) : null
    const comparatif = real ? buildComparatif(prev, revs[revs.length-1]||null, real) : []
    const score = real ? computeScoreChercheur(real) : null
    const pubs  = myEmail ? getPublicationsByDeclarant(myEmail) : []

    return (
      <div style={{ minHeight:'100vh', background:C.g1, fontFamily:'system-ui,-apple-system,sans-serif' }}>
        <style>{`*{box-sizing:border-box}button:hover{opacity:.87}`}</style>
        <div style={{ background:C.navy, padding:'14px 20px', position:'sticky', top:0, zIndex:10 }}>
          <div style={{ maxWidth:960, margin:'0 auto', display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, flexWrap:'wrap' }}>
            <div>
              <p style={{ color:C.gold, fontSize:10, margin:'0 0 2px', fontWeight:600, textTransform:'uppercase', letterSpacing:'.1em' }}>GSMI / UM6P</p>
              <h1 style={{ color:'#fff', fontSize:16, fontWeight:700, margin:0 }}>
                {lang==='fr'?'Mon récapitulatif':'My Summary'}
              </h1>
            </div>
            <button onClick={() => setView('home')} style={{ background:'transparent', border:'1.5px solid #2D3F55', color:'#8899BB', borderRadius:8, padding:'8px 14px', fontSize:12, cursor:'pointer' }}>
              {t.back_home}
            </button>
          </div>
        </div>

        <div style={{ maxWidth:960, margin:'0 auto', padding:'20px 16px 40px' }}>
          {/* Saisie email + année */}
          <div style={{ background:'#fff', border:`0.5px solid ${C.g3}`, borderRadius:12, padding:'16px 18px', marginBottom:16, display:'flex', gap:10, flexWrap:'wrap', alignItems:'flex-end' }}>
            <div style={{ flex:1, minWidth:200 }}>
              <label style={{ fontSize:12, fontWeight:600, color:C.gd, display:'block', marginBottom:5 }}>Email</label>
              <input value={myEmail} onChange={e=>setMyEmail(e.target.value)} placeholder={t.email_ph}
                style={{ width:'100%', padding:'9px 12px', border:`1.5px solid ${C.g3}`, borderRadius:8, fontSize:13, outline:'none', boxSizing:'border-box' }}/>
            </div>
            <div>
              <label style={{ fontSize:12, fontWeight:600, color:C.gd, display:'block', marginBottom:5 }}>{lang==='fr'?'Année académique':'Academic year'}</label>
              <select value={annee} onChange={e=>setAnnee(e.target.value)}
                style={{ padding:'9px 12px', border:`1.5px solid ${C.g3}`, borderRadius:8, fontSize:13, outline:'none', background:'#fff' }}>
                {ACADEMIC_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <button onClick={bump} style={{ padding:'9px 18px', background:C.navy, color:'#fff', border:'none', borderRadius:8, fontSize:13, fontWeight:600, cursor:'pointer' }}>
              {t.dash_load_btn}
            </button>
          </div>

          {!chercheur ? (
            <div style={{ background:'#fff', border:`0.5px solid ${C.g3}`, borderRadius:12, padding:'40px', textAlign:'center', color:C.gt }}>
              {lang==='fr'?'Saisissez votre email et cliquez "Charger" pour voir votre récapitulatif.':'Enter your email and click "Load" to view your summary.'}
            </div>
          ) : (
            <>
              {/* Identité + score */}
              <div style={{ background:'#fff', border:`0.5px solid ${C.g3}`, borderRadius:12, padding:'18px 20px', marginBottom:14, display:'flex', alignItems:'center', gap:16, flexWrap:'wrap' }}>
                {score && <ScoreBadge score={score.total} size="lg"/>}
                <div>
                  <p style={{ margin:'0 0 3px', fontSize:17, fontWeight:700, color:C.gd }}>{chercheur.prenom} {chercheur.nom}</p>
                  <p style={{ margin:'0 0 3px', fontSize:12, color:C.gt }}>{chercheur.grade} · {chercheur.axe_principal||chercheur.axe}</p>
                  {chercheur.orcid && <p style={{ margin:0, fontSize:11, color:C.gt }}>ORCID: {chercheur.orcid}</p>}
                  {chercheur.linkedin && <a href={chercheur.linkedin} target="_blank" rel="noreferrer" style={{ fontSize:11, color:C.blue }}>LinkedIn →</a>}
                </div>
                <div style={{ marginLeft:'auto', display:'flex', gap:8, flexWrap:'wrap' }}>
                  <button onClick={() => openCVForPrint(chercheur, {lang:'fr', short:false})} style={{ padding:'8px 13px', background:C.blue, color:'#fff', border:'none', borderRadius:8, fontSize:11, cursor:'pointer' }}>{t.cv_fr}</button>
                  <button onClick={() => openCVForPrint(chercheur, {lang:'en', short:true})} style={{ padding:'8px 13px', background:C.violet, color:'#fff', border:'none', borderRadius:8, fontSize:11, cursor:'pointer' }}>{t.cv_en}</button>
                  <button onClick={() => generateRapportChercheur(chercheur, annee)} style={{ padding:'8px 13px', background:C.green, color:'#fff', border:'none', borderRadius:8, fontSize:11, cursor:'pointer' }}>{t.report_excel}</button>
                </div>
              </div>

              {/* Prévisions saisies */}
              {prev ? (
                <div style={{ background:'#fff', border:`0.5px solid ${C.g3}`, borderRadius:12, padding:'16px 18px', marginBottom:14 }}>
                  <h3 style={{ margin:'0 0 12px', fontSize:13, fontWeight:700, color:C.blue }}>🎯 {lang==='fr'?'Prévisions annuelles saisies':'Annual forecasts entered'} — {annee}</h3>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))', gap:8 }}>
                    {[
                      {l:lang==='fr'?'Pub. soumises':'Sub. pub.',        v:prev.pub_soumises||0},
                      {l:lang==='fr'?'Pub. acceptées':'Acc. pub.',       v:prev.pub_acceptees||0},
                      {l:'Q1',                                             v:prev.pub_q1||0},
                      {l:lang==='fr'?'Doctorants':'PhD students',         v:prev.doctorants||0},
                      {l:'PFE',                                            v:prev.pfe||0},
                      {l:lang==='fr'?'Projets':'Projects',                v:prev.projets_obtenus||0},
                      {l:lang==='fr'?'Conférences':'Conferences',         v:prev.conferences||0},
                      {l:lang==='fr'?'Prestations':'Consulting',          v:prev.prestations||0},
                    ].map(k => (
                      <div key={k.l} style={{ background:C.g1, borderRadius:8, padding:'8px 12px', borderLeft:`3px solid ${C.blue}` }}>
                        <p style={{ margin:'0 0 2px', fontSize:10, color:C.gt }}>{k.l}</p>
                        <p style={{ margin:0, fontSize:16, fontWeight:700, color:C.gd }}>{k.v}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div style={{ background:'#FFF8E6', border:`1px solid ${C.gold}30`, borderRadius:10, padding:'12px 16px', marginBottom:14, borderLeft:`3px solid ${C.gold}` }}>
                  <p style={{ margin:0, fontSize:12, color:C.amber }}>
                    ⚠ {lang==='fr'?'Aucune prévision saisie pour cette année. Remplissez la rubrique "Prévisions & Révisions".':'No forecast entered for this year. Fill in the "Forecasts & Revisions" section.'}
                  </p>
                </div>
              )}

              {/* Historique révisions */}
              {revs.length > 0 && (
                <div style={{ background:'#fff', border:`0.5px solid ${C.g3}`, borderRadius:12, padding:'16px 18px', marginBottom:14 }}>
                  <h3 style={{ margin:'0 0 12px', fontSize:13, fontWeight:700, color:C.teal }}>🔄 {lang==='fr'?'Historique des révisions':'Revision history'}</h3>
                  {revs.map((rev, i) => (
                    <div key={i} style={{ padding:'10px 12px', background:i%2===0?C.g1:'#fff', borderRadius:8, marginBottom:6 }}>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:10 }}>
                        <div>
                          <p style={{ margin:'0 0 3px', fontSize:12, fontWeight:600, color:C.gd }}>
                            {lang==='fr'?'Révision':'Revision'} #{i+1}
                          </p>
                          {rev.motif && <p style={{ margin:0, fontSize:11, color:C.gt }}>{rev.motif}</p>}
                        </div>
                        <span style={{ fontSize:10, color:C.gt, whiteSpace:'nowrap' }}>{new Date(rev.date).toLocaleDateString(lang==='fr'?'fr-MA':'en-US')}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Tableau comparatif Prévu / Réalisé */}
              {real && comparatif.length > 0 && (
                <div style={{ background:'#fff', border:`0.5px solid ${C.g3}`, borderRadius:12, overflow:'hidden', marginBottom:14 }}>
                  <div style={{ background:C.navy, padding:'10px 16px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <h3 style={{ color:'#fff', margin:0, fontSize:13, fontWeight:600 }}>{t.comparatif_title} — {annee}</h3>
                  </div>
                  <div style={{ overflowX:'auto' }}>
                    <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                      <thead>
                        <tr style={{ background:C.g1 }}>
                          {[t.col_indicator, t.col_prevu, t.col_revise, t.col_real, t.col_ecart, t.col_taux, t.col_statut].map((h,idx) => (
                            <th key={idx} style={{ padding:'8px 12px', color:C.gt, fontWeight:600, textAlign:idx===0?'left':'center', fontSize:11, whiteSpace:'nowrap' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {comparatif.filter(r => r.A!==undefined || r.C!==undefined).map((r,i) => (
                          <tr key={i} style={{ borderBottom:`0.5px solid ${C.g3}`, background:i%2===0?'#fff':C.g1 }}>
                            <td style={{ padding:'8px 12px', color:C.gd, fontWeight:500 }}>{fieldLabel(r.label, lang)}</td>
                            <td style={{ padding:'8px 12px', textAlign:'center', color:C.blue, fontWeight:600 }}>{r.A??'—'}</td>
                            <td style={{ padding:'8px 12px', textAlign:'center', color:C.teal, fontWeight:600 }}>{r.B??'—'}</td>
                            <td style={{ padding:'8px 12px', textAlign:'center', color:C.violet, fontWeight:600 }}>{r.C??'—'}</td>
                            <td style={{ padding:'8px 12px', textAlign:'center', fontWeight:700, color:r.ecart1===null?C.gt:r.ecart1>=0?C.green:C.red }}>
                              {r.ecart1===null?'—':(r.ecart1>=0?'+':'')+r.ecart1}
                            </td>
                            <td style={{ padding:'8px 12px', textAlign:'center', fontWeight:700, color:tauxColor(r.taux) }}>
                              {r.taux===null?'—':r.taux+'%'}
                            </td>
                            <td style={{ padding:'8px 12px', textAlign:'center' }}>
                              {r.taux!==null && (
                                <span style={{ background:tauxColor(r.taux)+'18', color:tauxColor(r.taux), fontSize:10, padding:'2px 8px', borderRadius:8, fontWeight:600 }}>
                                  {tauxLabel(r.taux)}
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Publications */}
              {pubs.length > 0 && (
                <div style={{ background:'#fff', border:`0.5px solid ${C.g3}`, borderRadius:12, padding:'16px 18px', marginBottom:14 }}>
                  <h3 style={{ margin:'0 0 12px', fontSize:13, fontWeight:700, color:C.teal }}>🔬 {lang==='fr'?'Mes publications':'My publications'} ({pubs.length})</h3>
                  {pubs.slice(0,10).map((p,i) => {
                    const decl = (p.declarants||[]).find(d => d.email === myEmail)
                    return (
                      <div key={i} style={{ padding:'8px 0', borderBottom:`0.5px solid ${C.g3}` }}>
                        <p style={{ margin:'0 0 2px', fontSize:12, fontWeight:600, color:C.gd, lineHeight:1.3 }}>{p.title}</p>
                        <p style={{ margin:0, fontSize:11, color:C.gt }}>
                          {p.source&&<span>{p.source} · </span>}
                          {p.year&&<span>{p.year} · </span>}
                          {p.quartile&&p.quartile!=='Non classé'&&<span style={{color:C.green,fontWeight:600}}>{p.quartile} · </span>}
                          {decl?.position&&<span style={{color:C.blue}}>{decl.position} · </span>}
                          <span style={{color:p.statut==='Publiée'?C.green:p.statut==='Acceptée'?C.teal:C.gt}}>{p.statut}</span>
                        </p>
                      </div>
                    )
                  })}
                  {pubs.length > 10 && <p style={{ margin:'8px 0 0', fontSize:11, color:C.gt }}>{lang==='fr'?`… et ${pubs.length-10} autre(s) publication(s)`:`… and ${pubs.length-10} more publication(s)`}</p>}
                </div>
              )}
            </>
          )}
        </div>
        {toast && <Toast t={toast}/>}
      </div>
    )
  }

  return null
}
