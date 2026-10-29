import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { FileText, LayoutDashboard, LogOut, Menu, MessageSquare, Moon, Sun, Target, User, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useTheme } from '../hooks/useTheme.js';
import { initials } from '../lib/format.js';
import { Brand } from './Brand.jsx';

export const NAV_ITEMS = [
  { to: '/app', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/app/resumes', label: 'Resumes', icon: FileText },
  { to: '/app/analyses', label: 'Job match', icon: Target },
  { to: '/app/interviews', label: 'Mock interviews', icon: MessageSquare },
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
            <User size={16} /> Profile
          </NavLink>
          <button type="button" role="menuitem" onClick={toggle}>
            {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />} {theme === 'light' ? 'Dark theme' : 'Light theme'}
          </button>
          <hr />
          <button type="button" role="menuitem" onClick={signOut}>
            <LogOut size={16} /> Sign out
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
  useEffect(() => setNavOpen(false), [location.pathname]);
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
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <Brand to="/app" />
          {navOpen && (
            <button type="button" className="btn btn-ghost btn-icon" style={{ color: '#fff' }} onClick={() => setNavOpen(false)} aria-label="Close navigation">
              <X size={18} />
            </button>
          )}
        </div>
        <nav className="nav">
          <span className="nav-label">Workspace</span>
          {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? 'active' : undefined)}>
              <Icon size={18} aria-hidden="true" /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <UserMenu />
        </div>
      </aside>
      <div className="backdrop" onClick={() => setNavOpen(false)} aria-hidden="true" />
      <div className="main">
        <header className="mobile-bar">
          <button type="button" className="btn btn-icon" onClick={() => setNavOpen(true)} aria-label="Open navigation" aria-expanded={navOpen} aria-controls="app-sidebar">
            <Menu size={20} />
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

