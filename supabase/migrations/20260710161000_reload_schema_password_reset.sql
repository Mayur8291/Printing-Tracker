-- Refresh PostgREST schema cache after password_reset_requests table was added.
notify pgrst, 'reload schema';
