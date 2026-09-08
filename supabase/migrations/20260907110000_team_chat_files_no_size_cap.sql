-- Chat paperclip: drop the 15 MB client cap by raising the bucket limit.
-- Staging first. Project-level Storage settings can still cap a single upload.

update storage.buckets
set file_size_limit = 10737418240
where id = 'team-chat-files';
