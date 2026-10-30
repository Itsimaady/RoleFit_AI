import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Bot, CheckCircle2, FileDown, FileText, ListChecks, Lock, MessageSquare, Mic, Sparkles, Target } from 'lucide-react';
import { Brand } from '../components/Brand.jsx';
import { Badge } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { ResumePreview } from '../features/resumes/ResumePreview.jsx';

// Illustrative content for the product preview. It is labelled "Sample" in the
// UI and rendered with the same components the app uses — no metrics or claims.
const SAMPLE_RESUME = {
  template: 'modern',
  personal: { fullName: 'Ananya Iyer', headline: 'Computer Science Student · Backend Developer', email: 'ananya@example.com', location: 'Bengaluru, India', github: 'github.com/ananya' },
  summary: 'Final-year student who builds REST APIs with Node.js and Python, focused on reliable, well-tested services.',
  skills: { technical: ['JavaScript', 'Node.js', 'Express.js', 'MongoDB', 'Python', 'Git'], interpersonal: ['Teamwork'] },
  experience: [{ _key: 'e', role: 'Backend Intern', organization: 'Example Labs', startDate: 'May 2025', endDate: 'Jul 2025', bullets: ['Built REST endpoints with Express and MongoDB for an internal tool.', 'Added request validation and integration tests.'] }],
  projects: [{ _key: 'p', name: 'Campus Events App', technologies: ['React', 'Node.js'], bullets: ['Developed a MERN app with role-based access.'] }],
  education: [{ _key: 'ed', institution: 'Example Institute of Technology', degree: 'B.Tech', field: 'Computer Science', startDate: '2022', endDate: '2026' }],
};

const STEPS = [
  { icon: FileText, title: 'Build your resume', text: 'Guided sections and a live preview. Export a text-based PDF or an editable Word file.' },
  { icon: Target, title: 'Match it to a real job', text: 'Paste a posting to see the skills you already show, where the evidence is, and what is missing.' },
  { icon: MessageSquare, title: 'Practise the interview', text: 'Answer 12 role-specific questions out loud with a live AI interviewer and review the feedback.' },
];

function ProductPreview() {
  return (
    <div className="preview-wrap">
      <div className="app-window" aria-label="Illustration of the RoleFit AI workspace with sample content">
        <div className="app-window-bar" aria-hidden="true">
          <i />
          <i />
          <i />
          <span className="url">rolefit.app/app/analyses</span>
          <span className="example">
            <Badge>Sample content</Badge>
          </span>
        </div>
        <div className="app-window-body">
          <div className="paper-col" aria-hidden="true">
            <ResumePreview resume={SAMPLE_RESUME} />
          </div>
          <div className="insight-col">
            <div className="mini-card">
              <h4>
                <CheckCircle2 size={15} color="var(--success)" /> Skills you demonstrate
              </h4>
              <div className="chip-list">
                {['Node.js', 'Express.js', 'MongoDB', 'REST APIs', 'Git'].map((s) => (
                  <span className="chip tone-success" key={s}>
                    {s}
                  </span>
                ))}
              </div>
              <p className="xsmall muted">Each match links to the resume section that proves it.</p>
            </div>
            <div className="mini-card">
              <h4>
                <AlertTriangle size={15} color="var(--warning)" /> Requested but not found
              </h4>
              <div className="chip-list">
                <span className="chip tone-danger">Docker</span>
                <span className="chip tone-danger">CI/CD</span>
                <span className="chip">TypeScript · preferred</span>
              </div>
            </div>
            <div className="mini-card ai-surface">
              <span className="ai-label">
                <Sparkles size={12} /> AI interviewer
              </span>
              <div className="bubble ai">Walk me through how you validated requests in your internship API.</div>
              <div className="bubble me">I added schema validation on every route and returned field-level errors…</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const FEATURES = [
  {
    icon: FileText,
    title: 'A resume workspace, not a form',
    text: 'Edit section by section with a live, print-accurate preview. Three ATS-conscious templates, PDF and DOCX export, duplicates for every role you apply to.',
    visual: (
      <>
        <div className="check-line">
          <CheckCircle2 size={15} color="var(--success)" /> Personal info, education, experience, projects, skills
        </div>
        <div className="check-line">
          <FileDown size={15} color="var(--accent)" /> PDF (selectable text) · DOCX in seven layouts
        </div>
      </>
    ),
  },
  {
    icon: Target,
    title: 'Job matching you can verify',
    text: 'A documented, deterministic method compares your resume with the posting. You see exactly which skills matched and where in your resume they were found.',
    visual: (
      <div className="chip-list">
        <span className="chip tone-success">Matched · with evidence</span>
        <span className="chip tone-danger">Required gap</span>
        <span className="chip">Preferred gap</span>
      </div>
    ),
  },
  {
    icon: ListChecks,
    title: 'Skill gaps and honest fixes',
    text: 'Specific suggestions for vague bullets, missing contact details and inconsistent dates — each with the reason it matters. Never “add skills you don’t have”.',
    visual: (
      <>
        <div className="check-line">
          <AlertTriangle size={15} color="var(--warning)" /> “Worked on the website” → say what you built and the result
        </div>
        <div className="check-line">
          <CheckCircle2 size={15} color="var(--success)" /> AI rewrites keep your facts; you accept or reject each one
        </div>
      </>
    ),
  },
  {
    icon: Mic,
    ai: true,
    title: 'Live AI mock interviews',
    text: 'A real-time voice conversation powered by Gemini Live, with questions drawn from your resume and the job. Per-answer feedback, clearly labelled as AI-generated.',
    visual: (
      <div className="row" style={{ gap: 10 }}>
        <span className="row-icon" style={{ background: 'var(--ai-soft)', color: 'var(--ai)' }}>
          <Bot size={16} />
        </span>
        <span className="small" style={{ color: 'var(--text-2)' }}>
          12 questions · introduction, resume deep-dive, technical, behavioural, closing
        </span>
      </div>
    ),
  },
];

const PRINCIPLES = [
  ['Coverage, not “ATS scores”', 'Match results are measures with a published method, not a prediction of hiring.'],
  ['Your facts stay yours', 'Suggestions never invent metrics, skills or experience.'],
  ['Private by default', 'Hashed passwords, private resumes, camera analysis only in your browser.'],
  ['Honest about AI', 'AI feedback is labelled approximate; fallbacks are marked as estimates.'],
];

export function LandingPage() {
  const { status } = useAuth();
  const authed = status === 'authenticated';

  return (
    <div className="landing">
      <a href="#content" className="skip-link">
        Skip to content
      </a>
      <header className="site-header">
        <div className="site-header-inner">
          <Brand />
          <nav className="site-nav" aria-label="Page sections">
            <a href="#how">How it works</a>
            <a href="#features">Features</a>
            <a href="#principles">Principles</a>
          </nav>
          <div className="spacer" />
          {authed ? (
            <Link className="btn btn-primary" to="/app">
              Open dashboard <ArrowRight size={15} />
            </Link>
          ) : (
            <div className="row">
              <Link className="btn btn-ghost hide-sm" to="/login">
                Sign in
              </Link>
              <Link className="btn btn-primary" to="/register">
                Get started
              </Link>
            </div>
          )}
        </div>
      </header>

      <main id="content">
        <section className="hero">
          <div className="section-inner">
            <span className="eyebrow">
              <span className="pill-dot">For students</span> Resume, job match and live AI interviews in one workflow
            </span>
            <h1>
              Build your resume. <span className="grad">Match your goals.</span> Practice with confidence.
            </h1>
            <p className="lead">RoleFit AI helps students and freshers turn a resume into evidence for a specific role — then rehearse the interview for it.</p>
            <div className="hero-actions">
              <Link className="btn btn-primary btn-lg" to={authed ? '/app' : '/register'}>
                {authed ? 'Go to your dashboard' : 'Create a free account'} <ArrowRight size={17} />
              </Link>
              <a className="btn btn-lg" href="#how">
                See how it works
              </a>
            </div>
            <p className="hero-note">Preparation tools only — no guarantee of interviews, ATS selection or offers.</p>
            <ProductPreview />
          </div>
        </section>

        <section className="section section-alt" id="how">
          <div className="section-inner">
            <div className="section-head center">
              <span className="kicker">How it works</span>
              <h2>Three steps that build on each other</h2>
              <p>Your saved resume powers the job match, and both power a personalised interview.</p>
            </div>
            <div className="steps-row">
              {STEPS.map(({ icon: Icon, title, text }, i) => (
                <div className="card step-card" key={title}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <span className="feature-icon">
                      <Icon size={18} />
                    </span>
                    <span className="num">0{i + 1}</span>
                  </div>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="section" id="features">
          <div className="section-inner">
            <div className="section-head">
              <span className="kicker">Features</span>
              <h2>Everything you need for your first role</h2>
              <p>Built around real evidence from your own experience, not keyword stuffing.</p>
            </div>
            <div className="feature-grid">
              {FEATURES.map(({ icon: Icon, title, text, visual, ai }) => (
                <article className={`card feature${ai ? ' ai-surface' : ''}`} key={title}>
                  <span className={`feature-icon${ai ? ' ai' : ''}`}>
                    <Icon size={18} />
                  </span>
                  <div>
                    <h3>{title}</h3>
                    <p>{text}</p>
                  </div>
                  <div className="feature-visual">{visual}</div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="section section-alt" id="principles">
          <div className="section-inner stack" style={{ gap: 40 }}>
            <div className="section-head" style={{ marginBottom: 0 }}>
              <span className="kicker">Principles</span>
              <h2>Honest by design</h2>
            </div>
            <div className="principles">
              {PRINCIPLES.map(([title, text]) => (
                <div className="card principle" key={title}>
                  <b>{title}</b>
                  <p>{text}</p>
                </div>
              ))}
            </div>
            <div className="cta">
              <div>
                <h2>Start with your resume</h2>
                <p>Create an account and build your first version in a few minutes.</p>
              </div>
              <Link className="btn btn-lg" to={authed ? '/app/resumes' : '/register'}>
                {authed ? 'Open resumes' : 'Create your account'} <ArrowRight size={17} />
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="section-inner">
          <div className="footer-grid">
            <div className="stack" style={{ gap: 10 }}>
              <Brand />
              <p className="small muted" style={{ maxWidth: 320 }}>
                A student career preparation platform: resume builder, job matching and live mock interviews.
              </p>
            </div>
            <div>
              <h4>Product</h4>
              <ul>
                <li>
                  <a href="#how">How it works</a>
                </li>
                <li>
                  <a href="#features">Features</a>
                </li>
                <li>
                  <a href="#principles">Principles</a>
                </li>
              </ul>
            </div>
            <div>
              <h4>Account</h4>
              <ul>
                <li>
                  <Link to="/register">Create account</Link>
                </li>
                <li>
                  <Link to="/login">Sign in</Link>
                </li>
              </ul>
            </div>
          </div>
          <div className="footer-bottom">
            <span>© {new Date().getFullYear()} RoleFit AI</span>
            <span className="row" style={{ gap: 6 }}>
              <Lock size={12} /> Built with React, Express, MongoDB and Gemini
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
