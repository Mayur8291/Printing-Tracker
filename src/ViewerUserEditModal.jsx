import { EDITABLE_FIELD_OPTIONS } from "./orderViewUtils";
import OrderFieldPermissionFields from "./OrderFieldPermissionFields";
import SidebarTabPermissionFields from "./SidebarTabPermissionFields";
import ProfileAvatarPicker from "@/components/profile/ProfileAvatarPicker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { profileAvatarPublicUrl } from "@/avatarUtils";

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
  avatarPreviewUrl = "",
  avatarFile = null,
  selectedPresetAvatarId = null,
  onAvatarPick,
  onPresetAvatarSelect,
  onAvatarError,
  avatarSaving = false,
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
  isAdminAccount = false,
  onClose
}) {
  if (!viewer) return null;

  const showResetInline = resetPasswordDraft !== undefined;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex max-h-[92vh] max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="border-b px-6 py-4 text-left">
          <DialogTitle>Edit user access</DialogTitle>
          <DialogDescription>
            Update profile, permissions, and dashboard access for this user.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          <ProfileAvatarPicker
            name={nameValue}
            email={viewer.email}
            avatarPath={viewer.avatar_path}
            imageUrl={!avatarFile ? profileAvatarPublicUrl(viewer.avatar_path) : ""}
            selectedPresetId={selectedPresetAvatarId}
            uploadPreviewUrl={avatarPreviewUrl}
            onPresetSelect={onPresetAvatarSelect}
            onUploadPick={onAvatarPick}
            onError={onAvatarError}
            disabled={avatarSaving}
            size="xl"
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="viewer-edit-email">Email</Label>
              <Input id="viewer-edit-email" value={viewer.email ?? ""} readOnly className="bg-muted" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="viewer-edit-name">Display name</Label>
              <Input
                id="viewer-edit-name"
                value={nameValue}
                onChange={(e) => onNameChange(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="viewer-edit-employee-id">Employee ID</Label>
              <Input
                id="viewer-edit-employee-id"
                value={employeeIdValue}
                onChange={(e) => onEmployeeIdChange(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="viewer-edit-department">Department</Label>
              <Input
                id="viewer-edit-department"
                value={departmentValue}
                onChange={(e) => onDepartmentChange(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="viewer-edit-job-role">Job role</Label>
              <Input
                id="viewer-edit-job-role"
                value={jobRoleValue}
                onChange={(e) => onJobRoleChange(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="viewer-edit-status">Account status</Label>
              <Select
                value={isActive ? "active" : "inactive"}
                onValueChange={(value) => onActiveChange(value === "active")}
              >
                <SelectTrigger id="viewer-edit-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border px-4 py-3">
            <div className="space-y-0.5">
              <Label htmlFor="viewer-edit-tone">Status tone</Label>
              <p className="text-xs text-muted-foreground">Play sounds when order status changes</p>
            </div>
            <Switch id="viewer-edit-tone" checked={toneEnabled} onCheckedChange={onToneChange} />
          </div>

          {isAdminAccount ? (
            <p className="rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
              This account has <strong className="text-foreground">Admin</strong> access — full dashboard
              access. Order and sidebar permission toggles apply to viewer accounts only.
            </p>
          ) : (
            <div className="space-y-5">
              <div className="space-y-3">
                <p className="text-sm font-semibold">Order &amp; sidebar access</p>
                <OrderFieldPermissionFields
                  idPrefix={`edit-${viewer.id}`}
                  permissionDraft={permissionDraft}
                  onPermissionChange={onPermissionChange}
                />
              </div>
              <Separator />
              <SidebarTabPermissionFields
                idPrefix={`edit-${viewer.id}`}
                tabFlags={permissionDraft?.sidebar_tabs}
                editFlags={permissionDraft?.sidebar_edit_tabs}
                onViewChange={onSidebarViewChange}
                onEditChange={onSidebarEditChange}
              />
            </div>
          )}
        </div>

        <DialogFooter className="flex-col gap-3 border-t bg-muted/30 px-6 py-4 sm:flex-row sm:flex-wrap sm:justify-start">
          <Button type="button" variant="success" onClick={onSave}>
            Save
          </Button>
          {!isAdminAccount ? (
            <Button type="button" variant="destructive" onClick={onResetPermissions}>
              Reset permissions
            </Button>
          ) : null}
          {!showResetInline ? (
            <Button type="button" variant="outline" onClick={onOpenResetPassword}>
              Reset password
            </Button>
          ) : (
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
              <Input
                type="text"
                placeholder="New password"
                autoComplete="off"
                value={resetPasswordDraft}
                onChange={(e) => onResetPasswordDraftChange(e.target.value)}
                className="min-w-[12rem] flex-1 sm:flex-none"
              />
              <Button type="button" variant="success" onClick={onResetPassword} disabled={resettingPassword}>
                {resettingPassword ? "Saving…" : "Save password"}
              </Button>
              <Button type="button" variant="outline" onClick={onCancelResetPassword} disabled={resettingPassword}>
                Cancel
              </Button>
            </div>
          )}
          <Button type="button" variant="destructive" onClick={onRemove} disabled={removing}>
            {removing ? "Removing…" : "Remove user"}
          </Button>
          <Button type="button" variant="outline" onClick={onClose} className="sm:ml-auto">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
