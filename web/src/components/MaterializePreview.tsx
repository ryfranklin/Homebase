import { materializePreview, type FlightPlan } from "../plan/types";

// Shows the work a materializer would create in Jira from a cleared plan:
// epic = plan, stories = waypoints (fallback ACs), ACs = definition of done.
// Mission Control pulls the plan; Homebase (the materializer host) authors it.
export function MaterializePreview({ plan, onMaterialize }: { plan: FlightPlan; onMaterialize?: () => void }) {
  const preview = materializePreview(plan);
  return (
    <div className="materialize">
      <div className="materialize-head">
        <span className="materialize-target">Jira</span>
        <span className="materialize-note">Mission Control pulls · Homebase authors</span>
      </div>

      <div className="mz-epic">
        <span className="mz-type">Epic</span>
        <span className="mz-title">{preview.epic}</span>
      </div>

      <ul className="mz-stories">
        {preview.stories.map((s) => (
          <li key={s.key} className="mz-story">
            <span className="mz-type story">Story</span>
            <span className="mz-key">{s.key}</span>
            <span className="mz-title">{s.title}</span>
          </li>
        ))}
      </ul>

      <div className="mz-dod">
        <span className="mz-dod-label">Definition of done ({preview.definitionOfDone.length} AC)</span>
        <ul>
          {preview.definitionOfDone.map((ac, i) => (
            <li key={i}>{ac}</li>
          ))}
        </ul>
      </div>

      {onMaterialize && (
        <button type="button" className="vault-btn primary mz-go" onClick={onMaterialize}>
          Materialize in Jira ▸
        </button>
      )}
    </div>
  );
}
