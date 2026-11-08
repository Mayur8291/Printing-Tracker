"""Fresh exact-owned historical work for an actual prior-week scheduler report.

The dates describe synthetic historical work, while created_at/updated_at are
inserted now by the common fixture owner. No existing source row is backdated.
"""
import datetime
from zoneinfo import ZoneInfo


def plan_fixture(state):
    assert state.get('weekly_mail_rehearsal') is True
    at=datetime.datetime.fromisoformat(state['created_at']).astimezone(ZoneInfo('Asia/Kolkata'))
    saturday=at.date()-datetime.timedelta(days=(at.weekday()-5)%7)
    week=saturday-datetime.timedelta(days=14 if at<datetime.datetime.combine(saturday,datetime.time(0,1),at.tzinfo) else 7)
    assigned=datetime.datetime.combine(week+datetime.timedelta(days=2),datetime.time(10),at.tzinfo).astimezone(datetime.timezone.utc).replace(tzinfo=None).isoformat()
    base=state['data_base'];actor=state['base'];label=state['label'];rows=[]
    def row(table,offset,**values):
        item={'id':base+offset,**values};rows.append({'table':'sa_snapshot_20261019.sa_'+table,'ids':[item['id']],'rows':[item]})
    row('users',200,name=label+' historical customer',email=f'squad-history-{label[4:]}@mailinator.com',encrypted_password='',role=3,approved=True,onboarded=True,disabled=False,is_direct_deal=True)
    row('addresses',201,user_id=base+200,address=label+' historical address',state='Karnataka',city=label+' city',zip_code='560001',is_primary=True)
    row('products',202,product_type=0,name=label+' historical product',base_product_id=base+5,fabric_id=base+7,category_id=base+6,fabric_color_id=base+8)
    row('orders',203,customer_id=base+200,address_id=base+201,assigned_to_id=actor+4,order_item_type=1,status=0,
        created_on=assigned,due_on=assigned,total_quantity=3,total_amount='1500',sub_total_amount='1500',
        cutting_status=1,cutting_done=3,assigned_to_tailor_quantity=3,completed_by_tailor_quantity=3,completed_by_tailor_quantity_status=1,tailor_job_status=1)
    row('items',204,order_id=base+203,product_id=base+202,cutting_master_id=actor+9,item_type=0,total_quantity=3,
        per_piece_amount='500',calculated_per_piece_amount='500',total_amount='1500',cutting_status=1,cutting_done=3,
        job_sheet_assigned=True,job_sheet_due_on=assigned,job_sheet_completion_by=assigned,assigned_to_tailor_quantity=3,
        completed_by_tailor_quantity=3,completed_by_tailor_quantity_status=1,tailor_job_status=1)
    row('quantities',205,item_id=base+204,size_id=base+2,quantity=3,cutting_done=3,assigned_to_tailor_quantity=3,completed_by_tailor_quantity=3,completed_by_tailor_quantity_status=1)
    row('item_tailors',206,item_id=base+204,tailor_id=actor+5,assigned_quantity=3,completed_quantity=3,completed_quantity_status=1,quantity_completed_at=assigned)
    row('item_tailor_quantities',207,item_tailor_id=base+206,quantity_id=base+205,assigned_quantity=3,completed_quantity=3,completed_quantity_status=1)
    row('job_sheet_assign_dates',208,item_id=base+204,assign_at=assigned)
    row('job_sheet_assign_tailors',209,job_sheet_assign_date_id=base+208,item_tailor_id=base+206)
    row('job_sheet_assign_quantities',210,job_sheet_assign_date_id=base+208,job_sheet_assign_tailor_id=base+209,item_tailor_id=base+206,
        item_id=base+204,quantity_id=base+205,qty=3,assigned_quantity=3,completed_quantity=3,completed_quantity_status=1)
    row('job_sheet_tailor_mark_dates',211,item_id=base+204,marked_at=assigned)
    row('job_sheet_mark_tailors',212,job_sheet_tailor_mark_date_id=base+211,item_tailor_id=base+206)
    row('mark_tailor_quantities',213,job_sheet_mark_tailor_id=base+212,item_tailor_quantity_id=base+207,qty=3,completed_quantity=3)
    return {'fixture_tables':rows,'weeklyMail':{'tailorId':str(actor+5),'weekStart':str(week),'itemId':str(base+204),
        'assigned':3,'completed':3,'amount':'105','rows':1}}
