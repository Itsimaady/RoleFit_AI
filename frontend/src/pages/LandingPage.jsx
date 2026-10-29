import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, FileDown, FileText, Lock, MessageSquare, Target, Wand2 } from 'lucide-react';
import { Brand } from '../components/Brand.jsx';
import { useAuth } from '../context/AuthContext.jsx';

const FEATURES = [
  { icon: FileText, title: 'Structured resume builder', text: 'Guided sections for education, internships, projects and skills, with a live preview and three ATS-conscious templates.' },
  { icon: Target, title: 'Explainable job matching', text: 'See which of the job’s skills your resume demonstrates, where the evidence is, and what is missing — with the method spelled out.' },
  { icon: Wand2, title: 'Honest improvement checklist', text: 'Specific feedback on vague bullets, missing contact details and inconsistent dates. AI rewrites never add facts you did not provide.' },
  { icon: FileDown, title: 'Real PDF and DOCX export', text: 'Download a text-based PDF that applicant tracking systems can read, or an editable Word document in one of seven layouts.' },
  { icon: MessageSquare, title: 'Live AI mock interviews', text: 'A voice interview with 12 questions personalised from your resume and the job, followed by feedback on every answer.' },
  { icon: Lock, title: 'Your data stays yours', text: 'Passwords are hashed, every resume is private to your account, and camera analysis runs only in your browser.' },
];

const STEPS = [
  ['Build your resume', 'Fill in guided sections and watch the preview update as you type.'],
  ['Match it to a real job', 'Paste a job description to see matched skills, gaps and what to emphasise.'],
  ['Practise the interview', 'Answer 12 role-specific questions out loud and review the feedback.'],
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
              Open dashboard <ArrowRight size={16} />
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
            <div>
              <span className="eyebrow">Career preparation for students</span>
              <h1>
                Build your resume. <span>Match your goals.</span> Practice with confidence.
              </h1>
              <p className="lead">
                RoleFit AI connects resume building, job-description matching, skill-gap analysis and live mock interviews in one workflow — so every step prepares you for the next.
              </p>
              <div className="hero-actions">
                <Link className="btn btn-primary btn-lg" to={authed ? '/app' : '/register'}>
                  {authed ? 'Go to your dashboard' : 'Create a free account'} <ArrowRight size={18} />
                </Link>
                {!authed && (
                  <Link className="btn btn-lg" to="/login">
                    I already have an account
                  </Link>
                )}
              </div>
              <p className="hero-note">RoleFit AI helps you prepare. It cannot guarantee interviews, ATS selection or job offers.</p>
            </div>
            <div className="workflow" aria-label="How RoleFit AI works">
              {STEPS.map(([title, text], i) => (
                <div className="workflow-step" key={title}>
                  <span className="num">{i + 1}</span>
                  <div>
                    <b>{title}</b>
                    <span>{text}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="section" id="how">
          <div className="section-inner">
            <div className="section-head">
              <span className="eyebrow">How it works</span>
              <h2>One workflow instead of three separate tools</h2>
              <p>Your saved resume powers the job match, and both power a personalised interview. Nothing has to be re-entered.</p>
            </div>
            <div className="grid-3">
              {STEPS.map(([title, text], i) => (
                <div className="card card-pad" key={title}>
                  <span className="stat-icon" aria-hidden="true">
                    {i + 1}
                  </span>
                  <h3 style={{ margin: '14px 0 6px', fontSize: 16.5 }}>{title}</h3>
                  <p className="muted">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="section section-alt" id="features">
          <div className="section-inner">
            <div className="section-head">
              <span className="eyebrow">Features</span>
              <h2>Everything you need to prepare for your first role</h2>
            </div>
            <div className="features">
              {FEATURES.map(({ icon: Icon, title, text }) => (
                <div className="card feature" key={title}>
                  <span className="stat-icon" aria-hidden="true">
                    <Icon size={20} />
                  </span>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="section" id="principles">
          <div className="section-inner stack" style={{ gap: 36 }}>
            <div className="section-head" style={{ marginBottom: 0 }}>
              <span className="eyebrow">Principles</span>
              <h2>Honest by design</h2>
            </div>
            <ul className="honest list">
              <li>
                <CheckCircle2 size={18} /> Match results are coverage measures with a documented method — not an “ATS score”.
              </li>
              <li>
                <CheckCircle2 size={18} /> Suggestions never tell you to claim skills you do not have.
              </li>
              <li>
                <CheckCircle2 size={18} /> AI rewrites keep your facts; you review every suggestion before it is used.
              </li>
              <li>
                <CheckCircle2 size={18} /> Interview feedback is approximate and labelled as AI-generated.
              </li>
            </ul>
            <div className="cta">
              <div>
                <h2>Start with your resume</h2>
                <p>It takes about ten minutes to create your first one.</p>
              </div>
              <Link className="btn btn-primary btn-lg" to={authed ? '/app/resumes' : '/register'}>
                {authed ? 'Open resumes' : 'Create your account'} <ArrowRight size={18} />
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="section-inner">
          <span>© {new Date().getFullYear()} RoleFit AI · A student career preparation project</span>
          <span>React · Express · MongoDB · Gemini</span>
        </div>
      </footer>
    </div>
  );
}
