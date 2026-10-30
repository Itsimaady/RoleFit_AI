import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { EmptyState } from '../components/ui.jsx';

export function NotFoundPage({ inApp = false }) {
  return (
    <div className="page">
      <div className="card">
        <EmptyState
          icon={Compass}
          title="Page not found"
          action={
            <Link className="btn btn-primary" to={inApp ? '/app' : '/'}>
              {inApp ? 'Back to dashboard' : 'Go to home page'}
            </Link>
          }
        >
          The page you are looking for does not exist or has moved.
        </EmptyState>
      </div>
    </div>
  );
}
