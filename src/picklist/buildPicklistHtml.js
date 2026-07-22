import {
  deriveTotalItems,
  displayComment,
  displayShelfCode,
  escapeHtml,
  formatPickupDate,
  formatPicklistCreatedAt
} from "./picklistFormat.js";

/**
 * @param {import('./picklistTypes.js').PicklistData} data
 * @param {{ barcodeDataUri: string, logoSrc: string }} assets
 */
export function renderPicklistBodyHtml(data, assets) {
  const totalItems = deriveTotalItems(data.items);
  const createdLabel = formatPicklistCreatedAt(data.createdAt);
  const barcodeCaption = `*${data.picklistNo}*`;

  const itemRows = (data.items ?? [])
    .map(
      (item) => `<tr>
        <td class="picklist-col-slno">${escapeHtml(item.slNo)}</td>
        <td class="picklist-col-sku">${escapeHtml(item.skuCode)}</td>
        <td class="picklist-col-name picklist-sku-name">${escapeHtml(item.skuName)}</td>
        <td class="picklist-col-shelf">${escapeHtml(displayShelfCode(item.shelfCode))}</td>
        <td class="picklist-col-comment">${escapeHtml(displayComment(item.comment))}</td>
        <td class="picklist-col-pickupdate">${escapeHtml(formatPickupDate(item.pickupDate))}</td>
        <td class="picklist-col-qty">${escapeHtml(item.qty)}</td>
      </tr>`
    )
    .join("");

  const orderRows = (data.orders ?? [])
    .map(
      (order) => `<tr>
        <td class="picklist-order-col-number">${escapeHtml(order.saleOrderNumber)}</td>
        <td class="picklist-order-col-customer">${escapeHtml(order.customerName)}</td>
      </tr>`
    )
    .join("");

  return `<article class="picklist-doc">
    <h1 class="picklist-title">Picking List</h1>

    <section class="picklist-header">
      <div class="picklist-header-left">
        <div><span class="picklist-label">Picklist No:</span>${escapeHtml(data.picklistNo)}</div>
        <img class="picklist-barcode" src="${assets.barcodeDataUri}" alt="${escapeHtml(barcodeCaption)}" />
        <div class="picklist-barcode-caption">${escapeHtml(barcodeCaption)}</div>
      </div>
      <div class="picklist-header-center">
        <span class="picklist-label">Total Items:</span>${escapeHtml(totalItems)}
      </div>
      <div class="picklist-header-right">
        <span class="picklist-label">Created:</span>${escapeHtml(createdLabel)}
      </div>
    </section>

    <section class="picklist-signoff">
      <div><span class="picklist-label">Picked By:</span> <span class="picklist-signoff-line"></span></div>
      <div><span class="picklist-label">Pick Start Time:</span> <span class="picklist-signoff-line"></span></div>
      <div><span class="picklist-label">Pick End Time:</span> <span class="picklist-signoff-line"></span></div>
    </section>

    <table class="picklist-items-table">
      <colgroup>
        <col class="picklist-col-slno" />
        <col class="picklist-col-sku" />
        <col class="picklist-col-name" />
        <col class="picklist-col-shelf" />
        <col class="picklist-col-comment" />
        <col class="picklist-col-pickupdate" />
        <col class="picklist-col-qty" />
      </colgroup>
      <thead>
        <tr>
          <th>Sl.No.</th>
          <th>SKU Code</th>
          <th>Sku Name</th>
          <th>Shelf Code</th>
          <th>Comment</th>
          <th>PICKUPDATE</th>
          <th>Qty</th>
        </tr>
      </thead>
      <tbody>
        <tr class="picklist-banner-row">
          <td colspan="7">PICK THESE ITEMS (Total Items to Pick: ${escapeHtml(totalItems)})</td>
        </tr>
        ${itemRows}
        <tr class="picklist-brand-row">
          <td colspan="7">
            <span class="picklist-brand-inner">
              <img class="picklist-brand-logo" src="${assets.logoSrc}" alt="Scott" />
              <span>Scott ERP System</span>
            </span>
          </td>
        </tr>
      </tbody>
    </table>

    <table class="picklist-orders-table">
      <colgroup>
        <col class="picklist-order-col-number" />
        <col class="picklist-order-col-customer" />
      </colgroup>
      <thead>
        <tr>
          <th>Sale Order Number</th>
          <th>Customer Name</th>
        </tr>
      </thead>
      <tbody>${orderRows}</tbody>
    </table>
  </article>`;
}

/**
 * @param {import('./picklistTypes.js').PicklistData} data
 * @param {{ barcodeDataUri: string, logoSrc: string, cssText: string, title?: string }} options
 */
export function buildPicklistHtmlDocument(data, options) {
  const body = renderPicklistBodyHtml(data, {
    barcodeDataUri: options.barcodeDataUri,
    logoSrc: options.logoSrc
  });
  const title = options.title ?? `Picking List ${data.picklistNo}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>${options.cssText}</style>
</head>
<body>${body}</body>
</html>`;
}
