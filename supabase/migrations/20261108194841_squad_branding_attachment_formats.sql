--130: Preserve original design/office/archive attachments as opaque downloads.
-- No parsers, previews, archive extraction, or MIME inference for these formats.
-- Existing actor/record authorization, versions, byte quotas and SHA verification remain.
DO $migration$
DECLARE d text;anchor_ text;
BEGIN
 d:=pg_get_functiondef('sa_domain.account_upload_reserve(jsonb,jsonb,text,uuid)'::regprocedure);
 anchor_:=$s$WHEN 'application/pdf' THEN 26214400$s$;
 IF strpos(d,anchor_)=0 THEN RAISE EXCEPTION 'Missing media size policy anchor';END IF;
 d:=replace(d,anchor_,anchor_||$s$ WHEN 'application/octet-stream' THEN 26214400$s$);
 anchor_:=$s$IF max_ IS NULL OR bytes_>max_ OR$s$;
 IF strpos(d,anchor_)=0 THEN RAISE EXCEPTION 'Missing media type policy anchor';END IF;
 d:=replace(d,anchor_,anchor_||$s$
  (mime_='application/octet-stream' AND (resource_<>'brandings' OR field_<>'attachment' OR
    name_ !~* '\.(doc|docx|xlxs|xlsx|xls|xlsm|xlsb|xltx|xltm|xlt|xlam|xla|xll|xlw|pptx|pptm|potx|potm|ppam|ppa|ppsx|ppsm|sldx|sldm|psd|ai|eps|tiff|tif|bmp|indd|zip|rar|7z|csv|ppt|aiff|wma|ogg|flac|cdr|raw)$')) OR$s$);
 EXECUTE d;
END $migration$;
