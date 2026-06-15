import { EDITABLE_FIELD_OPTIONS } from "./orderViewUtils";
import SidebarTabPermissionFields from "./SidebarTabPermissionFields";
export default function ViewerUserEditModal({
  open,
  viewer,
  nameValue,
  employeeIdValue,
  departmentValue,
  jobRoleValue,
  toneEnabled,
  isActive,
  permissionDraft,
  onNameChange,
  onEmployeeIdChange,
  onDepartmentChange,
  onJobRoleChange,
  onToneChange,
  onActiveChange,
  onPermissionChange,
  onSidebarViewChange,
  onSidebarEditChange,
  resetPasswordDraft,
  onOpenResetPassword,
  onResetPasswordDraftChange,
  onCancelResetPassword,
  onResetPassword,
  resettingPassword,
  onSave,
  onResetPermissions,
  onRemove,
  removing,
  onClose
}) {
  if (!open || !viewer) return null;

  const showResetInline = resetPasswordDraft !== undefined;

  return (
    <div className="image-modal-backdrop viewer-edit-modal-backdrop" onClick={onClose}>
      <div
        className="viewer-edit-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="viewer-edit-modal-title"
      >
        <div className="viewer-edit-modal-head">
          <div>
            <h2 id="viewer-edit-modal-title">Edit user access</h2>
          </div>
          <button type="button" className="viewer-edit-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="viewer-edit-modal-body">
          <div className="create-user-grid viewer-edit-profile-grid">
            <label className="viewer-edit-email-field">
              Email
              <input
                type="email"
                className="user-name-input order-form-readonly-input"
                value={viewer.email ?? ""}
                readOnly
                tabIndex={-1}
                aria-readonly="true"
              />
            </label>
            <label>
              Display name
              <input
                type="text"
                className="user-name-input"
                value={nameValue}
                onChange={(e) => onNameChange(e.target.value)}
              />
            </label>
            <label>
              Employee ID
              <input
                type="text"
                className="user-name-input"
                value={employeeIdValue}
                onChange={(e) => onEmployeeIdChange(e.target.value)}
              />
            </label>
            <label>
              Department
              <input
                type="text"
                className="user-name-input"
                value={departmentValue}
                onChange={(e) => onDepartmentChange(e.target.value)}
              />
            </label>
            <label>
              Job role
              <input
                type="text"
                className="user-name-input"
                value={jobRoleValue}
                onChange={(e) => onJobRoleChange(e.target.value)}
              />
            </label>
            <label>
              Account status
              <select
                className="user-name-input"
                value={isActive ? "active" : "inactive"}
                onChange={(e) => onActiveChange(e.target.value === "active")}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
          </div>

          <label className="viewer-tone-toggle viewer-tone-toggle--inline" title="Play status-change tones">
            <input
              type="checkbox"
              role="switch"
              checked={toneEnabled}
              onChange={(e) => onToneChange(e.target.checked)}
            />
            <span className="viewer-tone-toggle-track" aria-hidden="true">
              <span className="viewer-tone-toggle-thumb" />
            </span>
            <span className="viewer-tone-toggle-label">
              Status tone {toneEnabled ? "ON" : "OFF"}
            </span>
          </label>

          <div className="user-access-perms-block viewer-edit-perms-block">
            <p className="create-user-perms-title">Order &amp; sidebar access</p>
            <div className="viewer-permission-fields user-access-checkboxes">
              {EDITABLE_FIELD_OPTIONS.map((option) => {
                const fieldKey = `can_edit_${option.key}`;
                return (
                  <label key={fieldKey}>
                    <input
                      type="checkbox"
                      checked={Boolean(permissionDraft?.[fieldKey])}
                      onChange={(e) => onPermissionChange(fieldKey, e.target.checked)}
                    />
                    {option.label}
                  </label>
                );
              })}
              <label className="viewer-perm-create-order">
                <input
                  type="checkbox"
                  checked={Boolean(permissionDraft?.can_create_orders)}
                  onChange={(e) => onPermissionChange("can_create_orders", e.target.checked)}
                />
                Create new order
              </label>
            </div>
            <SidebarTabPermissionFields
              idPrefix={`edit-${viewer.id}`}
              tabFlags={permissionDraft?.sidebar_tabs}
              editFlags={permissionDraft?.sidebar_edit_tabs}
              onViewChange={onSidebarViewChange}
              onEditChange={onSidebarEditChange}
            />
          </div>
        </div>

        <div className="viewer-edit-modal-footer">
          <button type="button" className="btn-save-green" onClick={onSave}>
            Save
          </button>
          <button type="button" className="danger-btn" onClick={onResetPermissions}>
            Reset permissions
          </button>
          {!showResetInline ? (
            <button type="button" className="btn-reset-password" onClick={onOpenResetPassword}>
              Reset password
            </button>
          ) : (
            <div className="reset-password-inline viewer-edit-reset-inline">
              <input
                type="text"
                placeholder="New password"
                autoComplete="off"
                value={resetPasswordDraft}
                onChange={(e) => onResetPasswordDraftChange(e.target.value)}
              />
              <button
                type="button"
                className="btn-save-green"
                onClick={onResetPassword}
                disabled={resettingPassword}
              >
                {resettingPassword ? "Saving…" : "Save password"}
              </button>
              <button type="button" onClick={onCancelResetPassword} disabled={resettingPassword}>
                Cancel
              </button>
            </div>
          )}
          <button
            type="button"
            className="btn-remove-user"
            onClick={onRemove}
            disabled={removing}
          >
            {removing ? "Removing…" : "Remove user"}
          </button>
          <button type="button" className="viewer-edit-modal-done" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export function IconUserEdit({ title = "Edit user" }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 20h9" strokeLinecap="round" />
      <path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconUserDelete({ title = "Delete user" }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M3 6h18" strokeLinecap="round" />
      <path d="M8 6V4h8v2" strokeLinecap="round" />
      <path d="M19 6l-1 14H6L5 6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 11v6M14 11v6" strokeLinecap="round" />
    </svg>
  );
}
