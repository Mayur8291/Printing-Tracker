BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_guard,sa_worker,sa_executor;
CREATE TABLE sa_domain.airtable_report_config(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),enabled boolean NOT NULL DEFAULT false,active_job uuid,active_until timestamptz);
INSERT INTO sa_domain.airtable_report_config(singleton) VALUES(true);
ALTER TABLE sa_domain.airtable_report_config ENABLE ROW LEVEL SECURITY;ALTER TABLE sa_domain.airtable_report_config FORCE ROW LEVEL SECURITY;
GRANT SELECT ON sa_domain.airtable_report_config TO sa_guard;
GRANT SELECT,UPDATE ON sa_domain.airtable_report_config TO sa_worker,sa_executor;
CREATE POLICY report_config_guard ON sa_domain.airtable_report_config FOR SELECT TO sa_guard USING(true);
CREATE POLICY report_config_worker ON sa_domain.airtable_report_config TO sa_worker USING(true) WITH CHECK(true);
CREATE POLICY report_config_admin ON sa_domain.airtable_report_config TO sa_executor USING((sa_domain.ops_context()->>'admin')::boolean OR(sa_domain.ops_context()->>'platform')::boolean) WITH CHECK((sa_domain.ops_context()->>'admin')::boolean OR(sa_domain.ops_context()->>'platform')::boolean);
CREATE TABLE sa_domain.airtable_report_operations(job_id uuid PRIMARY KEY REFERENCES sa_domain.outbox,generation bigint NOT NULL,kind text NOT NULL CHECK(kind IN('customer','custom_order','rmp_order','tailor_pick')),entity_id bigint NOT NULL,report_key text NOT NULL,revision text NOT NULL,fields jsonb NOT NULL,parent jsonb,state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','confirmed','failed','reconciliation_required')),record_id text,proof jsonb,last_error_code text,updated_at timestamptz NOT NULL DEFAULT now(),CHECK(octet_length(fields::text)<=131072),CHECK(proof IS NULL OR octet_length(proof::text)<=262144));
CREATE INDEX report_operation_entity ON sa_domain.airtable_report_operations(kind,entity_id,generation,state);
ALTER TABLE sa_domain.airtable_report_operations ENABLE ROW LEVEL SECURITY;ALTER TABLE sa_domain.airtable_report_operations FORCE ROW LEVEL SECURITY;
GRANT SELECT ON sa_domain.airtable_report_operations TO sa_guard;
GRANT SELECT,INSERT,UPDATE ON sa_domain.airtable_report_operations TO sa_worker;
CREATE POLICY report_operations_guard ON sa_domain.airtable_report_operations FOR SELECT TO sa_guard USING(true);
CREATE POLICY report_operations_worker ON sa_domain.airtable_report_operations TO sa_worker USING(true) WITH CHECK(true);
GRANT SELECT(id,name,email,role,phone,created_by_id,customer_first_name,customer_last_name,customer_company_name,customer_registered_by,onboarded,approved,zone_id,rmp_price_type_id,gst_no,factory_id,deleted_at) ON sa_snapshot_20261019.sa_users TO sa_guard;
GRANT SELECT ON sa_snapshot_20261019.sa_orders,sa_snapshot_20261019.sa_items,sa_snapshot_20261019.sa_addresses,sa_snapshot_20261019.sa_user_dealers,sa_snapshot_20261019.sa_zones,sa_snapshot_20261019.sa_rmp_price_types,sa_snapshot_20261019.sa_products,sa_snapshot_20261019.sa_base_products,sa_snapshot_20261019.sa_product_parts,sa_snapshot_20261019.sa_product_part_add_ons,sa_snapshot_20261019.sa_add_ons,sa_snapshot_20261019.sa_fabrics,sa_snapshot_20261019.sa_factories,sa_snapshot_20261019.sa_quantities,sa_snapshot_20261019.sa_sizes,sa_snapshot_20261019.sa_rmp_sizes,sa_snapshot_20261019.sa_rmp_skus,sa_snapshot_20261019.sa_rmp_classes,sa_snapshot_20261019.sa_rmp_colors,sa_snapshot_20261019.sa_rmp_brands,sa_snapshot_20261019.sa_rmp_categories,sa_snapshot_20261019.sa_profit_margins,sa_snapshot_20261019.sa_ratings,sa_snapshot_20261019.sa_job_sheet_dispatched_dates,sa_snapshot_20261019.sa_job_sheet_tailor_mark_dates,sa_snapshot_20261019.sa_job_sheet_mark_tailors,sa_snapshot_20261019.sa_mark_tailor_quantities,sa_snapshot_20261019.sa_item_tailors,sa_snapshot_20261019.sa_item_tailor_quantities TO sa_guard;
DO $f$ DECLARE n text;BEGIN
 FOREACH n IN ARRAY ARRAY['addresses','zones','rmp_price_types','products','base_products','product_parts','product_part_add_ons','add_ons','fabrics','factories','quantities','sizes','rmp_sizes','rmp_skus','rmp_classes','rmp_colors','rmp_brands','rmp_categories','profit_margins','ratings','job_sheet_dispatched_dates','job_sheet_tailor_mark_dates','job_sheet_mark_tailors','mark_tailor_quantities','item_tailors','item_tailor_quantities'] LOOP
  EXECUTE format('CREATE POLICY airtable_report_guard ON sa_snapshot_20261019.%I FOR SELECT TO sa_guard USING(true)','sa_'||n);
 END LOOP;
END $f$;

GRANT SELECT ON sa_domain.rating_moderation TO sa_guard;
CREATE POLICY airtable_report_moderation ON sa_domain.rating_moderation FOR SELECT TO sa_guard USING(true);
CREATE FUNCTION sa_domain.report_authorized(p_job sa_domain.outbox,p_order bigint DEFAULT NULL,p_customer bigint DEFAULT NULL) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE source_ sa_domain.outbox;ctx jsonb;BEGIN
 SELECT * INTO source_ FROM sa_domain.outbox WHERE id=(p_job.payload->>'source_id')::uuid;
 IF source_.event_type='warehouse.status_changed' THEN
  RETURN p_order IS NOT NULL AND p_customer IS NULL AND source_.aggregate_kind='order' AND source_.aggregate_id=p_order AND source_.generation=p_job.generation AND(sa_domain.warehouse_configuration()->>'ready')::boolean
  AND EXISTS(SELECT FROM sa_domain.worker_context c JOIN sa_domain.outbox j ON j.id=c.job_id WHERE c.backend_pid=pg_backend_pid() AND c.transaction_id=txid_current() AND j.id=p_job.id AND c.lease_token=j.lease_token AND j.status='leased' AND j.lease_until>statement_timestamp() AND j.generation=(SELECT generation FROM sa_domain.runtime_state));
 END IF;
 ctx:=sa_domain.ops_context();RETURN(ctx->>'platform')::boolean OR CASE WHEN p_order IS NOT NULL THEN sa_domain.can_order(p_order) WHEN p_customer IS NOT NULL THEN sa_domain.can_person(p_customer) ELSE false END;
EXCEPTION WHEN invalid_authorization_specification OR insufficient_privilege OR no_data_found THEN RETURN false;
END $f$;
ALTER FUNCTION sa_domain.report_authorized(sa_domain.outbox,bigint,bigint) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.report_authorized(sa_domain.outbox,bigint,bigint) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.report_authorized(sa_domain.outbox,bigint,bigint) TO sa_worker;

CREATE FUNCTION sa_domain.airtable_report_projection(p_job sa_domain.outbox,p_family text,p_id bigint) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $f$
DECLARE u record;o sa_snapshot_20261019.sa_orders;i sa_snapshot_20261019.sa_items;product_ record;rating_ record;address_ record;person_ record;pick_ record;fields_ jsonb;kind_ text;environment_ text;prefix_ text;size_ text;names_ text;skus_ text;qty_ numeric;extra_ record;date_ text;parent_ jsonb;BEGIN
 SELECT environment INTO environment_ FROM sa_sync.environment_state;prefix_:=CASE environment_ WHEN 'staging' THEN 'S' WHEN 'production' THEN 'P' ELSE NULL END;
 IF prefix_ IS NULL THEN RAISE EXCEPTION 'Unknown report environment' USING ERRCODE='55000';END IF;
 IF p_family='customer' THEN
  IF NOT sa_domain.report_authorized(p_job,NULL,p_id) THEN RAISE EXCEPTION 'Customer report unavailable' USING ERRCODE='42501';END IF;
  SELECT id,name,email,role,phone,created_by_id,customer_first_name,customer_last_name,customer_company_name,customer_registered_by,onboarded,approved,zone_id,rmp_price_type_id,gst_no INTO u FROM sa_snapshot_20261019.sa_users WHERE id=p_id AND deleted_at IS NULL AND role=3;
  IF u.id IS NULL THEN RAISE EXCEPTION 'Customer report unavailable' USING ERRCODE='P0002';END IF;
  SELECT * INTO address_ FROM sa_snapshot_20261019.sa_addresses WHERE user_id=p_id AND deleted_at IS NULL ORDER BY is_primary DESC,created_at DESC,id DESC LIMIT 1;
  SELECT id,name,email,role INTO person_ FROM sa_snapshot_20261019.sa_users WHERE id=u.created_by_id;
  fields_:=jsonb_build_object('ID',prefix_||'-'||u.id,'Email',u.email,'Name',u.name,'Phone',u.phone,'SC Name',CASE WHEN person_.role=1 THEN person_.name ELSE '' END,'SC Email',CASE WHEN person_.role=1 THEN person_.email ELSE '' END,'Dealer Name',(SELECT name FROM sa_snapshot_20261019.sa_users WHERE id=(SELECT dealer_id FROM sa_snapshot_20261019.sa_user_dealers WHERE user_id=p_id ORDER BY dealer_id LIMIT 1)),'Dealer Email',(SELECT email FROM sa_snapshot_20261019.sa_users WHERE id=(SELECT dealer_id FROM sa_snapshot_20261019.sa_user_dealers WHERE user_id=p_id ORDER BY dealer_id LIMIT 1)),'Customer First Name',coalesce(u.customer_first_name,''),'Customer Last Name',coalesce(u.customer_last_name,''),'Customer Company Name',coalesce(u.customer_company_name,''),'Registered By',CASE u.customer_registered_by WHEN 0 THEN 'Self' WHEN 1 THEN 'SalesCoordinator' WHEN 2 THEN 'Dealer' WHEN 3 THEN 'Admin' ELSE '' END,'Onboarded',CASE WHEN u.onboarded THEN 'Yes' ELSE 'No' END,'Approved',CASE WHEN u.approved THEN 'Yes' ELSE 'No' END,'Zone',(SELECT name FROM sa_snapshot_20261019.sa_zones WHERE id=u.zone_id),'Rmp Price Type Name',(SELECT name FROM sa_snapshot_20261019.sa_rmp_price_types WHERE id=u.rmp_price_type_id),'GST',coalesce(u.gst_no,''),'Address',coalesce(address_.address,''),'State',coalesce(address_.state,''),'City',coalesce(address_.city,''),'Zip Code',coalesce(address_.zip_code,''));kind_:='customer';
 ELSE
  IF p_family='tailor_pick' THEN
   SELECT m.id,d.item_id,d.marked_at,t.tailor_id INTO pick_ FROM sa_snapshot_20261019.sa_job_sheet_mark_tailors m JOIN sa_snapshot_20261019.sa_job_sheet_tailor_mark_dates d ON d.id=m.job_sheet_tailor_mark_date_id JOIN sa_snapshot_20261019.sa_item_tailors t ON t.id=m.item_tailor_id AND t.item_id=d.item_id WHERE m.id=p_id;
   IF pick_.id IS NULL THEN RAISE EXCEPTION 'Picking report unavailable' USING ERRCODE='P0002';END IF;
   SELECT * INTO i FROM sa_snapshot_20261019.sa_items WHERE id=pick_.item_id;
  ELSE SELECT * INTO i FROM sa_snapshot_20261019.sa_items WHERE id=p_id;END IF;
  SELECT * INTO o FROM sa_snapshot_20261019.sa_orders WHERE id=i.order_id AND deleted_at IS NULL AND is_deleted IS NOT TRUE;
  IF i.id IS NULL OR o.id IS NULL OR NOT sa_domain.report_authorized(p_job,o.id,NULL) THEN RAISE EXCEPTION 'Order report unavailable' USING ERRCODE='42501';END IF;
  SELECT id,name,phone,customer_company_name,rmp_price_type_id INTO u FROM sa_snapshot_20261019.sa_users WHERE id=o.customer_id;
  SELECT rating,positive_comments,negative_comments INTO rating_ FROM sa_snapshot_20261019.sa_ratings WHERE rating_on_type='Order' AND rating_on_id=o.id AND from_role='Customer' AND NOT EXISTS(SELECT FROM sa_domain.rating_moderation m WHERE m.rating_id=sa_ratings.id AND m.generation=(SELECT generation FROM sa_domain.runtime_state)) ORDER BY id DESC LIMIT 1;
  SELECT string_agg(upper(s.name)||'-'||q.n,', ' ORDER BY s.name),string_agg(s.name,', ' ORDER BY s.name),sum(q.n) INTO size_,names_,qty_ FROM(SELECT size_id,sum(quantity) n FROM sa_snapshot_20261019.sa_quantities WHERE item_id=i.id AND(i.item_type<>1 OR quantity>0) GROUP BY size_id) q JOIN sa_snapshot_20261019.sa_sizes s ON s.id=q.size_id;
  IF i.dispatched_status=1 THEN SELECT to_char(max(dispatched_at),'YYYY-MM-DD') INTO date_ FROM sa_snapshot_20261019.sa_job_sheet_dispatched_dates WHERE item_id=i.id;END IF;
  IF p_family='tailor_pick' THEN
   SELECT sum(q.completed_quantity),string_agg(upper(q.name)||'-'||q.completed_quantity,', ' ORDER BY q.name) INTO qty_,size_ FROM(SELECT s.name,sum(m.completed_quantity) completed_quantity FROM sa_snapshot_20261019.sa_mark_tailor_quantities m JOIN sa_snapshot_20261019.sa_item_tailor_quantities itq ON itq.id=m.item_tailor_quantity_id JOIN sa_snapshot_20261019.sa_quantities q ON q.id=itq.quantity_id JOIN sa_snapshot_20261019.sa_sizes s ON s.id=q.size_id WHERE m.job_sheet_mark_tailor_id=p_id GROUP BY s.name) q;
   fields_:=jsonb_build_object('Jobsheet Number','[]'::jsonb,'Picking Date/Time',to_char(pick_.marked_at,'YYYY-MM-DD HH24:MI:SS'),'Total Quantity',coalesce(qty_,0),'Size Breakup',coalesce(size_,''),'Tailor',(SELECT name FROM sa_snapshot_20261019.sa_users WHERE id=pick_.tailor_id));kind_:='tailor_pick';parent_:=jsonb_build_object('kind',CASE i.item_type WHEN 0 THEN 'custom_order' ELSE 'rmp_order' END,'key',environment_||':'||CASE i.item_type WHEN 0 THEN 'custom_order' ELSE 'rmp_order' END||':'||i.id);
  ELSIF i.item_type=0 THEN
   SELECT p.name,p.comment,b.base_of,b.base_sn,b.tims_cost,b.over_header_percentage,f.price fabric_price INTO product_ FROM sa_snapshot_20261019.sa_products p LEFT JOIN sa_snapshot_20261019.sa_base_products b ON b.id=p.base_product_id LEFT JOIN sa_snapshot_20261019.sa_fabrics f ON f.id=p.fabric_id WHERE p.id=i.product_id;
   SELECT coalesce(sum(a.add_on_price),0) cost,coalesce(sum(a.add_on_of),0) of_,coalesce(sum(a.add_on_sn),0) sn INTO extra_ FROM sa_snapshot_20261019.sa_product_parts pp JOIN sa_snapshot_20261019.sa_product_part_add_ons pa ON pa.product_part_id=pp.id JOIN sa_snapshot_20261019.sa_add_ons a ON a.id=pa.add_on_id WHERE pp.product_id=i.product_id;
   fields_:=jsonb_build_object('Jobsheet Number','JS-'||prefix_||'-'||i.id,'Item Type','custom','Order Date',to_char(o.created_on,'YYYY-MM-DD'),'Order ID','OD-'||prefix_||'-'||o.id,'Expected Delivery Date',to_char(o.due_on,'YYYY-MM-DD'),'Actual Delivery Date',date_,'Order Status',CASE o.status WHEN 0 THEN 'PENDING' WHEN 1 THEN 'COMPLETED' ELSE 'UNKNOWN' END,'Customer Name',coalesce(nullif(u.customer_company_name,''),u.name),'Product',product_.name,'Description',coalesce(product_.comment,''),'Base OF',coalesce(product_.base_of,0),'Base SN',coalesce(product_.base_sn,0),'Add-on Cost',extra_.cost,'Add-on OF',extra_.of_,'Add-on SN',extra_.sn,'Fabric Rate',coalesce(product_.fabric_price,0),'Trims Cost/Pc',coalesce(product_.tims_cost,0),'Overhead',coalesce(product_.over_header_percentage,0),'Factory',(SELECT f.name FROM sa_snapshot_20261019.sa_users manager JOIN sa_snapshot_20261019.sa_factories f ON f.id=manager.factory_id WHERE manager.id=o.assigned_to_id),'Total Quantity',coalesce(qty_,0),'Size Breakup',coalesce(size_,''),'Fabric Consumption',i.weight_per_piece,'Branding Cost',o.branding_amount,'Margin %',coalesce((SELECT margin_percentage FROM sa_snapshot_20261019.sa_profit_margins WHERE i.total_quantity BETWEEN min_range AND max_range ORDER BY id LIMIT 1),0),'Key Account Manager (KAM)',(SELECT name FROM sa_snapshot_20261019.sa_users WHERE id=o.created_by_id),'Rating',coalesce(rating_.rating::text,''),'Created By',(SELECT name FROM sa_snapshot_20261019.sa_users WHERE id=o.created_by_id),'Customer Positive Review',rating_.positive_comments,'Customer Negative Review',rating_.negative_comments);kind_:='custom_order';
  ELSIF i.item_type=1 THEN
   SELECT * INTO address_ FROM sa_snapshot_20261019.sa_addresses WHERE id=o.address_id;
   SELECT string_agg(DISTINCT sku.name,', ' ORDER BY sku.name) INTO skus_ FROM sa_snapshot_20261019.sa_quantities q JOIN sa_snapshot_20261019.sa_sizes s ON s.id=q.size_id LEFT JOIN LATERAL(SELECT id FROM sa_snapshot_20261019.sa_rmp_sizes WHERE name=s.name ORDER BY is_deleted,id LIMIT 1) rs ON true LEFT JOIN LATERAL(SELECT name FROM sa_snapshot_20261019.sa_rmp_skus WHERE rmp_size_id=rs.id AND rmp_brand_id=i.rmp_brand_id AND rmp_class_id=i.rmp_class_id ORDER BY is_deleted,id LIMIT 1) sku ON true WHERE q.item_id=i.id AND q.quantity>0;
   fields_:=jsonb_build_object('Order ID','OD-'||prefix_||'-'||o.id,'Order Date',to_char(o.created_on,'YYYY-MM-DD'),'Delivery Required On',to_char(o.due_on,'YYYY-MM-DD'),'Order Status',CASE o.status WHEN 0 THEN 'PENDING' WHEN 1 THEN 'COMPLETED' ELSE 'UNKNOWN' END,'Customer Name',coalesce(nullif(u.customer_company_name,''),u.name),'Dispatch Date',date_,'Sales Coordinator',(SELECT name FROM sa_snapshot_20261019.sa_users WHERE id=o.customer_sc_id),'Customer''s Mobile',u.phone,'City',coalesce(address_.city,''),'State',coalesce(address_.state,''),'Customer Type',(SELECT name FROM sa_snapshot_20261019.sa_rmp_price_types WHERE id=u.rmp_price_type_id),'SKU',coalesce(skus_,''),'Class',(SELECT name FROM sa_snapshot_20261019.sa_rmp_classes WHERE id=i.rmp_class_id),'Color',(SELECT coalesce(c.name,'') FROM sa_snapshot_20261019.sa_rmp_classes cl LEFT JOIN sa_snapshot_20261019.sa_rmp_colors c ON c.id=cl.rmp_color_id WHERE cl.id=i.rmp_class_id),'Size',coalesce(names_,''),'Product Name',(SELECT name FROM sa_snapshot_20261019.sa_rmp_brands WHERE id=i.rmp_brand_id),'Product Category',(SELECT name FROM sa_snapshot_20261019.sa_rmp_categories WHERE id=i.rmp_category_id),'Qty',i.total_quantity,'Price',round(i.total_amount/nullif(i.total_quantity,0),2),'Amount',i.total_amount,'Gst Amount',i.sgst_amount+i.cgst_amount+i.igst_amount,'Remark',left(coalesce(i.comment,''),350),'Total Amount',i.total_amount+i.sgst_amount+i.cgst_amount+i.igst_amount,'Created By',(SELECT name FROM sa_snapshot_20261019.sa_users WHERE id=o.created_by_id),'Rating',coalesce(rating_.rating::text,''),'Customer Positive Review',rating_.positive_comments,'Customer Negative Review',rating_.negative_comments);kind_:='rmp_order';
  ELSE RAISE EXCEPTION 'Unsupported report item kind' USING ERRCODE='22023';END IF;
 END IF;
 IF octet_length(fields_::text)>131072 THEN RAISE EXCEPTION 'Report exceeds supported size' USING ERRCODE='54000';END IF;
 RETURN jsonb_build_object('environment',environment_,'kind',kind_,'entity_id',p_id::text,'key',environment_||':'||kind_||':'||p_id,'revision',p_job.generation||':'||p_job.sequence_id,'fields',fields_,'parent',parent_);
END $f$;
ALTER FUNCTION sa_domain.airtable_report_projection(sa_domain.outbox,text,bigint) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.airtable_report_projection(sa_domain.outbox,text,bigint) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.airtable_report_projection(sa_domain.outbox,text,bigint) TO sa_worker;
CREATE FUNCTION sa_domain.report_enqueue(p_source sa_domain.outbox,p_family text,p_id bigint) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
BEGIN
 IF p_id IS NULL OR p_id<=0 OR p_family NOT IN('order','item','customer','tailor_item','tailor_pick') THEN RAISE EXCEPTION 'Invalid report target' USING ERRCODE='22023';END IF;
 INSERT INTO sa_domain.outbox(parent_id,actor_id,event_type,aggregate_kind,aggregate_id,command_key,generation,payload)
 VALUES(p_source.id,p_source.actor_id,'airtable.report_'||p_family,'integration',p_id,p_source.id,p_source.generation,jsonb_build_object('family',p_family,'source_id',CASE WHEN p_source.event_type LIKE 'airtable.report_%' THEN coalesce(p_source.payload->>'source_id',p_source.id::text) ELSE p_source.id::text END,'cursor',0)) ON CONFLICT DO NOTHING;
END $f$;
ALTER FUNCTION sa_domain.report_enqueue(sa_domain.outbox,text,bigint) OWNER TO sa_worker;
REVOKE ALL ON FUNCTION sa_domain.report_enqueue(sa_domain.outbox,text,bigint) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.report_enqueue(sa_domain.outbox,text,bigint) TO sa_executor;
CREATE FUNCTION sa_domain.report_is_customer(p_id bigint) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$ SELECT EXISTS(SELECT FROM sa_snapshot_20261019.sa_users WHERE id=p_id AND role=3 AND deleted_at IS NULL) $f$;
ALTER FUNCTION sa_domain.report_is_customer(bigint) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.report_is_customer(bigint) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.report_is_customer(bigint) TO sa_worker;
CREATE FUNCTION sa_domain.capture_airtable_report() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE id_ bigint;ids_ jsonb;BEGIN
 IF NOT(SELECT enabled FROM sa_domain.airtable_report_config) OR NOT(SELECT cutover AND active_job IS NULL FROM sa_sync.environment_state) THEN RETURN NEW;END IF;
 IF NEW.event_type='orders.placed' OR NEW.event_type='backorder.placed' AND NOT NEW.payload?'placement_command_key' THEN
  ids_:=coalesce(NEW.payload->'order_ids',jsonb_build_array(NEW.aggregate_id));
  IF jsonb_typeof(ids_)<>'array' OR jsonb_array_length(ids_)>100 THEN RAISE EXCEPTION 'Report source batch too large' USING ERRCODE='54000';END IF;
  FOR id_ IN SELECT value::bigint FROM jsonb_array_elements_text(ids_) LOOP PERFORM sa_domain.report_enqueue(NEW,'order',id_);END LOOP;
 ELSIF NEW.event_type IN('order.amendment_applied','order.price_changed','order.due_changed','order.factory_assigned','order.worker_assigned','order.completed','order.force_completed','order.cancellation_requested','order.provider_processing','order.provider_cancelled','order.pickup_partial','order.dealer_ready','warehouse.status_changed') OR NEW.event_type='order.edited' AND nullif(NEW.payload->>'request_id','') IS NULL THEN
  -- A requested provider cancellation is not final report state; the confirmed
  -- status callback emits another source event when it actually changes.
  IF NEW.event_type='order.cancellation_requested' AND NEW.payload->>'provider_confirmation_required'='true' THEN RETURN NEW;END IF;
  PERFORM sa_domain.report_enqueue(NEW,'order',NEW.aggregate_id);
 ELSIF NEW.event_type IN('item.cut','item.inspected','item.dispatched','item.work_assigned','item.cutter_assigned','item.worker_cost_changed','item.worker_stage_changed') THEN
  PERFORM sa_domain.report_enqueue(NEW,'item',NEW.aggregate_id);
  IF NEW.event_type='item.inspected' THEN PERFORM sa_domain.report_enqueue(NEW,'tailor_item',NEW.aggregate_id);END IF;
 ELSIF NEW.event_type IN('rating.saved','rating.archived') AND NEW.payload->>'entity_kind'='Order' THEN PERFORM sa_domain.report_enqueue(NEW,'order',(NEW.payload->>'entity_id')::bigint);
 ELSIF NEW.event_type='customers.coordinator_changed' THEN
  ids_:=NEW.payload->'people';IF jsonb_typeof(ids_)<>'array' OR jsonb_array_length(ids_)>100 THEN RAISE EXCEPTION 'Report source batch too large' USING ERRCODE='54000';END IF;
  FOR id_ IN SELECT(value->>'id')::bigint FROM jsonb_array_elements(ids_) LOOP IF sa_domain.report_is_customer(id_) THEN PERFORM sa_domain.report_enqueue(NEW,'customer',id_);END IF;END LOOP;
 ELSIF NEW.event_type IN('person.saved.notify','customer.reviewed.notify','customer.links_saved','person.saved','profile.saved','customer.commercial_rules_saved','customer.coordinator_decided','address.saved','address.archived') THEN
  IF NEW.event_type='person.saved' AND(NEW.payload->>'created'='true' OR NEW.payload->>'role_changed'='true') THEN RETURN NEW;END IF;
  id_:=CASE WHEN NEW.event_type='customer.coordinator_decided' THEN(NEW.payload->>'customer_id')::bigint WHEN NEW.event_type IN('address.saved','address.archived') THEN(NEW.payload->>'user_id')::bigint ELSE NEW.aggregate_id END;
  IF sa_domain.report_is_customer(id_) THEN PERFORM sa_domain.report_enqueue(NEW,'customer',id_);END IF;
 END IF;RETURN NEW;
END $f$;
ALTER FUNCTION sa_domain.capture_airtable_report() OWNER TO sa_worker;
REVOKE ALL ON FUNCTION sa_domain.capture_airtable_report() FROM PUBLIC,anon,authenticated,sa_app,service_role;
CREATE TRIGGER squad_capture_airtable_report AFTER INSERT ON sa_domain.outbox FOR EACH ROW EXECUTE FUNCTION sa_domain.capture_airtable_report();

CREATE FUNCTION sa_domain.report_children(p_job sa_domain.outbox) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE family_ text:=p_job.payload->>'family';after_ bigint:=coalesce((p_job.payload->>'cursor')::bigint,0);order_ bigint;ceiling_ bigint:=(p_job.payload->>'ceiling')::bigint;BEGIN
 IF family_='order' THEN order_:=p_job.aggregate_id;
 ELSIF family_='tailor_item' THEN SELECT order_id INTO order_ FROM sa_snapshot_20261019.sa_items WHERE id=p_job.aggregate_id;
 ELSE RAISE EXCEPTION 'Invalid report enumeration' USING ERRCODE='22023';END IF;
 IF NOT sa_domain.report_authorized(p_job,order_,NULL) THEN RAISE EXCEPTION 'Report authority changed' USING ERRCODE='42501';END IF;
 IF ceiling_ IS NULL THEN
  IF family_='order' THEN SELECT max(id) INTO ceiling_ FROM sa_snapshot_20261019.sa_items WHERE order_id=order_;
  ELSE SELECT max(m.id) INTO ceiling_ FROM sa_snapshot_20261019.sa_job_sheet_mark_tailors m JOIN sa_snapshot_20261019.sa_job_sheet_tailor_mark_dates d ON d.id=m.job_sheet_tailor_mark_date_id WHERE d.item_id=p_job.aggregate_id;END IF;
 END IF;
 IF family_='order' THEN RETURN(SELECT jsonb_build_object('ids',coalesce(jsonb_agg(id::text ORDER BY id),'[]'),'next',max(id),'ceiling',ceiling_,'more',count(*)=50) FROM(SELECT id FROM sa_snapshot_20261019.sa_items WHERE order_id=order_ AND id>after_ AND id<=ceiling_ ORDER BY id LIMIT 50) q);END IF;
 RETURN(SELECT jsonb_build_object('ids',coalesce(jsonb_agg(id::text ORDER BY id),'[]'),'next',max(id),'ceiling',ceiling_,'more',count(*)=50) FROM(SELECT m.id FROM sa_snapshot_20261019.sa_job_sheet_mark_tailors m JOIN sa_snapshot_20261019.sa_job_sheet_tailor_mark_dates d ON d.id=m.job_sheet_tailor_mark_date_id WHERE d.item_id=p_job.aggregate_id AND m.id>after_ AND m.id<=ceiling_ ORDER BY m.id LIMIT 50) q);
END $f$;
ALTER FUNCTION sa_domain.report_children(sa_domain.outbox) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.report_children(sa_domain.outbox) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.report_children(sa_domain.outbox) TO sa_worker;

CREATE FUNCTION sa_domain.report_settle(p_job sa_domain.outbox,p_state text,p_code text DEFAULT NULL,p_delay integer DEFAULT 60,p_result jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
BEGIN
 UPDATE sa_domain.job_attempts SET state=CASE WHEN p_state='done' THEN 'done' ELSE 'failed' END,finished_at=now(),error_code=p_code WHERE lease_token=p_job.lease_token;
 UPDATE sa_domain.outbox SET status=p_state,last_error_code=p_code,available_at=now()+make_interval(secs=>greatest(1,least(3600,p_delay))),lease_until=NULL,completed_at=CASE WHEN p_state IN('done','dead') THEN now() END,result=p_result,revision=revision+1 WHERE id=p_job.id;
 UPDATE sa_domain.airtable_report_config SET active_job=NULL,active_until=NULL WHERE active_job=p_job.id;
 RETURN jsonb_build_object('id',p_job.id,'state',p_state,'error_code',p_code);
END $f$;
ALTER FUNCTION sa_domain.report_settle(sa_domain.outbox,text,text,integer,jsonb) OWNER TO sa_worker;
REVOKE ALL ON FUNCTION sa_domain.report_settle(sa_domain.outbox,text,text,integer,jsonb) FROM PUBLIC,anon,authenticated,sa_app,service_role;
CREATE FUNCTION sa_domain.squad_airtable_report_prepare(p_id uuid,p_lease_token uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE j sa_domain.outbox;g bigint;r jsonb;op sa_domain.airtable_report_operations;cfg sa_domain.airtable_report_config;id_ bigint;family_ text;code_ text;BEGIN
 PERFORM sa_domain.assert_service_worker();g:=sa_domain.worker_write_fence();SELECT * INTO j FROM sa_domain.outbox WHERE id=p_id FOR UPDATE;
 IF j.id IS NULL OR j.generation<>g OR j.lease_token IS DISTINCT FROM p_lease_token OR p_lease_token IS NULL OR sa_domain.job_handler(j.event_type,j.payload)<>'airtable_report' THEN RAISE EXCEPTION 'Report lease unavailable' USING ERRCODE='40001';END IF;
 IF j.status IN('done','dead') THEN RETURN jsonb_build_object('id',j.id,'state',j.status,'replayed',true);END IF;
 IF j.status<>'leased' OR j.lease_until<=statement_timestamp() THEN RAISE EXCEPTION 'Report lease expired' USING ERRCODE='40001';END IF;
 SELECT * INTO cfg FROM sa_domain.airtable_report_config FOR UPDATE;
 IF NOT cfg.enabled THEN RETURN sa_domain.report_settle(j,'dead','AIRTABLE_REPORT_DISABLED');END IF;
 IF cfg.active_job IS NOT NULL AND cfg.active_job<>j.id AND cfg.active_until>statement_timestamp() THEN
  UPDATE sa_domain.outbox SET attempts=greatest(0,attempts-1) WHERE id=j.id;RETURN sa_domain.report_settle(j,'pending','AIRTABLE_REPORT_BUSY',2);
 END IF;
 BEGIN
  INSERT INTO sa_domain.worker_context VALUES(pg_backend_pid(),txid_current(),j.id,j.actor_id,j.generation,j.lease_token);
  family_:=j.payload->>'family';
  IF family_ IN('order','tailor_item') THEN
   r:=sa_domain.report_children(j);
   FOR id_ IN SELECT value::bigint FROM jsonb_array_elements_text(r->'ids') LOOP PERFORM sa_domain.report_enqueue(j,CASE family_ WHEN 'order' THEN 'item' ELSE 'tailor_pick' END,id_);END LOOP;
   UPDATE sa_domain.outbox SET payload=payload||jsonb_build_object('cursor',r->'next','ceiling',r->'ceiling'),attempts=greatest(0,attempts-1) WHERE id=j.id;
   r:=sa_domain.report_settle(j,CASE WHEN(r->>'more')::boolean THEN 'pending' ELSE 'done' END,NULL,1,jsonb_build_object('enumerated',jsonb_array_length(r->'ids')));
  ELSE
   r:=sa_domain.airtable_report_projection(j,family_,j.aggregate_id);
   IF EXISTS(SELECT FROM sa_domain.airtable_report_operations x JOIN sa_domain.outbox other ON other.id=x.job_id WHERE x.generation=g AND x.kind=r->>'kind' AND x.entity_id=j.aggregate_id AND x.job_id<>j.id AND (x.state='reconciliation_required' OR x.state='pending' AND other.status IN('pending','leased') AND other.sequence_id<j.sequence_id)) THEN
    UPDATE sa_domain.outbox SET attempts=greatest(0,attempts-1) WHERE id=j.id;r:=sa_domain.report_settle(j,'pending','AIRTABLE_REPORT_PREVIOUS_PENDING',30);
   ELSIF EXISTS(SELECT FROM sa_domain.airtable_report_operations x JOIN sa_domain.outbox other ON other.id=x.job_id WHERE x.generation=g AND x.kind=r->>'kind' AND x.entity_id=j.aggregate_id AND x.state='confirmed' AND other.sequence_id>j.sequence_id) THEN r:=sa_domain.report_settle(j,'done',NULL,1,jsonb_build_object('ignored','NEWER_REPORT_CONFIRMED'));
   ELSE
    SELECT * INTO op FROM sa_domain.airtable_report_operations WHERE job_id=j.id FOR UPDATE;
    IF op.job_id IS NULL THEN INSERT INTO sa_domain.airtable_report_operations(job_id,generation,kind,entity_id,report_key,revision,fields,parent) VALUES(j.id,g,r->>'kind',j.aggregate_id,r->>'key',r->>'revision',r->'fields',r->'parent') RETURNING * INTO op;END IF;
    UPDATE sa_domain.airtable_report_config SET active_job=j.id,active_until=statement_timestamp()+interval '90 seconds';
    UPDATE sa_domain.outbox SET lease_until=statement_timestamp()+interval '90 seconds' WHERE id=j.id;
    r:=jsonb_build_object('state','prepared','environment',r->>'environment','kind',op.kind,'entity_id',op.entity_id::text,'key',op.report_key,'revision',op.revision,'fields',op.fields,'parent',op.parent);
   END IF;
  END IF;
  DELETE FROM sa_domain.worker_context WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
 EXCEPTION WHEN invalid_authorization_specification OR insufficient_privilege OR no_data_found THEN code_:='AIRTABLE_REPORT_SCOPE_CHANGED';
 WHEN invalid_parameter_value OR program_limit_exceeded THEN code_:='AIRTABLE_REPORT_INVALID';
 END;
 IF code_ IS NOT NULL THEN UPDATE sa_domain.airtable_report_operations SET state='failed',last_error_code=code_,updated_at=now() WHERE job_id=j.id;r:=sa_domain.report_settle(j,'dead',code_);END IF;
 RETURN r;
END $f$;
ALTER FUNCTION sa_domain.squad_airtable_report_prepare(uuid,uuid) OWNER TO sa_worker;
CREATE FUNCTION sa_domain.squad_airtable_report_finish(p_id uuid,p_lease_token uuid,p_result jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE j sa_domain.outbox;g bigint;op sa_domain.airtable_report_operations;r jsonb;code_ text:=p_result->>'code';error_ text;BEGIN
 PERFORM sa_domain.assert_service_worker();g:=sa_domain.worker_write_fence();SELECT * INTO j FROM sa_domain.outbox WHERE id=p_id FOR UPDATE;
 IF j.id IS NULL OR j.generation<>g OR j.lease_token IS DISTINCT FROM p_lease_token OR p_lease_token IS NULL OR sa_domain.job_handler(j.event_type,j.payload)<>'airtable_report' THEN RAISE EXCEPTION 'Report lease unavailable' USING ERRCODE='40001';END IF;
 IF j.status='done' THEN RETURN jsonb_build_object('id',j.id,'state','done','replayed',true);END IF;
 IF j.status<>'leased' OR j.lease_until<=statement_timestamp() THEN RAISE EXCEPTION 'Report lease expired' USING ERRCODE='40001';END IF;
 IF p_result IS NULL OR jsonb_typeof(p_result)<>'object' OR octet_length(p_result::text)>262144 OR code_ IS NULL OR code_ NOT IN('CONFIRMED','RETRY','RECONCILIATION_REQUIRED','REJECTED') THEN RAISE EXCEPTION 'Invalid report evidence' USING ERRCODE='22023';END IF;
 SELECT * INTO op FROM sa_domain.airtable_report_operations WHERE job_id=j.id FOR UPDATE;
 IF op.job_id IS NULL THEN RAISE EXCEPTION 'Prepared report required' USING ERRCODE='55000';END IF;
 IF code_='CONFIRMED' THEN
  IF p_result->>'key' IS DISTINCT FROM op.report_key OR p_result->>'revision' IS DISTINCT FROM op.revision OR p_result->'fields' IS DISTINCT FROM op.fields OR coalesce(p_result->>'record_id','')!~'^rec[A-Za-z0-9]{14}$' OR op.kind='tailor_pick' AND coalesce(p_result->>'parent_record_id','')!~'^rec[A-Za-z0-9]{14}$' THEN code_:='RECONCILIATION_REQUIRED';error_:='AIRTABLE_REPORT_PROOF_MISMATCH';
  ELSE
   UPDATE sa_domain.airtable_report_operations SET state='confirmed',record_id=p_result->>'record_id',proof=p_result,last_error_code=NULL,updated_at=now() WHERE job_id=j.id;
   RETURN sa_domain.report_settle(j,'done',NULL,1,jsonb_build_object('kind',op.kind,'entity_id',op.entity_id::text,'record_id',p_result->>'record_id'));
  END IF;
 END IF;
 error_:=coalesce(error_,p_result->>'error_code');IF error_ IS NULL OR error_ NOT IN('AIRTABLE_REPORT_PROOF_MISMATCH','AIRTABLE_RATE_LIMIT','AIRTABLE_UNAVAILABLE','AIRTABLE_AUTH_UNAVAILABLE','AIRTABLE_REPORT_DEPENDENCY','AIRTABLE_REPORT_UNCONFIRMED','AIRTABLE_REPORT_NOT_CONFIGURED','AIRTABLE_REPORT_CONFLICT','AIRTABLE_REPORT_REJECTED','AIRTABLE_REPORT_SCHEMA','AIRTABLE_REPORT_INVALID','AIRTABLE_REPORT_LIMIT','AIRTABLE_RESPONSE_INVALID','AIRTABLE_RESPONSE_LIMIT') THEN error_:='AIRTABLE_UNAVAILABLE';END IF;
 UPDATE sa_domain.airtable_report_operations SET state=CASE WHEN code_='RETRY' AND j.attempts<5 THEN 'pending' WHEN code_ IN('RETRY','RECONCILIATION_REQUIRED') OR j.attempts>1 OR op.state='reconciliation_required' OR error_ IN('AIRTABLE_REPORT_UNCONFIRMED','AIRTABLE_UNAVAILABLE') THEN 'reconciliation_required' ELSE 'failed' END,last_error_code=error_,updated_at=now() WHERE job_id=j.id;
 r:=sa_domain.report_settle(j,CASE WHEN code_='RETRY' AND j.attempts<5 THEN 'pending' ELSE 'dead' END,error_,greatest(30,least(3600,coalesce((p_result->>'retry_after')::int,60)),least(3600,30*power(2,j.attempts)::int)));RETURN r;
END $f$;
ALTER FUNCTION sa_domain.squad_airtable_report_finish(uuid,uuid,jsonb) OWNER TO sa_worker;
CREATE FUNCTION sa_domain.v1_airtable_reports_configure(p_enabled boolean,p_expected_version text,p_idempotency_key uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE ctx jsonb:=sa_domain.ops_context();cached_ jsonb;v text;BEGIN
 IF NOT((ctx->>'admin')::boolean OR(ctx->>'platform')::boolean) THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501';END IF;
 IF p_enabled IS NULL THEN RAISE EXCEPTION 'Enabled state required' USING ERRCODE='22023';END IF;
 cached_:=sa_domain.begin_command('airtable.reports_configured',p_idempotency_key,jsonb_build_object('enabled',p_enabled,'version',p_expected_version));IF cached_ IS NOT NULL THEN RETURN cached_;END IF;
 v:=sa_domain.bump_version('airtable_reports',1,p_expected_version);UPDATE sa_domain.airtable_report_config SET enabled=p_enabled;
 RETURN sa_domain.finish_command('airtable.reports_configured',p_idempotency_key,'integration',1,jsonb_build_object('enabled',p_enabled,'version',v),jsonb_build_object('enabled',p_enabled));
END $f$;
ALTER FUNCTION sa_domain.v1_airtable_reports_configure(boolean,text,uuid) OWNER TO sa_executor;
CREATE FUNCTION sa_domain.v1_airtable_reports_status() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE ctx jsonb:=sa_domain.ops_context();BEGIN
 IF NOT((ctx->>'admin')::boolean OR(ctx->>'platform')::boolean) THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501';END IF;
 RETURN(SELECT jsonb_build_object('enabled',enabled,'version',sa_domain.version('airtable_reports',1),'provider_configuration_required',true) FROM sa_domain.airtable_report_config);
END $f$;
ALTER FUNCTION sa_domain.v1_airtable_reports_status() OWNER TO sa_executor;
CREATE FUNCTION sa_domain.v1_airtable_reports_request(p_family text,p_ids bigint[],p_idempotency_key uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE ctx jsonb:=sa_domain.ops_context();cached_ jsonb;source_ sa_domain.outbox;id_ bigint;r jsonb;BEGIN
 IF NOT((ctx->>'admin')::boolean OR(ctx->>'platform')::boolean) THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501';END IF;
 IF p_family IS NULL OR p_family NOT IN('order','item','customer','tailor_pick') OR p_ids IS NULL OR cardinality(p_ids) NOT BETWEEN 1 AND 100 OR cardinality(p_ids)<>(SELECT count(DISTINCT x) FROM unnest(p_ids) x) OR EXISTS(SELECT FROM unnest(p_ids) x WHERE x IS NULL OR x<=0) THEN RAISE EXCEPTION 'Invalid report selection' USING ERRCODE='22023';END IF;
 IF NOT(SELECT enabled FROM sa_domain.airtable_report_config) THEN RAISE EXCEPTION 'Airtable reports are disabled' USING ERRCODE='55000';END IF;
 cached_:=sa_domain.begin_command('airtable.reports_requested',p_idempotency_key,jsonb_build_object('family',p_family,'ids',p_ids));IF cached_ IS NOT NULL THEN RETURN cached_;END IF;
 INSERT INTO sa_domain.outbox(actor_id,event_type,aggregate_kind,aggregate_id,command_key,generation,payload,status,completed_at)
 SELECT(ctx->>'auth_id')::uuid,'airtable.reports_batch','integration',p_ids[1],p_idempotency_key,generation,jsonb_build_object('family',p_family), 'done',now() FROM sa_domain.runtime_state RETURNING * INTO source_;
 FOREACH id_ IN ARRAY p_ids LOOP PERFORM sa_domain.report_enqueue(source_,p_family,id_);END LOOP;
 r:=jsonb_build_object('id',source_.id,'state','queued','requested',cardinality(p_ids));
 RETURN sa_domain.finish_command('airtable.reports_requested',p_idempotency_key,'integration',p_ids[1],r,jsonb_build_object('family',p_family,'requested',cardinality(p_ids)));
END $f$;
ALTER FUNCTION sa_domain.v1_airtable_reports_request(text,bigint[],uuid) OWNER TO sa_executor;

CREATE FUNCTION sa_domain.capture_airtable_report_failure() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
BEGIN
 UPDATE sa_domain.airtable_report_operations SET state=CASE WHEN NEW.last_error_code='SOURCE_REFRESH_DISCARDED' THEN 'failed' ELSE 'reconciliation_required' END,last_error_code=NEW.last_error_code,updated_at=now() WHERE job_id=NEW.id AND state='pending';
 UPDATE sa_domain.airtable_report_config SET active_job=NULL,active_until=NULL WHERE active_job=NEW.id;
 RETURN NEW;
END $f$;
ALTER FUNCTION sa_domain.capture_airtable_report_failure() OWNER TO sa_worker;
REVOKE ALL ON FUNCTION sa_domain.capture_airtable_report_failure() FROM PUBLIC,anon,authenticated,sa_app,service_role;
CREATE TRIGGER squad_capture_airtable_report_failure AFTER UPDATE OF status ON sa_domain.outbox FOR EACH ROW WHEN(NEW.status='dead' AND OLD.status IS DISTINCT FROM 'dead' AND NEW.event_type IN('airtable.report_order','airtable.report_item','airtable.report_customer','airtable.report_tailor_item','airtable.report_tailor_pick')) EXECUTE FUNCTION sa_domain.capture_airtable_report_failure();
DO $f$ DECLARE d text;signature_ text;BEGIN
 d:=pg_get_functiondef('sa_domain.job_handler(text,jsonb)'::regprocedure);d:=replace(d,'SELECT CASE WHEN',$s$SELECT CASE WHEN p_event IN('airtable.report_order','airtable.report_item','airtable.report_customer','airtable.report_tailor_item','airtable.report_tailor_pick') THEN 'airtable_report' WHEN$s$);EXECUTE d;
 FOREACH signature_ IN ARRAY ARRAY['sa_domain.squad_job_claim(integer)','sa_domain.job_projection(sa_domain.outbox)'] LOOP
  d:=pg_get_functiondef(signature_::regprocedure);d:=replace(d,'''business_mail''','''business_mail'',''airtable_report''');EXECUTE d;
 END LOOP;
 d:=pg_get_functiondef('sa_domain.v1_job_retry(uuid,text,text,uuid)'::regprocedure);d:=replace(d,'''PROVIDER_UNAVAILABLE'',''LEASE_EXHAUSTED''','''PROVIDER_UNAVAILABLE'',''LEASE_EXHAUSTED'',''AIRTABLE_RATE_LIMIT'',''AIRTABLE_UNAVAILABLE'',''AIRTABLE_AUTH_UNAVAILABLE'',''AIRTABLE_REPORT_DEPENDENCY'',''AIRTABLE_REPORT_UNCONFIRMED'',''AIRTABLE_REPORT_NOT_CONFIGURED'',''AIRTABLE_REPORT_DISABLED'',''AIRTABLE_REPORT_CONFLICT'',''AIRTABLE_REPORT_PROOF_MISMATCH'',''AIRTABLE_REPORT_SCHEMA''');EXECUTE d;
END $f$;
DO $f$ DECLARE f record;args_ text;roles_ text;BEGIN
 FOR f IN SELECT p.oid,p.proname,p.proargnames FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='sa_domain' AND p.proname=ANY(ARRAY['squad_airtable_report_prepare','squad_airtable_report_finish','v1_airtable_reports_configure','v1_airtable_reports_status','v1_airtable_reports_request']) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,sa_app,service_role',f.oid::regprocedure);
  SELECT string_agg(quote_ident(x),',') INTO args_ FROM unnest(f.proargnames) x;
  EXECUTE format('CREATE FUNCTION canto_api.%I(%s) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS %L',f.proname,pg_get_function_arguments(f.oid),'SELECT sa_domain.'||f.proname||'('||coalesce(args_,'')||')');
  EXECUTE format('REVOKE ALL ON FUNCTION canto_api.%I(%s) FROM PUBLIC,anon,authenticated,sa_app,service_role',f.proname,pg_get_function_identity_arguments(f.oid));
  roles_:=CASE WHEN f.proname LIKE 'squad_%' THEN 'service_role' ELSE 'sa_app,authenticated' END;
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s,canto_api.%I(%s) TO %s',f.oid::regprocedure,f.proname,pg_get_function_identity_arguments(f.oid),roles_);
 END LOOP;
END $f$;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_guard,sa_worker,sa_executor;
NOTIFY pgrst,'reload schema';
COMMIT;
