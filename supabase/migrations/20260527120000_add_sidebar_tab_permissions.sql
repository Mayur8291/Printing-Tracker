-- Per-viewer whitelist of dashboard sidebar tabs (null = all tabs allowed).

alter table public.profile_order_permissions
  add column if not exists allowed_dashboard_tabs text[] default null;

comment on column public.profile_order_permissions.allowed_dashboard_tabs is
  'When null, viewer may access all sidebar tabs. When set, only listed tab ids are allowed.';
