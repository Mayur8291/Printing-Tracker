"""Source-to-component index, not browser acceptance or an exhaustive control review."""
import csv, hashlib, subprocess
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT.parent / 'Canto/scott-flutter'
PIN = '5d55d9461af18b94a867dce07dee7c4b76f1e51f'
OUT = Path(__file__).resolve().parent
FEATURES = {
 'PEOPLE':['features/people/PeoplePage.jsx','features/profile/ProfilePage.jsx'],
 'CONFIG':['features/catalogue/CataloguePage.jsx','features/catalogue/PartConfiguration.jsx','features/catalogue/BrandingEditor.jsx','features/catalogue/ProductReferenceImages.jsx','components/ConfiguratorPreview.jsx'],
 'TARGET':['features/work/TargetsPage.jsx'],
 'APP':['SquadShell.jsx','features/home/HomePage.jsx','components/AccountContacts.jsx','components/ContactActions.jsx'],
 'LINK':['features/people/PeoplePage.jsx','features/profile/ProfilePage.jsx'],
 'TASK':['features/work/WorkPage.jsx'],
 'CAT':['features/catalogue/CataloguePage.jsx','features/catalogue/ProductGallery.jsx','features/catalogue/ProductShareDialog.jsx'],
 'DOC':['features/documents/DocumentsPage.jsx'],
 'ORDER':['features/orders/OrdersPage.jsx','features/catalogue/CataloguePage.jsx'],
 'GOAL':['features/work/WorkPage.jsx'],
 'AUTH':['../application/AccountFlow.jsx','../application/AppRoot.jsx'],
 'CUT':['features/production/ProductionPage.jsx'],
 'DISPATCH':['features/production/ProductionPage.jsx','features/stock/StockPage.jsx'],
 'SEW':['features/production/ProductionPage.jsx','features/production/WorkHistory.jsx'],
 'JOB':['features/jobWork/JobWorkPage.jsx'],
 'METRIC':['features/reports/ReportsPage.jsx','features/home/HomePage.jsx'],
 'RETIRED':[],
 'MEDIA':['components/Media.jsx','components/ImageCropDialog.jsx'],
 'PLAN':['features/production/ProductionPage.jsx'],
 'PROMO':['features/promotions/PromotionsPage.jsx'],
 'RATE':['features/orders/RatingsPanel.jsx'],
 'INTEGRATE':['features/administration/IntegrationsPanel.jsx'],
}
rows = list(csv.DictReader((ROOT/'docs/squad-one-audit/flutter-views.csv').open()))
workflows = list(csv.DictReader((OUT/'workflow-web-coverage.csv').open()))
assert len(rows) == 317 and len({r['path'] for r in rows}) == 317
result=[]
for row in rows:
 cap=row['capability']; targets=FEATURES[cap]
 for file in targets:
  assert (ROOT/'apps/admin/src/squad'/file).exists(), file
 content=subprocess.run(['git','show',f'{PIN}:{row["path"]}'],cwd=SOURCE,check=True,capture_output=True).stdout
 note='Shared feature mapping only. Inspect each reachable control before claiming UI parity; source methods include helpers, commented calls and unreachable methods.'
 state='mapped_control_review_pending'
 if cap=='RETIRED': state='retired_in_original_source_inventory';note=row['disposition']
 if row['group'] in ['forgot','otp','reset_password']:
  state='reviewed_proof_recovery_mapping';note='Forgot → OTP → reset uses the shared /account/recovery form. AuthService.updatePassword has no lib callers; no authenticated password view is claimed. Hosted controlled-inbox acceptance remains pending.'
 if row['group'] in ['jobsheet','inspector_item_detail','cutting_item_detail']:
  state='reviewed_history_and_temporary_quantity_controls';note='resetItemTailorsQuantity clears local tempCount after success, not server allocation. setHistoryDate selects an existing event; date tabs select timestamped history records rather than a from/before range. Web uses bounded per-size history and clears submitted form values. Full action/provider acceptance is recorded separately.'
 if row['group']=='add_branding':
  state='reviewed_branding_controls_local_browser_passed';note='Shared BrandingEditor supports dimensions/technique/placement edits preserving design IDs/version/media, placement-specific Comment/Guidelines, and existing artwork/mockup/attachment fields. Pinned print-area selector is commented out. Protected order-linked mutation stays rejected. Hosted artwork mutation acceptance remains separate.'
 if row['group'] in ['create_product','create_product_preview','product_add_ons','select_color','fabric','fabric_type','base_product','parent_base_product']:
  state='reviewed_catalogue_controls_local_implementation';note='Shared configuration covers source selection/reset, single/multiple groups, sleeve dependencies, colors, placement edits and owned reference images/guidelines. Rendered mockup capture and optional crop use verified upload. See source-control-review.csv CONFIG03/04 and MEDIA01/02; local tests are separate from hosted mutation acceptance.'
 if row['group'] in ['rmp','rmp_brands','rmp_detail','rmp_search','products_category']:
  state='reviewed_shared_catalogue_controls_local_implementation';note='Shared product/search/type/category/brand selectors, bounded variants and quote selection replace repeated native routes. All-image gallery, larger view, selected-image and bounded multi/brand file sharing retained. Catalogue-document selection uses the shared Documents builder. Source single-image raw stock caption is not exposed in file export; no persistent signed URL is shared. Hosted flow evidence remains separate.'
 if cap=='APP' and row['group'] in ['admin_dashboard','assistant_worker','customer_dashboard','dealer_dashboard','dispatch_dashboard','drawer','factory_dashboard','inspector_dashboard','jobworker','pc_dashboard','sc_dashboard']:
  state='reviewed_shared_navigation_contacts_local_passed';note='Pinned bottom tabs and drawer actions map to shared authorized modules. Home now mounts shared AccountContacts for Customer/Dealer using only sdk.person(self), linked-dealer-first selection and coordinator fallback; People uses the same sanitized ContactActions. Staging external links remain disabled. Five actual React contact checks and mobile visual review pass. Customer dashboard third-tab callback alone is unreachable. Domain-specific controls and hosted acceptance remain recorded separately.'
 if cap=='APP' and row['group'] in ['app_update_view','splash']:
  state='reviewed_native_bootstrap_web_equivalent';note='Native app-store version gate is packaging-specific. Web AppRoot authenticates and loads role/capability bootstrap; bounded SDK master reads replace native global preload. This mapping does not claim mobile app-store or OS push integration.'
 if row['group']=='promotional_assets':
  state='reviewed_promotion_category_day_open_controls';note='Category, all dates and exact upload-day controls retained; pinned Recently Added is exactly today. Source download launches its link; web authorized MediaViewer or safe external link opens content. Bounded server pagination replaces whole-list filtering. See UI-CONTROL-PROMO-01; hosted media/domain coverage separate.'
 if row['group']=='pdf_view':
  state='reviewed_pdf_view_native_share_pending';note='Secure web download/Open replaces native viewer. Pinned allowToShare=true is reachable from delivery_challan:57 and tailor_details:250. Explicit prepared PDF-file sharing is assigned to Documents lane; do not claim this source control complete before that integration.'
 result.append({'source_path':row['path'],'source_commit':PIN,'source_sha256':hashlib.sha256(content).hexdigest(),'source_group':row['group'],'source_capability':cap,'source_methods':row['methods'],'workflow_family_ids':';'.join(r['workflow_id'] for r in workflows if r['module']==cap),'shared_implementation_files':';'.join(str(Path('apps/admin/src/squad')/file) for file in targets),'control_review_state':state,'review_note':note,'hosted_acceptance':'not_claimed_by_this_index'})
with (OUT/'source-view-web-traceability.csv').open('w',newline='') as file:
 writer=csv.DictWriter(file,fieldnames=result[0]);writer.writeheader();writer.writerows(result)
print(f'Indexed {len(result)} pinned source files; shared-component mapping is not action acceptance.')
