-- Application conflicts must not impersonate PostgreSQL serialization failures.
-- PostgREST 14 retries SQLSTATE 40001, including deliberately raised application
-- conflicts. PT409 preserves HTTP 409 without requesting a transaction retry.
-- Genuine engine serialization/deadlock errors must escape worker consumers.
-- https://supabase.com/kb/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b
-- No signatures, owners, ACLs, RLS, search paths or function security modes change.
DO $migration$
DECLARE r record; definition_ text; expected_ integer; actual_ integer;
BEGIN
 FOR r IN SELECT * FROM (VALUES
   ('sa_domain.account_master_save(text,text,jsonb,uuid[],uuid)',2),
   ('sa_domain.account_upload_reserve(jsonb,jsonb,text,uuid)',1),
   ('sa_domain.account_upload_verified(uuid,text,bigint,text)',2),
   ('sa_domain.airtable_capture_page(uuid,jsonb)',1),
   ('sa_domain.airtable_match_row(bigint)',1),
   ('sa_domain.airtable_media_register(uuid,jsonb)',1),
   ('sa_domain.airtable_size_position(bigint)',1),
   ('sa_domain.airtable_validate_batch(uuid)',1),
   ('sa_domain.apply_order_amendment(bigint,jsonb,uuid)',2),
   ('sa_domain.begin_command(text,uuid,jsonb)',2),
   ('sa_domain.begin_media_command(text,uuid,jsonb)',2),
   ('sa_domain.bump_version(text,bigint,text)',1),
   ('sa_domain.consume_dealer_stock(sa_snapshot_20261019.sa_items,bigint,bigint,integer,timestamp with time zone)',1),
   ('sa_domain.design_for_order(jsonb,boolean)',1),
   ('sa_domain.import_request_csv(text,jsonb,uuid)',1),
   ('sa_domain.override_quote_prices(jsonb,jsonb)',1),
   ('sa_domain.person_structure_fence()',1),
   ('sa_domain.reassign_customers(jsonb,bigint)',1),
   ('sa_domain.settle_notification_devices(sa_domain.outbox,jsonb)',1),
   ('sa_domain.squad_account_finish(uuid,uuid,jsonb,text)',2),
   ('sa_domain.squad_account_flow_finish(uuid,uuid,text)',2),
   ('sa_domain.squad_account_mail_finish(uuid,uuid,boolean,text)',2),
   ('sa_domain.squad_account_mail_prepare(uuid,uuid)',1),
   ('sa_domain.squad_account_prepare(uuid,uuid)',1),
   ('sa_domain.squad_airtable_report_finish(uuid,uuid,jsonb)',2),
   ('sa_domain.squad_airtable_report_prepare(uuid,uuid)',2),
   ('sa_domain.squad_airtable_work(uuid,uuid,text,jsonb)',3),
   ('sa_domain.squad_business_mail_finish(uuid,uuid,text)',2),
   ('sa_domain.squad_business_mail_prepare(uuid,uuid)',2),
   ('sa_domain.squad_cutover_acceptance_register(jsonb)',2),
   ('sa_domain.squad_document_finish(uuid,uuid,jsonb)',3),
   ('sa_domain.squad_document_mail_finish(uuid,uuid,text)',2),
   ('sa_domain.squad_document_prepare(uuid,uuid)',2),
   ('sa_domain.squad_job_execute(uuid,uuid)',2),
   ('sa_domain.squad_notification_fanout(uuid,uuid)',2),
   ('sa_domain.squad_notification_finish(uuid,uuid,jsonb)',2),
   ('sa_domain.squad_notification_prepare(uuid,uuid)',2),
   ('sa_domain.squad_transfer_work(uuid,uuid,text,jsonb)',3),
   ('sa_domain.squad_warehouse_prepare(uuid,uuid)',2),
   ('sa_domain.squad_warehouse_webhook(uuid,uuid)',2),
   ('sa_domain.v1_backorder_place(uuid,text,text,uuid)',2),
   ('sa_domain.v1_coordinator_change_decide(bigint,text,text,text,text,uuid)',1),
   ('sa_domain.v1_cutover_commit(uuid,text,uuid)',2),
   ('sa_domain.v1_device_remove(uuid,text,uuid)',1),
   ('sa_domain.v1_device_save(uuid,text,text,text,uuid)',2),
   ('sa_domain.v1_import_request(text,jsonb,uuid)',1),
   ('sa_domain.v1_job_retry(uuid,text,text,uuid)',2),
   ('sa_domain.v1_media_attach(uuid,text,uuid)',1),
   ('sa_domain.v1_notifications_list(bigint,text,integer,bigint)',1),
   ('sa_domain.v1_quote_override(uuid,integer,numeric,text,text,uuid)',2),
   ('sa_domain.v1_stock_reconciliation(bigint,text,jsonb,text,integer)',1),
   ('sa_domain.validated_order_quote(uuid,text)',3),
   ('sa_domain.warehouse_amendment_payload(uuid,text,text,text)',1),
   ('sa_domain.warehouse_change_info(uuid)',2),
   ('sa_domain.warehouse_change_reference(uuid,text,text,text)',1),
   ('sa_domain.warehouse_customer_apply(bigint,text)',1),
   ('sa_domain.warehouse_customer_payload(bigint)',1),
   ('sa_domain.warehouse_finish_base(uuid,uuid,jsonb)',2),
   ('sa_domain.warehouse_finish_customer_base(uuid,uuid,jsonb)',2),
   ('sa_domain.warehouse_finish_dispatch(uuid,uuid,jsonb)',4),
   ('sa_domain.warehouse_inventory_store(uuid,uuid,bigint,numeric)',1),
   ('sa_domain.warehouse_prepare_base(uuid,uuid)',2),
   ('sa_domain.warehouse_prepare_customer_base(uuid,uuid)',2),
   ('sa_domain.warehouse_prepare_schedule_base(uuid,uuid)',2),
   ('sa_domain.warehouse_reconcile_enumerate(sa_domain.outbox,jsonb)',1),
   ('sa_domain.warehouse_status_apply(bigint,text,text,text,text,timestamp with time zone,text)',2),
   ('sa_domain.write_media(text,bigint,text,text,text,uuid,text)',1)
 ) AS reviewed(signature,raises) LOOP
  IF to_regprocedure(r.signature) IS NULL THEN RAISE EXCEPTION 'Conflict migration missing function: %',r.signature;END IF;
  SELECT pg_get_functiondef(to_regprocedure(r.signature)) INTO definition_;
  SELECT count(*) INTO actual_ FROM regexp_matches(definition_,$pattern$ERRCODE\s*=\s*'40001'$pattern$,'gi');
  IF actual_<>r.raises THEN RAISE EXCEPTION 'Conflict migration expected % raises in %, found %',r.raises,r.signature,actual_;END IF;
  definition_:=regexp_replace(definition_,$pattern$ERRCODE\s*=\s*'40001'$pattern$,$replacement$ERRCODE='PT409'$replacement$,'gi');
  EXECUTE definition_;
 END LOOP;

 -- These import handlers previously treated every serialization failure as an
 -- invalid row. Only application conflicts belong in a durable validation result.
 SELECT pg_get_functiondef('sa_domain.airtable_validate_batch(uuid)'::regprocedure) INTO definition_;
 actual_:=(length(definition_)-length(replace(definition_,' OR serialization_failure','')))/length(' OR serialization_failure');
 IF actual_<>2 THEN RAISE EXCEPTION 'Airtable validation handler drift: %',actual_;END IF;
 definition_:=replace(definition_,' OR serialization_failure OR SQLSTATE ''PT409''',' OR SQLSTATE ''PT409''');
 definition_:=replace(definition_,' OR serialization_failure THEN',' OR SQLSTATE ''PT409'' THEN');
 EXECUTE definition_;

 SELECT pg_get_functiondef('sa_domain.airtable_apply_batch(uuid)'::regprocedure) INTO definition_;
 actual_:=(length(definition_)-length(replace(definition_,' OR serialization_failure OR SQLSTATE ''PT409''','')))/length(' OR serialization_failure OR SQLSTATE ''PT409''');
 IF actual_<>3 THEN RAISE EXCEPTION 'Airtable apply handler drift: %',actual_;END IF;
 definition_:=replace(definition_,' OR serialization_failure OR SQLSTATE ''PT409''',' OR SQLSTATE ''PT409''');
 EXECUTE definition_;

 SELECT pg_get_functiondef('sa_domain.squad_transfer_work(uuid,uuid,text,jsonb)'::regprocedure) INTO definition_;
 IF strpos(definition_,'EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS code_=RETURNED_SQLSTATE,message_=MESSAGE_TEXT;END;')=0
  OR strpos(definition_,'IF code_ NOT IN(''42501'',''28000'',''P0002'',''40001'')')=0
  OR strpos(definition_,'IF code_ IN(''40P01'',''55P03'',''57014'',''53300'',''55000'') THEN RAISE;END IF;')=0
  OR strpos(definition_,'IF code_=''PT409'' THEN code_:=''40001'';END IF;')=0 THEN
  RAISE EXCEPTION 'Transfer exception handler drift';
 END IF;
 definition_:=replace(definition_,
  'EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS code_=RETURNED_SQLSTATE,message_=MESSAGE_TEXT;END;',
  'EXCEPTION WHEN serialization_failure OR deadlock_detected OR lock_not_available OR query_canceled OR too_many_connections OR object_not_in_prerequisite_state THEN RAISE; WHEN OTHERS THEN GET STACKED DIAGNOSTICS code_=RETURNED_SQLSTATE,message_=MESSAGE_TEXT;END;');
 definition_:=replace(definition_,'IF code_ NOT IN(''42501'',''28000'',''P0002'',''40001'')','IF code_ NOT IN(''42501'',''28000'',''P0002'',''PT409'')');
 definition_:=replace(definition_,'IF code_ IN(''40P01'',''55P03'',''57014'',''53300'',''55000'') THEN RAISE;END IF;',
  'IF code_ IN(''40001'',''40P01'',''55P03'',''57014'',''53300'',''55000'') THEN RAISE;END IF;');
 definition_:=replace(definition_,'IF code_=''PT409'' THEN code_:=''40001'';END IF;','');
 EXECUTE definition_;

 IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname IN('sa_domain','canto_api','sa_admin') AND p.prokind='f'
   AND p.prosrc ~* $pattern$ERRCODE\s*=\s*'40001'$pattern$) THEN
  RAISE EXCEPTION 'Synthetic serialization error remains in active Squad functions';
 END IF;
END
$migration$;
NOTIFY pgrst,'reload schema';
