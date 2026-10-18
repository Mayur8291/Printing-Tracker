begin;
create temporary table assertion_count(n integer);
insert into assertion_count values(0);
create function pg_temp.is(actual anyelement,expected anyelement,label text) returns text language plpgsql as $$begin
if actual is distinct from expected then raise exception 'FAIL %: % != %',label,actual,expected; end if;
update assertion_count set n=n+1; return 'ok - '||label; end$$;
create function pg_temp.throws_ok(statement text,code text,message text,label text) returns text language plpgsql as $$begin
begin execute statement; exception when others then
if sqlstate=code and sqlerrm=message then update assertion_count set n=n+1;return 'ok - '||label;end if;raise;end;
raise exception 'FAIL %: no exception',label;end$$;
set local search_path=pg_temp,public;
insert into public.inventory_skus(sku_code,kind,name) values('TEST-A','apparel','Synthetic A'),('TEST-B','apparel','Synthetic B');
insert into public.inventory_facility_stock(sku_id,facility_code,on_hand_qty)
select id,'TEST-F',10 from public.inventory_skus where sku_code like 'TEST-%';
create temporary table results(k text primary key,v jsonb);
insert into results values('adjust',public.dashboard_mutate_v1('test-adjust-1','adjust',null,'{"facility_code":"TEST-F","reason":"Synthetic count","items":[{"sku_code":"TEST-A","delta":2}]}'));
select pg_temp.is((select v->>'status' from results where k='adjust'),'200','adjust succeeds');
select pg_temp.is((select on_hand_qty::text from public.inventory_facility_stock f join public.inventory_skus s on s.id=f.sku_id where s.sku_code='TEST-A'),'12.00','exact stock delta');
select pg_temp.is(public.dashboard_mutate_v1('test-adjust-1','adjust',null,'{"facility_code":"TEST-F","reason":"Synthetic count","items":[{"sku_code":"TEST-A","delta":2}]}'),(select v from results where k='adjust'),'exact retry returns original result');
select pg_temp.is((select count(*)::integer from public.inventory_stock_adjustments where facility_code='TEST-F'),1,'retry does not double adjust');
select pg_temp.throws_ok($$select public.dashboard_mutate_v1('test-adjust-1','adjust',null,'{"facility_code":"OTHER"}')$$,'23505','IDEMPOTENCY_CONFLICT','key divergence rejected');
select pg_temp.is(public.dashboard_mutate_v1('test-adjust-bad','adjust',null,'{"facility_code":"TEST-F","reason":"Synthetic fail","items":[{"sku_code":"TEST-A","delta":2},{"sku_code":"TEST-B","delta":-20}]}')->>'status','409','second-line shortage rejected');
select pg_temp.is((select on_hand_qty::text from public.inventory_facility_stock f join public.inventory_skus s on s.id=f.sku_id where s.sku_code='TEST-A'),'12.00','first-line update rolled back');
insert into results values('create',public.dashboard_mutate_v1('test-create-1','create',null,'{"facility_code":"TEST-F","order_code":"TEST-ORDER","items":[{"sku_code":"TEST-A","quantity":3}]}'));
select pg_temp.is((select v->>'status' from results where k='create'),'201','create succeeds');
select pg_temp.is((select reserved_qty::text from public.inventory_facility_stock f join public.inventory_skus s on s.id=f.sku_id where s.sku_code='TEST-A'),'3.00','create reserves exactly once');
insert into results values('edit',public.dashboard_mutate_v1('test-edit-1','edit',(select v#>>'{body,dashboard_order_id}' from results where k='create'),
jsonb_build_object('expected_updated_at',(select v#>>'{body,updated_at}' from results where k='create'),'shipping_address',jsonb_build_object('pincode','411001'),'items','[{"sku_code":"TEST-A","quantity":5}]'::jsonb)));
select pg_temp.is((select v->>'status' from results where k='edit'),'200','CAS edit succeeds');
select pg_temp.is((select reserved_qty::text from public.inventory_facility_stock f join public.inventory_skus s on s.id=f.sku_id where s.sku_code='TEST-A'),'5.00','edit replaces own reservation, not double reserve');
select pg_temp.is(public.dashboard_mutate_v1('test-edit-stale','edit',(select v#>>'{body,dashboard_order_id}' from results where k='create'),jsonb_build_object('expected_updated_at',(select v#>>'{body,updated_at}' from results where k='create'),'comment','stale'))->>'status','409','stale edit rejected');
select pg_temp.is(public.dashboard_mutate_v1('test-edit-short','edit',(select v#>>'{body,dashboard_order_id}' from results where k='create'),'{"items":[{"sku_code":"TEST-A","quantity":100}]}')->>'status','409','oversized edit denied');
select pg_temp.is((select reserved_qty::text from public.inventory_facility_stock f join public.inventory_skus s on s.id=f.sku_id where s.sku_code='TEST-A'),'5.00','failed edit restores old hold');
select pg_temp.is(public.dashboard_mutate_v1('test-complete-1','status',(select v#>>'{body,dashboard_order_id}' from results where k='create'),'{"status":"COMPLETE"}')->>'status','200','complete succeeds');
select pg_temp.is((select on_hand_qty::text||':'||reserved_qty::text from public.inventory_facility_stock f join public.inventory_skus s on s.id=f.sku_id where s.sku_code='TEST-A'),'7.00:0.00','fulfillment deducts once and releases hold');
select pg_temp.is(public.dashboard_mutate_v1('test-edit-final','edit',(select v#>>'{body,dashboard_order_id}' from results where k='create'),'{"comment":"late"}')->>'status','409','terminal edit denied');
select pg_temp.is(public.dashboard_mutation_result_v1('test-adjust-1')->'response',(select v from results where k='adjust'),'read-only reconciliation exact result');
insert into results values('reserve',public.dashboard_mutate_v1('test-reserve-1','reserve',null,'{"facility_code":"TEST-F","order_code":"TEST-HOLD","items":[{"sku_code":"TEST-B","quantity":2,"item_code":"B1"},{"sku_code":"TEST-B","quantity":3,"item_code":"B2"}]}'));
select pg_temp.is((select v->>'status' from results where k='reserve'),'201','duplicate SKU quantities consolidated compatibly');
select pg_temp.is((select reserved_qty::text from public.inventory_facility_stock f join public.inventory_skus s on s.id=f.sku_id where s.sku_code='TEST-B'),'5.00','duplicate SKU hold counted exactly once');
select pg_temp.is(public.dashboard_mutate_v1('test-reserve-2','reserve',null,'{"facility_code":"TEST-F","order_code":"TEST-HOLD","items":[{"sku_code":"TEST-B","quantity":5,"item_code":"B1"}]}')#>>'{body,reservation_id}',(select v#>>'{body,reservation_id}' from results where k='reserve'),'same logical hold reuses reservation');
select pg_temp.is(public.dashboard_mutate_v1('test-reserve-diverge','reserve',null,'{"facility_code":"TEST-F","order_code":"TEST-HOLD","items":[{"sku_code":"TEST-B","quantity":6,"item_code":"B1"}]}')->>'status','409','same reference different hold rejected');
select pg_temp.is(public.dashboard_mutate_v1('test-release-1','release',(select v#>>'{body,reservation_id}' from results where k='reserve'),'{"reason":"Synthetic cancellation"}')->>'status','200','standalone hold releases');
select pg_temp.is(public.dashboard_mutate_v1('test-release-2','release',(select v#>>'{body,reservation_id}' from results where k='reserve'),'{"reason":"Synthetic cancellation"}')->>'status','200','release remains idempotent');
select pg_temp.is((select reserved_qty::text from public.inventory_facility_stock f join public.inventory_skus s on s.id=f.sku_id where s.sku_code='TEST-B'),'0.00','released hold has no residual stock');
select pg_temp.is(public.dashboard_mutate_v1('test-bad-adjust','adjust',null,'{"facility_code":"TEST-F","reason":"Synthetic duplicate","items":[{"sku_code":"TEST-B","delta":2},{"sku_code":"TEST-B","delta":2}]}')->>'status','400','duplicate manual correction rejected rather than double counted');
select pg_temp.is((select count(*)::integer from private.dashboard_mutation_results_v1 where request_id='test-adjust-bad'),1,'business rejection retained durably');
select pg_temp.is(has_function_privilege('authenticated','public.dashboard_mutate_v1(text,text,text,jsonb)','EXECUTE'),false,'browser cannot call atomic engine');
select pg_temp.is(n,28,'all assertions executed') from assertion_count;
rollback;
