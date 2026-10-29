import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { FileText, LayoutDashboard, LogOut, Menu, MessageSquare, Moon, Plus, Sun, Target, User, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useTheme } from '../hooks/useTheme.js';
import { initials } from '../lib/format.js';
import { Brand } from './Brand.jsx';

export const NAV_SECTIONS = [
  { label: null, items: [{ to: '/app', label: 'Dashboard', icon: LayoutDashboard, end: true }] },
  {
    label: 'Prepare',
    items: [
      { to: '/app/resumes', label: 'Resumes', icon: FileText },
      { to: '/app/analyses', label: 'Job match', icon: Target },
      { to: '/app/interviews', label: 'Mock interviews', icon: MessageSquare },
    ],
  },
];

function UserMenu() {
  const { user, logout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const { theme, toggle } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const signOut = async () => {
    setOpen(false);
    try {
      await logout();
      toast.success('You have been signed out.');
    } catch {
      toast.error('Sign-out could not reach the server, but you have been signed out on this device.');
    }
    navigate('/login');
  };

  return (
    <div className="menu-wrap" ref={ref}>
      <button type="button" className="user-button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="avatar" aria-hidden="true">
          {initials(user?.fullName)}
        </span>
        <span className="who">
          <b>{user?.fullName}</b>
          <small>{user?.email}</small>
        </span>
      </button>
      {open && (
        <div className="menu" role="menu">
          <NavLink to="/app/profile" role="menuitem" onClick={() => setOpen(false)}>
            <User size={15} /> Profile & account
          </NavLink>
          <button type="button" role="menuitem" onClick={toggle}>
            {theme === 'light' ? <Moon size={15} /> : <Sun size={15} />} {theme === 'light' ? 'Dark theme' : 'Light theme'}
          </button>
          <hr />
          <button type="button" role="menuitem" onClick={signOut}>
            <LogOut size={15} /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function AppShell() {
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();

  // Close the mobile drawer on navigation.
  useEffect(() => setNavOpen(false), [location.pathname, location.search]);
  useEffect(() => {
    if (!navOpen) return undefined;
    const onKey = (e) => e.key === 'Escape' && setNavOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [navOpen]);

  return (
    <div className={`shell${navOpen ? ' nav-open' : ''}`}>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <aside className="sidebar" id="app-sidebar" aria-label="Main navigation">
        <div className="sidebar-top">
          <Brand to="/app" />
          {navOpen && (
            <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => setNavOpen(false)} aria-label="Close navigation">
              <X size={17} />
            </button>
          )}
        </div>
        <Link to="/app/resumes?new=1" className="btn btn-block" style={{ justifyContent: 'flex-start' }}>
          <Plus size={15} /> New resume
        </Link>
        <nav className="nav">
          {NAV_SECTIONS.map((section) => (
            <div key={section.label || 'main'} className="nav">
              {section.label && <span className="nav-label">{section.label}</span>}
              {section.items.map(({ to, label, icon: Icon, end }) => (
                <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? 'active' : undefined)}>
                  <Icon size={16} aria-hidden="true" /> {label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="sidebar-note">
            <b>Build → Match → Practise</b>
            Each step reuses your saved resume, so nothing has to be re-entered.
          </div>
          <UserMenu />
        </div>
      </aside>
      <div className="backdrop" onClick={() => setNavOpen(false)} aria-hidden="true" />
      <div className="main">
        <header className="mobile-bar">
          <button type="button" className="btn btn-ghost btn-icon" onClick={() => setNavOpen(true)} aria-label="Open navigation" aria-expanded={navOpen} aria-controls="app-sidebar">
            <Menu size={19} />
          </button>
          <Brand to="/app" />
        </header>
        <main id="main" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
