import { useState } from "react";
import { invokeAdminEdgeFunction } from "./edgeFunctionUtils";
import {
  GITHUB_REPO_URL,
  NETLIFY_DEPLOYS_URL,
  getDeployEnvironment,
  getLocalStagingDevUrl,
  getProductionSiteUrl,
  getStagingSiteUrl,
  hasCustomStagingSiteUrl
} from "./deployEnvironmentUtils";

const RELEASE_DOCS_URL =
  "https://github.com/Mayur8291/Printing-Tracker/blob/main/docs/RELEASE_AUTOMATION.md";

export default function AdminDeployPanel() {
  const env = getDeployEnvironment();
  const productionUrl = getProductionSiteUrl();
  const localDevUrl = getLocalStagingDevUrl();
  const hostedStagingConfigured = hasCustomStagingSiteUrl();
  const [stagingHelpOpen, setStagingHelpOpen] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [releaseError, setReleaseError] = useState("");
  const [releaseSuccess, setReleaseSuccess] = useState("");

  function openExternal(url) {
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function openHostedStaging() {
    if (hostedStagingConfigured) {
      openExternal(getStagingSiteUrl());
      return;
    }
    setStagingHelpOpen(true);
  }

  async function handleAutomatedRelease() {
    if (releasing) return;
    const ok = window.confirm(
      "Release staging → production?\n\n" +
        "This will automatically:\n" +
        "• Merge develop into main on GitHub\n" +
        "• Apply database migrations to LIVE Supabase\n" +
        "• Deploy edge functions\n" +
        "• Rebuild the live website (Netlify)\n\n" +
        "Only continue if you tested on staging."
    );
    if (!ok) return;

    setReleasing(true);
    setReleaseError("");
    setReleaseSuccess("");
    try {
      const data = await invokeAdminEdgeFunction("admin-promote-production", {});
      const msg = data?.message ?? "Production release started.";
      const actionsUrl = data?.actions_url;
      setReleaseSuccess(msg);
      if (actionsUrl) {
        openExternal(actionsUrl);
      }
    } catch (err) {
      setReleaseError(err instanceof Error ? err.message : String(err));
    } finally {
      setReleasing(false);
    }
  }

  return (
    <div className="admin-deploy-panel">
      <div className="admin-deploy-env-row">
        <span
          className={
            env.isProduction
              ? "admin-deploy-env-pill admin-deploy-env-pill--prod"
              : "admin-deploy-env-pill admin-deploy-env-pill--staging"
          }
        >
          This session: {env.label}
        </span>
        {env.ref ? (
          <span className="admin-deploy-env-ref" title="Supabase project ref">
            {env.ref}
          </span>
        ) : null}
      </div>

      {env.isProduction ? (
        <p className="admin-deploy-warning">
          You are connected to the <strong>live</strong> database. Use staging for day-to-day builds, then
          release when ready.
        </p>
      ) : (
        <p className="admin-deploy-safe">
          Safe to experiment — this build uses your <strong>staging</strong> Supabase project.
        </p>
      )}

      <div className="admin-deploy-release-block">
        <h5 className="admin-deploy-release-title">Production release</h5>
        <p className="admin-deploy-release-desc">
          One click merges <code>develop</code> → <code>main</code>, updates live database, deploys functions,
          and rebuilds the site. Only works after you <strong>commit and push</strong> your work to{" "}
          <code>origin develop</code> — local-only changes are not included.
        </p>
        <button
          type="button"
          className="btn-admin-deploy btn-admin-deploy--release btn-admin-deploy--release-primary"
          disabled={releasing}
          onClick={() => void handleAutomatedRelease()}
        >
          {releasing ? "Starting release…" : "Release staging → production"}
        </button>
        {releaseError ? (
          <p className="admin-deploy-release-error" role="alert">
            {releaseError}{" "}
            <a href={RELEASE_DOCS_URL} target="_blank" rel="noopener noreferrer">
              Setup guide
            </a>
          </p>
        ) : null}
        {releaseSuccess ? (
          <p className="admin-deploy-release-success" role="status">
            {releaseSuccess}
          </p>
        ) : null}
      </div>

      <div className="admin-deploy-actions">
        <button
          type="button"
          className="btn-admin-deploy btn-admin-deploy--test"
          onClick={() => openExternal(localDevUrl)}
          title="Run npm run dev first"
        >
          Test locally (staging DB)
        </button>
        <button
          type="button"
          className="btn-admin-deploy btn-admin-deploy--test-hosted"
          onClick={() => openHostedStaging()}
        >
          {hostedStagingConfigured ? "Open hosted staging" : "Set up hosted staging"}
        </button>
        <button
          type="button"
          className="btn-admin-deploy btn-admin-deploy--prod-view"
          onClick={() => openExternal(productionUrl)}
        >
          View live site
        </button>
        <button
          type="button"
          className="btn-admin-deploy-secondary"
          onClick={() => openExternal(NETLIFY_DEPLOYS_URL)}
        >
          Netlify deploys
        </button>
        <button
          type="button"
          className="btn-admin-deploy-secondary"
          onClick={() => openExternal(`${GITHUB_REPO_URL}/actions`)}
        >
          GitHub Actions
        </button>
      </div>

      {stagingHelpOpen ? (
        <div
          className="admin-deploy-modal-backdrop"
          role="presentation"
          onClick={() => setStagingHelpOpen(false)}
        >
          <div
            className="admin-deploy-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-staging-help-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="admin-deploy-modal-close"
              aria-label="Close"
              onClick={() => setStagingHelpOpen(false)}
            >
              ×
            </button>
            <h4 id="admin-staging-help-title">Hosted staging not ready yet</h4>
            <p className="admin-deploy-modal-lead">
              Enable branch deploys for <code>develop</code>, push the branch, then copy the deploy URL into{" "}
              <code>VITE_STAGING_SITE_URL</code> in <code>.env.development</code>.
            </p>
            <button type="button" className="btn-admin-deploy-done" onClick={() => setStagingHelpOpen(false)}>
              Done
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
