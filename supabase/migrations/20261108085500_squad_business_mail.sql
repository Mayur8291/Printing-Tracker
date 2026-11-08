BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_guard,sa_executor,sa_worker;
GRANT SELECT(id,uc_order_id,total_quantity,total_amount,created_by_id,customer_id,customer_dealer_id,customer_sc_id) ON sa_snapshot_20261019.sa_orders TO sa_guard;
GRANT SELECT(id,name,role) ON sa_snapshot_20261019.sa_users TO sa_guard;
GRANT SELECT(id,order_id,product_id,rmp_class_id,rmp_category_id,item_type,total_quantity,total_amount,cgst_amount,sgst_amount,igst_amount,per_piece_amount,calculated_per_piece_amount,rmp_override_price) ON sa_snapshot_20261019.sa_items TO sa_guard;
GRANT SELECT(id,name,category_id) ON sa_snapshot_20261019.sa_products TO sa_guard;
GRANT SELECT(id,name) ON sa_snapshot_20261019.sa_categories,sa_snapshot_20261019.sa_rmp_classes,sa_snapshot_20261019.sa_rmp_categories TO sa_guard;
GRANT SELECT ON sa_domain.documents TO sa_guard;
CREATE POLICY business_mail_document_guard ON sa_domain.documents FOR SELECT TO sa_guard USING(true);
CREATE TABLE sa_domain.business_mail_settings(kind text PRIMARY KEY CHECK(kind IN('price_alert','bulk_price_result','tailor_weekly')),recipient_ids bigint[] NOT NULL DEFAULT '{}',CHECK(cardinality(recipient_ids)<=10));
INSERT INTO sa_domain.business_mail_settings(kind) VALUES('price_alert'),('bulk_price_result'),('tailor_weekly');
ALTER TABLE sa_domain.business_mail_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_domain.business_mail_settings FORCE ROW LEVEL SECURITY;
GRANT SELECT ON sa_domain.business_mail_settings TO sa_guard,sa_worker;
GRANT SELECT,UPDATE ON sa_domain.business_mail_settings TO sa_executor;
CREATE POLICY mail_settings_guard ON sa_domain.business_mail_settings FOR SELECT TO sa_guard USING(true);
CREATE POLICY mail_settings_worker ON sa_domain.business_mail_settings FOR SELECT TO sa_worker USING(true);
CREATE POLICY mail_settings_admin ON sa_domain.business_mail_settings TO sa_executor USING((sa_domain.ops_context()->>'admin')::boolean OR(sa_domain.ops_context()->>'platform')::boolean) WITH CHECK((sa_domain.ops_context()->>'admin')::boolean OR(sa_domain.ops_context()->>'platform')::boolean);

CREATE TABLE sa_domain.business_mail_deliveries(
 job_id uuid PRIMARY KEY REFERENCES sa_domain.outbox,source_job uuid NOT NULL REFERENCES sa_domain.outbox,
 generation bigint NOT NULL,kind text NOT NULL CHECK(kind IN('dealer_order','price_alert','bulk_price_result','welcome','catalogue','delivery_challan','tailor_weekly')),
 entity_id bigint NOT NULL,document_id uuid REFERENCES sa_domain.documents,transfer_id uuid REFERENCES sa_domain.transfers,
 recipient_id bigint NOT NULL,recipient_role integer NOT NULL,recipient_auth_id uuid NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','prepared','sent','failed')),
 bound_email text,content jsonb,error_code text,sent_at timestamptz,updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(source_job,kind,entity_id,recipient_auth_id),CHECK(content IS NULL OR octet_length(content::text)<=65536)
);
CREATE INDEX squad_business_mail_document ON sa_domain.business_mail_deliveries(document_id,state) WHERE document_id IS NOT NULL;
ALTER TABLE sa_domain.business_mail_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_domain.business_mail_deliveries FORCE ROW LEVEL SECURITY;
GRANT SELECT ON sa_domain.business_mail_deliveries TO sa_guard;
GRANT SELECT,INSERT,UPDATE ON sa_domain.business_mail_deliveries TO sa_worker;
CREATE POLICY business_mail_guard ON sa_domain.business_mail_deliveries FOR SELECT TO sa_guard USING(true);
CREATE POLICY business_mail_worker ON sa_domain.business_mail_deliveries TO sa_worker USING(true) WITH CHECK(true);

CREATE FUNCTION sa_domain.mail_setting_id(p_kind text) RETURNS bigint LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $f$ SELECT CASE p_kind WHEN 'price_alert' THEN 1 WHEN 'bulk_price_result' THEN 2 WHEN 'tailor_weekly' THEN 3 END::bigint $f$;
REVOKE ALL ON FUNCTION sa_domain.mail_setting_id(text) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.mail_setting_id(text) TO sa_guard,sa_executor,sa_worker;
CREATE FUNCTION sa_domain.mail_config_candidates(p_kind text,p_ids bigint[]) RETURNS TABLE(user_id bigint,auth_id uuid,role_id integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT n.user_id,n.auth_id,n.role_id FROM sa_domain.notification_candidates(jsonb_build_object('audience',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',x)),'[]') FROM unnest(p_ids) x)),0) n
 WHERE n.role_id=0 OR(p_kind='tailor_weekly' AND n.role_id IN(2,4)) ORDER BY n.user_id LIMIT 10
$f$;
ALTER FUNCTION sa_domain.mail_config_candidates(text,bigint[]) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.mail_config_candidates(text,bigint[]) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.mail_config_candidates(text,bigint[]) TO sa_executor,sa_worker;
CREATE FUNCTION sa_domain.v1_mail_settings_read() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE ctx jsonb:=sa_domain.ops_context();BEGIN
 IF NOT((ctx->>'admin')::boolean OR(ctx->>'platform')::boolean) THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501';END IF;
 RETURN(SELECT jsonb_build_object('data',jsonb_agg(jsonb_build_object('kind',kind,'recipient_ids',to_jsonb(ARRAY(SELECT x::text FROM unnest(recipient_ids) x)),'configured',cardinality(recipient_ids)>0,'version',sa_domain.version('mail_settings',sa_domain.mail_setting_id(kind))) ORDER BY kind)) FROM sa_domain.business_mail_settings);
END $f$;
ALTER FUNCTION sa_domain.v1_mail_settings_read() OWNER TO sa_executor;
CREATE FUNCTION sa_domain.v1_mail_settings_save(p_kind text,p_recipient_ids bigint[],p_expected_version text,p_idempotency_key uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE ctx jsonb:=sa_domain.ops_context();cached_ jsonb;v text;id_ bigint:=sa_domain.mail_setting_id(p_kind);BEGIN
 IF NOT((ctx->>'admin')::boolean OR(ctx->>'platform')::boolean) THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501';END IF;
 IF id_ IS NULL OR p_recipient_ids IS NULL OR cardinality(p_recipient_ids)>10 OR cardinality(p_recipient_ids)<>(SELECT count(DISTINCT x) FROM unnest(p_recipient_ids) x) OR EXISTS(SELECT FROM unnest(p_recipient_ids) x WHERE x IS NULL OR x<=0) THEN RAISE EXCEPTION 'Invalid mail recipient configuration' USING ERRCODE='22023';END IF;
 IF cardinality(p_recipient_ids)<>(SELECT count(*) FROM sa_domain.mail_config_candidates(p_kind,p_recipient_ids)) THEN RAISE EXCEPTION 'Recipients must be current authorized users' USING ERRCODE='42501';END IF;
 cached_:=sa_domain.begin_command('mail.settings_saved',p_idempotency_key,jsonb_build_object('kind',p_kind,'recipients',p_recipient_ids,'version',p_expected_version));IF cached_ IS NOT NULL THEN RETURN cached_;END IF;
 v:=sa_domain.bump_version('mail_settings',id_,p_expected_version);UPDATE sa_domain.business_mail_settings SET recipient_ids=p_recipient_ids WHERE kind=p_kind;
 RETURN sa_domain.finish_command('mail.settings_saved',p_idempotency_key,'mail_settings',id_,jsonb_build_object('kind',p_kind,'recipient_ids',to_jsonb(ARRAY(SELECT x::text FROM unnest(p_recipient_ids) x)),'version',v),jsonb_build_object('recipient_ids',p_recipient_ids));
END $f$;
ALTER FUNCTION sa_domain.v1_mail_settings_save(text,bigint[],text,uuid) OWNER TO sa_executor;

CREATE FUNCTION sa_domain.mail_order_price_difference(p_id bigint) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT EXISTS(SELECT FROM sa_snapshot_20261019.sa_items WHERE order_id=p_id AND CASE WHEN item_type=1 THEN coalesce(rmp_override_price,0)>0 AND coalesce(rmp_override_price,0)<>coalesce(per_piece_amount,0) WHEN item_type=0 THEN coalesce(calculated_per_piece_amount,0)>0 AND coalesce(calculated_per_piece_amount,0)<>coalesce(per_piece_amount,0) ELSE false END)
$f$;
ALTER FUNCTION sa_domain.mail_order_price_difference(bigint) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.mail_order_price_difference(bigint) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.mail_order_price_difference(bigint) TO sa_worker;

-- Capture only committed source commands. Imports/refreshes do not emit mail.
CREATE FUNCTION sa_domain.capture_business_mail() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE kind_ text;ids_ jsonb;id_ bigint;BEGIN
 IF NEW.event_type IN('orders.placed','backorder.placed') THEN kind_:='dealer_order';ids_:=coalesce(NEW.payload->'order_ids',jsonb_build_array(NEW.aggregate_id));
 ELSIF NEW.event_type='order.price_changed' OR NEW.event_type='order.amendment_applied' AND NEW.payload->>'price_changed'='true' OR NEW.event_type='order.edited' AND NEW.payload->>'price_changed'='true' AND nullif(NEW.payload->>'request_id','') IS NULL THEN kind_:='price_alert';ids_:=jsonb_build_array(NEW.aggregate_id);
 ELSIF NEW.event_type IN('person.saved.notify','person.team_saved.notify') AND NEW.payload->>'created'='true' THEN kind_:='welcome';ids_:=jsonb_build_array(NEW.aggregate_id);
 ELSIF NEW.event_type='customer.reviewed.notify' AND NEW.payload->'after'->>'approved'='true' AND NEW.payload->'before'->>'approved' IS DISTINCT FROM 'true' THEN kind_:='welcome';ids_:=jsonb_build_array(NEW.aggregate_id);
 ELSIF NEW.event_type='account.registration_completed' THEN kind_:='welcome';ids_:=jsonb_build_array(NEW.aggregate_id);
 ELSE RETURN NEW;END IF;
 IF jsonb_typeof(ids_)<>'array' OR jsonb_array_length(ids_)>100 THEN RAISE EXCEPTION 'Mail source batch exceeds limit' USING ERRCODE='54000';END IF;
 FOR id_ IN SELECT value::bigint FROM jsonb_array_elements_text(ids_) LOOP
  IF kind_='welcome' AND NOT EXISTS(SELECT FROM sa_domain.notification_candidates(jsonb_build_object('audience',jsonb_build_array(jsonb_build_object('id',id_))),0)) THEN CONTINUE;END IF;
  INSERT INTO sa_domain.outbox(parent_id,actor_id,event_type,aggregate_kind,aggregate_id,command_key,generation,payload)
  VALUES(NEW.id,NEW.actor_id,'business.mail_fanout',CASE WHEN kind_='welcome' THEN 'person' ELSE 'order' END,id_,NEW.id,NEW.generation,jsonb_build_object('kind',kind_,'source_event',NEW.id)) ON CONFLICT DO NOTHING;
  IF NEW.event_type IN('orders.placed','backorder.placed') AND sa_domain.mail_order_price_difference(id_) THEN
   INSERT INTO sa_domain.outbox(parent_id,actor_id,event_type,aggregate_kind,aggregate_id,command_key,generation,payload)
   VALUES(NEW.id,NEW.actor_id,'business.mail_fanout','order',id_,gen_random_uuid(),NEW.generation,jsonb_build_object('kind','price_alert','source_event',NEW.id));
  END IF;
 END LOOP;RETURN NEW;
END $f$;
ALTER FUNCTION sa_domain.capture_business_mail() OWNER TO sa_worker;
REVOKE ALL ON FUNCTION sa_domain.capture_business_mail() FROM PUBLIC,anon,authenticated,sa_app,service_role;
CREATE TRIGGER squad_capture_business_mail AFTER INSERT ON sa_domain.outbox FOR EACH ROW EXECUTE FUNCTION sa_domain.capture_business_mail();
CREATE FUNCTION sa_domain.capture_transfer_mail() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
BEGIN
 IF NEW.direction='import' AND NEW.kind='prices' AND NEW.state IN('completed','failed','invalid') AND OLD.state IS DISTINCT FROM NEW.state AND NEW.job_id IS NOT NULL THEN
  INSERT INTO sa_domain.outbox(parent_id,actor_id,event_type,aggregate_kind,aggregate_id,command_key,generation,payload)
  VALUES(NEW.job_id,NEW.actor_id,'business.mail_fanout','import',NEW.sequence_id,gen_random_uuid(),NEW.generation,jsonb_build_object('kind','bulk_price_result','transfer_id',NEW.id,'terminal_state',NEW.state));
 END IF;RETURN NEW;
END $f$;
ALTER FUNCTION sa_domain.capture_transfer_mail() OWNER TO sa_worker;
REVOKE ALL ON FUNCTION sa_domain.capture_transfer_mail() FROM PUBLIC,anon,authenticated,sa_app,service_role;
CREATE TRIGGER squad_capture_transfer_mail AFTER UPDATE OF state ON sa_domain.transfers FOR EACH ROW EXECUTE FUNCTION sa_domain.capture_transfer_mail();

-- A crashed lease or source refresh updates the visible per-recipient state
-- immediately; no unbounded scanner and no delivery left permanently prepared.
CREATE FUNCTION sa_domain.capture_business_mail_failure() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE document_ uuid;BEGIN
 IF NEW.event_type='business.mail_delivery' THEN
  UPDATE sa_domain.business_mail_deliveries SET state='failed',error_code=NEW.last_error_code,updated_at=now() WHERE job_id=NEW.id AND state<>'sent' RETURNING document_id INTO document_;
 ELSIF NEW.event_type='document.mail' THEN document_:=(NEW.payload->>'document_id')::uuid;
 END IF;
 IF document_ IS NOT NULL THEN UPDATE sa_domain.documents SET delivery_state='failed' WHERE id=document_ AND delivery_state<>'sent';END IF;
 RETURN NEW;
END $f$;
ALTER FUNCTION sa_domain.capture_business_mail_failure() OWNER TO sa_worker;
REVOKE ALL ON FUNCTION sa_domain.capture_business_mail_failure() FROM PUBLIC,anon,authenticated,sa_app,service_role;
CREATE TRIGGER squad_capture_business_mail_failure AFTER UPDATE OF status ON sa_domain.outbox FOR EACH ROW WHEN(NEW.status='dead' AND OLD.status IS DISTINCT FROM 'dead' AND NEW.event_type IN('business.mail_delivery','document.mail')) EXECUTE FUNCTION sa_domain.capture_business_mail_failure();

CREATE FUNCTION sa_domain.business_mail_settle(p_job sa_domain.outbox,p_code text,p_result jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
DECLARE retry_ boolean:=p_code='PROVIDER_UNAVAILABLE' AND p_job.attempts<5;state_ text;BEGIN
 state_:=CASE WHEN p_code='SENT' THEN 'done' WHEN retry_ THEN 'pending' ELSE 'dead' END;
 UPDATE sa_domain.job_attempts SET state=CASE WHEN p_code='SENT' THEN 'done' ELSE 'failed' END,finished_at=now(),error_code=CASE WHEN p_code<>'SENT' THEN p_code END WHERE lease_token=p_job.lease_token;
 UPDATE sa_domain.outbox SET status=state_,last_error_code=CASE WHEN p_code<>'SENT' THEN p_code END,result=p_result,lease_until=NULL,completed_at=CASE WHEN NOT retry_ THEN now() END,available_at=now()+make_interval(secs=>least(3600,30*power(2,least(p_job.attempts,7))::int)),revision=revision+1 WHERE id=p_job.id;
 RETURN jsonb_build_object('id',p_job.id,'state',state_,'error_code',CASE WHEN p_code<>'SENT' THEN p_code END);
END $f$;
ALTER FUNCTION sa_domain.business_mail_settle(sa_domain.outbox,text,jsonb) OWNER TO sa_worker;
REVOKE ALL ON FUNCTION sa_domain.business_mail_settle(sa_domain.outbox,text,jsonb) FROM PUBLIC,anon,authenticated,sa_app,service_role;

CREATE FUNCTION sa_domain.business_mail_targets(p_job sa_domain.outbox) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE ctx jsonb:=sa_domain.ops_context();kind_ text:=p_job.payload->>'kind';ids_ bigint[];d sa_domain.documents;t sa_domain.transfers;id_ bigint;BEGIN
 IF p_job.event_type='document.mail' THEN
  SELECT * INTO d FROM sa_domain.documents WHERE id=(p_job.payload->>'document_id')::uuid;
  IF d.id IS NULL OR NOT sa_domain.document_current(d) OR d.state<>'ready' OR d.expires_at<=now() OR d.request->>'delivery' IS DISTINCT FROM 'email' THEN RAISE EXCEPTION 'Document unavailable' USING ERRCODE='42501';END IF;
  kind_:=d.kind;
  IF kind_='catalogue' THEN ids_:=ARRAY[d.legacy_user_id];
  ELSIF kind_='delivery_challan' THEN SELECT o.customer_id INTO id_ FROM sa_snapshot_20261019.sa_items i JOIN sa_snapshot_20261019.sa_orders o ON o.id=i.order_id WHERE i.id=(d.request->>'item_id')::bigint;ids_:=ARRAY[id_];
  ELSE SELECT recipient_ids INTO ids_ FROM sa_domain.business_mail_settings WHERE kind='tailor_weekly';END IF;
 ELSIF kind_='dealer_order' THEN
  IF NOT sa_domain.can_order(p_job.aggregate_id) THEN RAISE EXCEPTION 'Order unavailable' USING ERRCODE='42501';END IF;
  SELECT customer_dealer_id INTO id_ FROM sa_snapshot_20261019.sa_orders WHERE id=p_job.aggregate_id;
  IF id_ IS NULL THEN RETURN jsonb_build_object('kind',kind_,'recipients','[]'::jsonb,'ignored','NO_DEALER');END IF;ids_:=ARRAY[id_];
 ELSIF kind_='price_alert' THEN
  IF NOT sa_domain.can_order(p_job.aggregate_id) THEN RAISE EXCEPTION 'Order unavailable' USING ERRCODE='42501';END IF;
  SELECT recipient_ids INTO ids_ FROM sa_domain.business_mail_settings WHERE kind=kind_;
 ELSIF kind_='bulk_price_result' THEN
  SELECT * INTO t FROM sa_domain.transfers WHERE id=(p_job.payload->>'transfer_id')::uuid;
  IF t.id IS NULL OR NOT sa_domain.transfer_current(t) OR t.state NOT IN('completed','failed','invalid') OR t.direction<>'import' OR t.kind<>'prices' THEN RAISE EXCEPTION 'Transfer unavailable' USING ERRCODE='42501';END IF;
  SELECT recipient_ids INTO ids_ FROM sa_domain.business_mail_settings WHERE kind=kind_;
 ELSIF kind_='welcome' THEN
  IF NOT((ctx->>'legacy_user_id')::bigint=p_job.aggregate_id OR sa_domain.can_manage_person(p_job.aggregate_id)) THEN RAISE EXCEPTION 'Person unavailable' USING ERRCODE='42501';END IF;ids_:=ARRAY[p_job.aggregate_id];
 ELSE RAISE EXCEPTION 'Unknown mail type' USING ERRCODE='22023';END IF;
 IF coalesce(cardinality(ids_),0)=0 THEN RAISE EXCEPTION 'Configure authorized mail recipients' USING ERRCODE='55000';END IF;
 RETURN jsonb_build_object('kind',kind_,'document_id',d.id,'transfer_id',t.id,'recipients',(SELECT coalesce(jsonb_agg(jsonb_build_object('user_id',n.user_id,'auth_id',n.auth_id,'role_id',n.role_id) ORDER BY n.user_id),'[]') FROM sa_domain.notification_candidates(jsonb_build_object('audience',(SELECT jsonb_agg(jsonb_build_object('id',x)) FROM unnest(ids_) x)),0) n WHERE CASE kind_ WHEN 'dealer_order' THEN n.role_id=10 WHEN 'price_alert' THEN n.role_id=0 WHEN 'bulk_price_result' THEN n.role_id=0 WHEN 'tailor_weekly' THEN n.role_id IN(0,2,4) ELSE true END));
END $f$;
ALTER FUNCTION sa_domain.business_mail_targets(sa_domain.outbox) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.business_mail_targets(sa_domain.outbox) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.business_mail_targets(sa_domain.outbox) TO sa_worker;
GRANT EXECUTE ON FUNCTION sa_domain.document_current(sa_domain.documents) TO sa_guard;

CREATE FUNCTION sa_domain.business_mail_fanout(p_job sa_domain.outbox) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
DECLARE plan_ jsonb;r jsonb;job_ uuid;n integer:=0;BEGIN
 plan_:=sa_domain.business_mail_targets(p_job);
 IF jsonb_array_length(plan_->'recipients')>10 THEN RAISE EXCEPTION 'Too many mail recipients' USING ERRCODE='54000';END IF;
 IF jsonb_array_length(plan_->'recipients')=0 AND plan_->>'ignored' IS NULL THEN RAISE EXCEPTION 'No eligible recipients' USING ERRCODE='42501';END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(plan_->'recipients') LOOP
  INSERT INTO sa_domain.outbox(parent_id,actor_id,event_type,aggregate_kind,aggregate_id,command_key,generation,payload)
  VALUES(p_job.id,(r->>'auth_id')::uuid,'business.mail_delivery',p_job.aggregate_kind,p_job.aggregate_id,p_job.id,p_job.generation,jsonb_build_object('kind',plan_->>'kind')) ON CONFLICT DO NOTHING RETURNING id INTO job_;
  IF job_ IS NOT NULL THEN INSERT INTO sa_domain.business_mail_deliveries(job_id,source_job,generation,kind,entity_id,document_id,transfer_id,recipient_id,recipient_role,recipient_auth_id)
   VALUES(job_,p_job.id,p_job.generation,plan_->>'kind',p_job.aggregate_id,(plan_->>'document_id')::uuid,(plan_->>'transfer_id')::uuid,(r->>'user_id')::bigint,(r->>'role_id')::integer,(r->>'auth_id')::uuid);n:=n+1;END IF;
 END LOOP;
 RETURN sa_domain.business_mail_settle(p_job,'SENT',jsonb_build_object('recipients',n,'ignored',plan_->>'ignored'));
END $f$;
ALTER FUNCTION sa_domain.business_mail_fanout(sa_domain.outbox) OWNER TO sa_worker;
REVOKE ALL ON FUNCTION sa_domain.business_mail_fanout(sa_domain.outbox) FROM PUBLIC,anon,authenticated,sa_app,service_role;

-- Recipient context is established by its own child job. Never impersonate the
-- original document requester or trust an email from a browser/job payload.
CREATE FUNCTION sa_domain.business_mail_content(p_delivery sa_domain.business_mail_deliveries) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $f$
DECLARE a sa_domain.actor:=sa_domain.actor();m sa_domain.business_mail_deliveries:=p_delivery;d sa_domain.documents;o record;t sa_domain.transfers;u record;email_ text;data_ jsonb;row_ record;id_ bigint;BEGIN
 IF a.auth_id<>m.recipient_auth_id OR a.user_id<>m.recipient_id OR a.role_id<>m.recipient_role OR m.generation<>(SELECT generation FROM sa_domain.runtime_state) THEN RAISE EXCEPTION 'Mail recipient changed' USING ERRCODE='42501';END IF;
 SELECT email INTO email_ FROM sa_domain.auth_context();
 IF m.kind IN('price_alert','bulk_price_result','tailor_weekly') AND NOT EXISTS(SELECT FROM sa_domain.business_mail_settings WHERE kind=m.kind AND a.user_id=ANY(recipient_ids)) THEN RAISE EXCEPTION 'Mail recipient configuration changed' USING ERRCODE='42501';END IF;
 IF m.document_id IS NOT NULL THEN
  SELECT * INTO d FROM sa_domain.documents WHERE id=m.document_id;
  IF d.id IS NULL OR d.generation<>m.generation OR d.state<>'ready' OR d.expires_at<=now() OR d.request->>'delivery' IS DISTINCT FROM 'email' OR d.kind<>m.kind THEN RAISE EXCEPTION 'Document unavailable' USING ERRCODE='42501';END IF;
  IF m.kind='catalogue' THEN IF NOT sa_domain.document_current(d) THEN RAISE EXCEPTION 'Catalogue scope changed' USING ERRCODE='42501';END IF;
  ELSIF m.kind='delivery_challan' THEN
   SELECT o1.id INTO id_ FROM sa_snapshot_20261019.sa_items i JOIN sa_snapshot_20261019.sa_orders o1 ON o1.id=i.order_id WHERE i.id=(d.request->>'item_id')::bigint AND o1.customer_id=a.user_id;
   IF a.role_id NOT IN(3,10) OR id_ IS NULL OR NOT sa_domain.can_order(id_) THEN RAISE EXCEPTION 'Dispatch recipient changed' USING ERRCODE='42501';END IF;
  ELSE
   IF a.role_id NOT IN(0,2,4) OR NOT sa_domain.can_person((d.request->>'tailor_id')::bigint) OR(a.role_id=4 AND sa_domain.effective_factory((d.request->>'tailor_id')::bigint) IS DISTINCT FROM a.factory_id) OR EXISTS(SELECT FROM jsonb_array_elements_text(coalesce(d.authority_scope->'items','[]')) x WHERE x::bigint NOT IN(SELECT sa_domain.scope_item_ids())) THEN RAISE EXCEPTION 'Report scope unavailable' USING ERRCODE='42501';END IF;
  END IF;
  RETURN jsonb_build_object('email',email_,'data',jsonb_build_object('document_id',d.id,'pages',d.page_count,'kind',d.kind),'attachment',jsonb_build_object('path',d.object_path,'bytes',d.bytes,'sha256',d.sha256,'pages',d.page_count));
 ELSIF m.kind IN('dealer_order','price_alert') THEN
  SELECT id,coalesce(nullif(uc_order_id,''),upper(left((SELECT environment FROM sa_sync.environment_state WHERE singleton),1))||'-'||id) AS order_number,total_quantity,total_amount,created_by_id,customer_id,customer_dealer_id,customer_sc_id INTO o FROM sa_snapshot_20261019.sa_orders WHERE id=m.entity_id;
  IF o.id IS NULL OR NOT sa_domain.can_order(o.id) OR(m.kind='dealer_order' AND(a.role_id<>10 OR o.customer_dealer_id IS DISTINCT FROM a.user_id)) OR(m.kind='price_alert' AND a.role_id<>0) THEN RAISE EXCEPTION 'Order mail unavailable' USING ERRCODE='42501';END IF;
  data_:=jsonb_build_object('order_id',o.id::text,'order_number',o.order_number,'total_quantity',o.total_quantity::text,'total_amount',o.total_amount::text,'created_by',(SELECT name FROM sa_snapshot_20261019.sa_users WHERE id=o.created_by_id));
  IF m.kind='dealer_order' THEN
   data_:=data_||jsonb_build_object('item_count',(SELECT count(*) FROM sa_snapshot_20261019.sa_items WHERE order_id=o.id),'items',(SELECT coalesce(jsonb_agg(x ORDER BY (x->>'id')::bigint),'[]') FROM(SELECT jsonb_build_object('id',i.id::text,'name',coalesce(p.name,c.name,'Product'),'category',coalesce(cat.name,rc.name,'Uncategorized'),'quantity',i.total_quantity::text,'amount',i.total_amount::text,'cgst',i.cgst_amount::text,'sgst',i.sgst_amount::text,'igst',i.igst_amount::text) x FROM sa_snapshot_20261019.sa_items i LEFT JOIN sa_snapshot_20261019.sa_products p ON p.id=i.product_id LEFT JOIN sa_snapshot_20261019.sa_categories cat ON cat.id=p.category_id LEFT JOIN sa_snapshot_20261019.sa_rmp_classes c ON c.id=i.rmp_class_id LEFT JOIN sa_snapshot_20261019.sa_rmp_categories rc ON rc.id=i.rmp_category_id WHERE i.order_id=o.id ORDER BY i.id LIMIT 50) items));
  ELSE
   SELECT i.id,CASE WHEN i.item_type=1 THEN i.per_piece_amount ELSE i.calculated_per_piece_amount END original_price,CASE WHEN i.item_type=1 THEN i.rmp_override_price ELSE i.per_piece_amount END changed_price INTO row_ FROM sa_snapshot_20261019.sa_items i WHERE i.order_id=o.id AND CASE WHEN i.item_type=1 THEN coalesce(i.rmp_override_price,0)>0 AND coalesce(i.rmp_override_price,0)<>coalesce(i.per_piece_amount,0) WHEN i.item_type=0 THEN coalesce(i.calculated_per_piece_amount,0)>0 AND coalesce(i.calculated_per_piece_amount,0)<>coalesce(i.per_piece_amount,0) ELSE false END ORDER BY i.id LIMIT 1;
   IF row_.id IS NULL THEN RETURN jsonb_build_object('skip',true,'reason','PRICE_DIFFERENCE_RESOLVED');END IF;
   data_:=data_||jsonb_build_object('item_id',row_.id::text,'original_price',row_.original_price::text,'changed_price',row_.changed_price::text,'customer',(SELECT name FROM sa_snapshot_20261019.sa_users WHERE id=o.customer_id),'coordinator',(SELECT name FROM sa_snapshot_20261019.sa_users WHERE id=o.customer_sc_id));
  END IF;
 ELSIF m.kind='bulk_price_result' THEN
  IF a.role_id<>0 THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501';END IF;SELECT * INTO t FROM sa_domain.transfers WHERE id=m.transfer_id;
  IF t.id IS NULL OR t.generation<>m.generation OR t.kind<>'prices' OR t.state NOT IN('completed','failed','invalid') THEN RAISE EXCEPTION 'Transfer unavailable' USING ERRCODE='42501';END IF;
  data_:=jsonb_build_object('transfer_id',t.id,'status',t.state,'total',t.total_rows::text,'valid',t.valid_rows::text,'invalid',t.invalid_rows::text,'applied',t.applied_rows::text,'error_code',t.error_code,'result',t.result);
 ELSIF m.kind='welcome' THEN
  IF m.entity_id<>a.user_id THEN RAISE EXCEPTION 'Welcome recipient changed' USING ERRCODE='42501';END IF;SELECT id,name,role INTO u FROM sa_snapshot_20261019.sa_users WHERE id=a.user_id;
  data_:=jsonb_build_object('name',u.name,'role',a.role_id,'account_access','secure_invitation_or_existing_credentials');
 ELSE RAISE EXCEPTION 'Unknown message' USING ERRCODE='22023';END IF;
 RETURN jsonb_build_object('email',email_,'data',data_);
END $f$;
ALTER FUNCTION sa_domain.business_mail_content(sa_domain.business_mail_deliveries) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.business_mail_content(sa_domain.business_mail_deliveries) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.business_mail_content(sa_domain.business_mail_deliveries) TO sa_worker;

CREATE FUNCTION sa_domain.squad_business_mail_prepare(p_id uuid,p_lease_token uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE j sa_domain.outbox;m sa_domain.business_mail_deliveries;g bigint;r jsonb;error_ text;BEGIN
 PERFORM sa_domain.assert_service_worker();g:=sa_domain.worker_write_fence();SELECT * INTO j FROM sa_domain.outbox WHERE id=p_id FOR UPDATE;
 IF j.id IS NULL OR j.generation<>g OR j.lease_token IS DISTINCT FROM p_lease_token OR p_lease_token IS NULL OR j.event_type NOT IN('business.mail_fanout','business.mail_delivery','document.mail') THEN RAISE EXCEPTION 'Mail lease unavailable' USING ERRCODE='40001';END IF;
 IF j.status IN('done','dead') THEN RETURN jsonb_build_object('id',j.id,'state',j.status,'replayed',true);END IF;
 IF j.status<>'leased' OR j.lease_until<=statement_timestamp() THEN RAISE EXCEPTION 'Mail lease expired' USING ERRCODE='40001';END IF;
 BEGIN
  INSERT INTO sa_domain.worker_context VALUES(pg_backend_pid(),txid_current(),j.id,j.actor_id,j.generation,j.lease_token);
  IF j.event_type<>'business.mail_delivery' THEN r:=sa_domain.business_mail_fanout(j);
  ELSE
   SELECT * INTO m FROM sa_domain.business_mail_deliveries WHERE job_id=j.id FOR UPDATE;
   IF m.job_id IS NULL THEN RAISE EXCEPTION 'Mail intent unavailable' USING ERRCODE='42501';END IF;
   IF m.state='sent' THEN r:=sa_domain.business_mail_settle(j,'SENT',jsonb_build_object('replayed',true));
   ELSE
    r:=sa_domain.business_mail_content(m);
    IF r->>'skip'='true' THEN UPDATE sa_domain.business_mail_deliveries SET state='sent',content=jsonb_build_object('skipped',r->>'reason'),updated_at=now() WHERE job_id=j.id;r:=sa_domain.business_mail_settle(j,'SENT',r-'email');
    ELSE
     IF octet_length((r->'data')::text)>65536 THEN RAISE EXCEPTION 'Mail content exceeds supported limit' USING ERRCODE='54000';END IF;
     IF m.bound_email IS NOT NULL AND m.bound_email IS DISTINCT FROM r->>'email' THEN RAISE EXCEPTION 'Mail email binding changed' USING ERRCODE='42501';END IF;
     UPDATE sa_domain.business_mail_deliveries SET state='prepared',bound_email=r->>'email',content=coalesce(content,r->'data'),updated_at=now() WHERE job_id=j.id RETURNING * INTO m;
     UPDATE sa_domain.outbox SET lease_until=statement_timestamp()+interval '90 seconds' WHERE id=j.id;
     r:=jsonb_build_object('id',j.id,'state','prepared','message_id',j.id,'kind',m.kind,'email',r->>'email','data',m.content,'attachment',r->'attachment');
    END IF;
   END IF;
  END IF;
  DELETE FROM sa_domain.worker_context WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
 EXCEPTION WHEN invalid_authorization_specification OR insufficient_privilege OR no_data_found THEN error_:='MAIL_RECIPIENT_UNAVAILABLE';
 WHEN object_not_in_prerequisite_state THEN error_:='MAIL_NOT_CONFIGURED';
 WHEN program_limit_exceeded THEN error_:='MAIL_MESSAGE_INVALID';
 END;
 IF error_ IS NOT NULL THEN
  UPDATE sa_domain.business_mail_deliveries SET state='failed',error_code=error_,updated_at=now() WHERE job_id=j.id;
  IF j.event_type='document.mail' THEN UPDATE sa_domain.documents SET delivery_state='failed' WHERE id=(j.payload->>'document_id')::uuid;END IF;
  IF m.document_id IS NOT NULL THEN UPDATE sa_domain.documents SET delivery_state='failed' WHERE id=m.document_id;END IF;
  r:=sa_domain.business_mail_settle(j,error_);
 END IF;RETURN r;
END $f$;
ALTER FUNCTION sa_domain.squad_business_mail_prepare(uuid,uuid) OWNER TO sa_worker;
CREATE FUNCTION sa_domain.squad_business_mail_finish(p_id uuid,p_lease_token uuid,p_code text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE j sa_domain.outbox;m sa_domain.business_mail_deliveries;g bigint;r jsonb;BEGIN
 PERFORM sa_domain.assert_service_worker();g:=sa_domain.worker_write_fence();SELECT * INTO j FROM sa_domain.outbox WHERE id=p_id FOR UPDATE;
 IF j.id IS NULL OR j.generation<>g OR j.lease_token IS DISTINCT FROM p_lease_token OR p_lease_token IS NULL OR j.event_type<>'business.mail_delivery' THEN RAISE EXCEPTION 'Mail lease unavailable' USING ERRCODE='40001';END IF;
 IF j.status='done' THEN RETURN jsonb_build_object('id',j.id,'state','done','replayed',true);END IF;
 IF j.status<>'leased' OR j.lease_until<=statement_timestamp() THEN RAISE EXCEPTION 'Mail lease expired' USING ERRCODE='40001';END IF;
 IF p_code IS NULL OR p_code NOT IN('SENT','MAIL_NOT_ENABLED','PROVIDER_UNAVAILABLE','MAIL_MESSAGE_INVALID','MAIL_ATTACHMENT_LIMIT') THEN RAISE EXCEPTION 'Invalid mail result' USING ERRCODE='22023';END IF;
 SELECT * INTO m FROM sa_domain.business_mail_deliveries WHERE job_id=j.id FOR UPDATE;IF m.state<>'prepared' THEN RAISE EXCEPTION 'Prepared delivery required' USING ERRCODE='55000';END IF;
 r:=sa_domain.business_mail_settle(j,p_code);
 UPDATE sa_domain.business_mail_deliveries SET state=CASE WHEN p_code='SENT' THEN 'sent' WHEN r->>'state'='pending' THEN 'pending' ELSE 'failed' END,error_code=CASE WHEN p_code<>'SENT' THEN p_code END,sent_at=CASE WHEN p_code='SENT' THEN now() END,updated_at=now() WHERE job_id=j.id;
 IF m.document_id IS NOT NULL THEN UPDATE sa_domain.documents SET delivery_state=CASE WHEN EXISTS(SELECT FROM sa_domain.business_mail_deliveries WHERE document_id=m.document_id AND state='failed') THEN 'failed' WHEN EXISTS(SELECT FROM sa_domain.business_mail_deliveries WHERE document_id=m.document_id AND state<>'sent') THEN 'pending' ELSE 'sent' END WHERE id=m.document_id;END IF;
 RETURN r;
END $f$;
ALTER FUNCTION sa_domain.squad_business_mail_finish(uuid,uuid,text) OWNER TO sa_worker;
-- Existing document worker receives terminal fanout state and performs no send;
-- recipient deliveries share the new business-mail worker and SMTP transport.
CREATE OR REPLACE FUNCTION sa_domain.squad_document_mail_prepare(p_id uuid,p_lease_token uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $f$ SELECT sa_domain.squad_business_mail_prepare(p_id,p_lease_token) $f$;
ALTER FUNCTION sa_domain.squad_document_mail_prepare(uuid,uuid) OWNER TO sa_worker;

DO $f$ DECLARE d text;signature_ text;BEGIN
 d:=pg_get_functiondef('sa_domain.job_handler(text,jsonb)'::regprocedure);d:=replace(d,'SELECT CASE WHEN',$s$SELECT CASE WHEN p_event IN('business.mail_fanout','business.mail_delivery') THEN 'business_mail' WHEN$s$);EXECUTE d;
 FOREACH signature_ IN ARRAY ARRAY['sa_domain.squad_job_claim(integer)','sa_domain.job_projection(sa_domain.outbox)'] LOOP
  d:=pg_get_functiondef(signature_::regprocedure);d:=replace(d,'''document_mail''','''document_mail'',''business_mail''');EXECUTE d;
 END LOOP;
END $f$;
-- Operator retry preserves the immutable recipient/content binding. The next
-- leased prepare rechecks the recipient's current role, email and resource scope.
DO $f$ DECLARE d text;BEGIN
 d:=pg_get_functiondef('sa_domain.v1_job_retry(uuid,text,text,uuid)'::regprocedure);
 d:=replace(d,'''PROVIDER_UNAVAILABLE'',''LEASE_EXHAUSTED''','''PROVIDER_UNAVAILABLE'',''LEASE_EXHAUSTED'',''MAIL_NOT_ENABLED'',''MAIL_NOT_CONFIGURED''');
 d:=replace(d,$s$ UPDATE sa_domain.outbox SET status='pending',attempts=0$s$,$s$
 IF j.event_type='business.mail_delivery' THEN
  DECLARE m sa_domain.business_mail_deliveries;d sa_domain.documents;BEGIN
   SELECT * INTO m FROM sa_domain.business_mail_deliveries WHERE job_id=j.id FOR UPDATE;
   IF m.job_id IS NULL OR m.state='sent' OR m.generation<>j.generation THEN RAISE EXCEPTION 'Mail intent cannot be retried' USING ERRCODE='55000';END IF;
   IF m.document_id IS NOT NULL THEN
    SELECT * INTO d FROM sa_domain.documents WHERE id=m.document_id FOR UPDATE;
    IF d.id IS NULL OR d.created_at<=now()-interval '23 hours' OR d.state<>'ready' OR d.expires_at<=now() OR d.output_cleanup_queued_at IS NOT NULL THEN RAISE EXCEPTION 'Document retention window requires a fresh request' USING ERRCODE='55000';END IF;
   END IF;
   UPDATE sa_domain.business_mail_deliveries SET state='pending',error_code=NULL,updated_at=now() WHERE job_id=j.id;
   IF m.document_id IS NOT NULL THEN UPDATE sa_domain.documents SET delivery_state=CASE WHEN EXISTS(SELECT FROM sa_domain.business_mail_deliveries WHERE document_id=m.document_id AND state='failed') THEN 'failed' ELSE 'pending' END WHERE id=m.document_id;END IF;
  END;
 END IF;
 UPDATE sa_domain.outbox SET status='pending',attempts=0$s$);
 EXECUTE d;
END $f$;
DO $f$ DECLARE f record;args_ text;roles_ text;BEGIN
 FOR f IN SELECT p.oid,p.proname,p.proargnames FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='sa_domain' AND p.proname=ANY(ARRAY['squad_business_mail_prepare','squad_business_mail_finish','v1_mail_settings_read','v1_mail_settings_save']) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,sa_app,service_role',f.oid::regprocedure);
  SELECT string_agg(quote_ident(x),',') INTO args_ FROM unnest(f.proargnames) x;
  EXECUTE format('CREATE FUNCTION canto_api.%I(%s) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS %L',f.proname,pg_get_function_arguments(f.oid),'SELECT sa_domain.'||f.proname||'('||coalesce(args_,'')||')');
  EXECUTE format('REVOKE ALL ON FUNCTION canto_api.%I(%s) FROM PUBLIC,anon,authenticated,sa_app,service_role',f.proname,pg_get_function_identity_arguments(f.oid));
  roles_:=CASE WHEN f.proname LIKE 'squad_%' THEN 'service_role' ELSE 'sa_app,authenticated' END;
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s,canto_api.%I(%s) TO %s',f.oid::regprocedure,f.proname,pg_get_function_identity_arguments(f.oid),roles_);
 END LOOP;
END $f$;
GRANT EXECUTE ON FUNCTION sa_domain.squad_business_mail_prepare(uuid,uuid) TO sa_worker;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_guard,sa_executor,sa_worker;
NOTIFY pgrst,'reload schema';
COMMIT;
