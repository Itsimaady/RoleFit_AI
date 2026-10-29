import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, MessageSquare } from 'lucide-react';
import { useApiData } from '../../hooks/useApiData.js';
import { ErrorState, PageLoader } from '../../components/ui.jsx';
import { AnalysisResult } from './AnalysisResult.jsx';

export function AnalysisDetailPage() {
  const { id } = useParams();
  const { data, error, loading, reload } = useApiData(`/api/analyses/${id}`);

  return (
    <div className="page">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <Link to="/app/analyses" className="small">
          <ArrowLeft size={14} style={{ verticalAlign: '-2px' }} /> All analyses
        </Link>
        {data?.analysis?.resume && (
          <Link className="btn btn-primary btn-sm" to={`/app/interviews?resume=${data.analysis.resume}&analysis=${id}`}>
            <MessageSquare size={14} /> Practise an interview for this job
          </Link>
        )}
      </div>
      {error ? (
        <div className="card">
          <ErrorState error={error} onRetry={reload} />
        </div>
      ) : loading || !data ? (
        <PageLoader label="Loading analysis" />
      ) : (
        <AnalysisResult analysis={data.analysis} />
      )}
    </div>
  );
}
