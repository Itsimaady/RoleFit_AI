import { Link } from 'react-router-dom';
import { Sparkles } from 'lucide-react';

export function Brand({ to = '/' }) {
  return (
    <Link to={to} className="brand" aria-label="RoleFit AI home">
      <span className="brand-mark" aria-hidden="true">
        <Sparkles size={17} />
      </span>
      <span>
        RoleFit <b>AI</b>
      </span>
    </Link>
  );
}
